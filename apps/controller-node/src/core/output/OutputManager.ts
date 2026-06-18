/**
 * OutputManager.ts — Collects, persists, and streams cell outputs.
 *
 * Sits between KernelManager (raw bridge messages) and:
 *   - OutputStore  (SQLite persistence)
 *   - EventBus     (broadcast to WebSocket consumers)
 *
 * Per-cell output accumulator ensures final output list is accurate
 * for both persistence and notebook-level state sync.
 */

import { eventBus } from '../events/EventBus.js';
import { outputStore } from './OutputStore.js';
import type { NotebookOutput } from '../events/EventBus.js';

// ── In-memory accumulator per active execution ────────────────────────────────

interface ExecutionAccumulator {
    notebookId: string;
    cellId: string;
    executionId: string;
    outputs: NotebookOutput[];
    startedAt: number;
}

// ── OutputManager ──────────────────────────────────────────────────────────────

export class OutputManager {
    private static instance: OutputManager;

    /** Active execution accumulators. Key: executionId */
    private accumulators: Map<string, ExecutionAccumulator> = new Map();

    private constructor() {}

    public static getInstance(): OutputManager {
        if (!OutputManager.instance) {
            OutputManager.instance = new OutputManager();
        }
        return OutputManager.instance;
    }

    // ── Execution lifecycle ────────────────────────────────────────────────────

    /**
     * Called when a cell begins execution.
     * Creates the in-memory accumulator and opens the SQLite row.
     */
    public onExecutionStart(
        notebookId: string,
        cellId: string,
        executionId: string,
    ): void {
        const acc: ExecutionAccumulator = {
            notebookId,
            cellId,
            executionId,
            outputs: [],
            startedAt: Date.now(),
        };
        this.accumulators.set(executionId, acc);
        outputStore.startCellExecution(notebookId, cellId, executionId);
    }

    /**
     * Called for every streamed output (stdout, display_data, etc.).
     * Appends to the in-memory accumulator, persists to SQLite,
     * and emits output:received so the WebSocket route can forward it.
     */
    public onOutput(executionId: string, rawOutput: any): void {
        const acc = this.accumulators.get(executionId);
        if (!acc) return;

        const output = this.normalizeOutput(rawOutput);
        if (!output) return;

        acc.outputs.push(output);

        // Persist each output immediately (streaming persistence)
        outputStore.appendOutput(acc.notebookId, acc.cellId, acc.executionId, output);

        // Broadcast to subscribers (WebSocket routes)
        eventBus.emit('output:received', {
            notebookId: acc.notebookId,
            cellId: acc.cellId,
            executionId,
            output,
        });
    }

    /**
     * Called when execution finishes successfully.
     * Finalizes SQLite row and emits cell:completed.
     */
    public onExecutionComplete(
        executionId: string,
        executionCount: number | null,
        _rawResult?: any,
    ): void {
        const acc = this.accumulators.get(executionId);
        if (!acc) return;

        const durationMs = Date.now() - acc.startedAt;
        const { notebookId, cellId } = acc;

        outputStore.completeCellExecution(
            notebookId,
            cellId,
            executionId,
            'completed',
            executionCount,
            durationMs,
            acc.outputs,
        );

        eventBus.emit('cell:completed', {
            notebookId,
            cellId,
            executionId,
            executionCount,
            durationMs,
            success: true,
            outputs: acc.outputs,
        });

        this.accumulators.delete(executionId);
    }

    /**
     * Called when execution fails with an error.
     * Emits cell:failed and persists final state.
     */
    public onExecutionError(
        executionId: string,
        error: string,
        ename?: string,
        evalue?: string,
        traceback?: string[],
    ): void {
        const acc = this.accumulators.get(executionId);
        if (!acc) return;

        const durationMs = Date.now() - acc.startedAt;
        const { notebookId, cellId } = acc;

        // If no error output was streamed yet, synthesize one
        const hasErrorOutput = acc.outputs.some((o) => o.output_type === 'error');
        if (!hasErrorOutput && ename) {
            const errorOutput: NotebookOutput = {
                output_type: 'error',
                ename: ename,
                evalue: evalue ?? '',
                traceback: traceback ?? [],
            };
            acc.outputs.push(errorOutput);
        }

        outputStore.completeCellExecution(
            notebookId,
            cellId,
            executionId,
            'failed',
            null,
            durationMs,
            acc.outputs,
        );

        eventBus.emit('cell:failed', {
            notebookId,
            cellId,
            executionId,
            error,
            ename,
            evalue,
            traceback,
            outputs: acc.outputs,
            durationMs,
        });

        this.accumulators.delete(executionId);
    }

    /**
     * Called on keyboard interrupt.
     */
    public onExecutionInterrupted(executionId: string): void {
        const acc = this.accumulators.get(executionId);
        if (!acc) return;

        const durationMs = Date.now() - acc.startedAt;
        const { notebookId, cellId } = acc;

        outputStore.completeCellExecution(
            notebookId,
            cellId,
            executionId,
            'interrupted',
            null,
            durationMs,
            acc.outputs,
        );

        eventBus.emit('cell:interrupted', { notebookId, cellId, executionId });
        this.accumulators.delete(executionId);
    }

    // ── Query API ──────────────────────────────────────────────────────────────

    /** Get all persisted outputs for a cell (for session restore). */
    public getCellOutputs(notebookId: string, cellId: string): NotebookOutput[] {
        return outputStore.getLatestCellOutputs(notebookId, cellId);
    }

    /**
     * Get all cells' outputs for a notebook.
     * Returns a map of cellId → NotebookOutput[].
     */
    public getNotebookOutputs(notebookId: string): Map<string, NotebookOutput[]> {
        const rows = outputStore.getNotebookOutputs(notebookId);
        const result = new Map<string, NotebookOutput[]>();

        for (const row of rows) {
            try {
                result.set(row.cell_id, JSON.parse(row.outputs_json) as NotebookOutput[]);
            } catch {
                result.set(row.cell_id, []);
            }
        }

        return result;
    }

    /** Called after kernel restart — clears all persisted outputs. */
    public clearNotebookOutputs(notebookId: string): void {
        // Cancel any in-flight accumulators for this notebook
        for (const [execId, acc] of this.accumulators.entries()) {
            if (acc.notebookId === notebookId) {
                this.accumulators.delete(execId);
            }
        }
        outputStore.clearNotebookOutputs(notebookId);
    }

    // ── Output normalization ───────────────────────────────────────────────────

    /**
     * Normalizes the raw bridge message output into a Jupyter-compatible IOutput.
     * Bridge sends: { type: 'stream'|'result'|'display'|'error', ... }
     */
    private normalizeOutput(raw: any): NotebookOutput | null {
        if (!raw || typeof raw !== 'object') return null;

        switch (raw.type) {
            case 'stream':
                return {
                    output_type: 'stream',
                    name: (raw.stream === 'stderr' ? 'stderr' : 'stdout') as 'stdout' | 'stderr',
                    text: String(raw.data ?? ''),
                };

            case 'result':
                return {
                    output_type: 'execute_result',
                    execution_count: raw.execution_count ?? null,
                    data: this.normalizeData(raw.data),
                    metadata: raw.metadata ?? {},
                };

            case 'display':
                return {
                    output_type: 'display_data',
                    data: this.normalizeData(raw.data),
                    metadata: raw.metadata ?? {},
                };

            case 'error':
                return {
                    output_type: 'error',
                    ename: String(raw.ename ?? 'Error'),
                    evalue: String(raw.evalue ?? raw.evalue ?? ''),
                    traceback: Array.isArray(raw.traceback) ? raw.traceback : [],
                };

            default:
                return null;
        }
    }

    /**
     * Ensure data is always Record<string, string> for consistency.
     * The bridge may send { 'text/plain': '42' } or a raw string.
     */
    private normalizeData(data: any): Record<string, string> {
        if (typeof data === 'string') return { 'text/plain': data };
        if (typeof data === 'object' && data !== null) return data as Record<string, string>;
        return { 'text/plain': String(data ?? '') };
    }
}

export const outputManager = OutputManager.getInstance();
