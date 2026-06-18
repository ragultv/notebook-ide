/**
 * ExecutionEngine.ts — High-level cell execution orchestrator.
 *
 * Public API (all operations a notebook IDE needs):
 *   runCell()       — execute one cell
 *   runAll()        — execute all code cells in notebook order
 *   runAbove()      — execute all code cells above a target cell
 *   runBelow()      — execute all code cells below a target cell
 *   runSelection()  — execute a specific subset of cells in notebook order
 *   stopExecution() — drain the queue + interrupt the kernel
 *
 * Architecture:
 *   ExecutionEngine  →  ExecutionQueue  →  KernelManager  →  BridgeProcess
 *                   →  OutputManager   (streaming output)
 *                   →  NotebookManager (cell state updates)
 *                   →  EventBus        (broadcast events)
 *
 * The engine registers itself as the queue executor, so the queue calls
 * back into this class for each dequeued item.
 */

import { v4 as uuidv4 } from 'uuid';
import { KernelManager } from '../KernelManager.js';
import { eventBus } from '../events/EventBus.js';
import { outputManager } from '../output/OutputManager.js';
import { notebookManager } from './NotebookManager.js';
import { executionQueue, type QueueItem } from './ExecutionQueue.js';
import type { IpynbCell } from './NotebookManager.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RunCellOptions {
    /** Pre-generated execution ID (pass from WebSocket so frontend knows it). */
    executionId?: string;
}

export interface RunBatchOptions {
    /** Stop the entire batch on first cell failure (default: true). */
    stopOnError?: boolean;
}

// ── ExecutionEngine ────────────────────────────────────────────────────────────

export class ExecutionEngine {
    private static instance: ExecutionEngine;
    private kernelManager: KernelManager;

    private constructor() {
        this.kernelManager = KernelManager.getInstance();

        // Register this engine as the executor for the queue
        executionQueue.setExecutor(
            (notebookId, item, queuePosition, queueSize) =>
                this.executeSingleCell(notebookId, item, queuePosition, queueSize),
        );

        // When a kernel is restarted, clear outputs in NotebookManager
        eventBus.on('kernel:restarted', ({ notebookId }) => {
            notebookManager.clearAllOutputs(notebookId);
            outputManager.clearNotebookOutputs(notebookId);
        });
    }

    public static getInstance(): ExecutionEngine {
        if (!ExecutionEngine.instance) {
            ExecutionEngine.instance = new ExecutionEngine();
        }
        return ExecutionEngine.instance;
    }

    // ── Public execution API ───────────────────────────────────────────────────

    /**
     * Run a single cell.
     * Returns when the cell execution is fully complete (or cancelled).
     */
    public async runCell(
        notebookId: string,
        cellId: string,
        code: string,
        options: RunCellOptions = {},
    ): Promise<void> {
        const executionId = options.executionId ?? uuidv4();
        await executionQueue.enqueue(notebookId, cellId, code, executionId);
    }

    /**
     * Run all code cells in notebook order.
     * Cells are batched into the queue simultaneously; they execute serially.
     */
    public async runAll(
        notebookId: string,
        options: RunBatchOptions = {},
    ): Promise<void> {
        const cells = this.resolveCodeCells(notebookId);
        if (cells.length === 0) return;
        await this.runCellBatch(notebookId, cells, options);
    }

    /**
     * Run all code cells ABOVE (exclusive) the given target cell.
     */
    public async runAbove(
        notebookId: string,
        targetCellId: string,
        options: RunBatchOptions = {},
    ): Promise<void> {
        const allCells = this.resolveCodeCells(notebookId);
        const targetIdx = allCells.findIndex((c) => c.id === targetCellId);
        if (targetIdx <= 0) return; // nothing above

        const cells = allCells.slice(0, targetIdx);
        await this.runCellBatch(notebookId, cells, options);
    }

    /**
     * Run all code cells BELOW (exclusive) the given target cell.
     */
    public async runBelow(
        notebookId: string,
        targetCellId: string,
        options: RunBatchOptions = {},
    ): Promise<void> {
        const allCells = this.resolveCodeCells(notebookId);
        const targetIdx = allCells.findIndex((c) => c.id === targetCellId);
        if (targetIdx === -1 || targetIdx >= allCells.length - 1) return; // nothing below

        const cells = allCells.slice(targetIdx + 1);
        await this.runCellBatch(notebookId, cells, options);
    }

    /**
     * Run a specific selection of cells (by cellId) in their notebook order.
     */
    public async runSelection(
        notebookId: string,
        selectedCellIds: string[],
        options: RunBatchOptions = {},
    ): Promise<void> {
        if (selectedCellIds.length === 0) return;
        const idSet = new Set(selectedCellIds);
        const allCells = this.resolveCodeCells(notebookId);
        // Keep notebook order — filter by the selection set
        const cells = allCells.filter((c) => idSet.has(c.id));
        if (cells.length === 0) return;
        await this.runCellBatch(notebookId, cells, options);
    }

    /**
     * Also accepts explicit { cellId, code } pairs (for clients that don't use
     * NotebookManager to manage the notebook state — e.g. direct WebSocket calls).
     */
    public async runCellsExplicit(
        notebookId: string,
        cells: Array<{ cellId: string; code: string }>,
        options: RunBatchOptions = {},
    ): Promise<void> {
        if (cells.length === 0) return;
        const promises = executionQueue.enqueueMany(
            notebookId,
            cells.map((c) => ({ cellId: c.cellId, code: c.code })),
        );

        if (options.stopOnError === false) {
            // Fire-and-forget all cells regardless of errors
            await Promise.allSettled(promises);
        } else {
            // Default: stop on first error (stop remaining via drain)
            for (const p of promises) {
                const result = await p;
                if (!result.success && !result.cancelled) {
                    executionQueue.drain(notebookId);
                    break;
                }
            }
        }
    }

    /**
     * Stop all pending executions for a notebook.
     * Drains the queue (cancels pending cells) and interrupts the running kernel.
     */
    public async stopExecution(notebookId: string): Promise<void> {
        // 1. Drain queue — marks all pending cells as cancelled immediately
        executionQueue.drain(notebookId);

        // 2. Interrupt the kernel — sends SIGINT to the Python bridge
        await this.kernelManager.interruptKernel(notebookId);
    }

    // ── Internal executor (called by ExecutionQueue) ───────────────────────────

    /**
     * Execute a single queued item. Called by ExecutionQueue.
     * This is the bridge between the queue and KernelManager.
     */
    private async executeSingleCell(
        notebookId: string,
        item: QueueItem,
        queuePosition: number,
        queueSize: number,
    ): Promise<void> {
        const { cellId, executionId, code } = item;

        // Notify OutputManager to open a new accumulator
        outputManager.onExecutionStart(notebookId, cellId, executionId);

        // Emit cell:started for WebSocket broadcast
        eventBus.emit('cell:started', {
            notebookId,
            cellId,
            executionId,
            queuePosition,
            queueSize,
        });

        return new Promise<void>((resolve) => {
            this.kernelManager
                .executeCode(
                    notebookId,
                    code,
                    {
                        onOutput: (rawOutput) => {
                            outputManager.onOutput(executionId, rawOutput);
                        },
                        onComplete: (result) => {
                            const executionCount = result.execution_count ?? null;

                            // Update notebook cell state
                            notebookManager.updateCellExecutionCount(notebookId, cellId, executionCount);
                            notebookManager.updateCellOutputs(
                                notebookId,
                                cellId,
                                (result.outputs ?? []) as any,
                            );

                            // Finalize in OutputManager (emits cell:completed)
                            outputManager.onExecutionComplete(executionId, executionCount, result);

                            item.status = 'completed';
                            item.resolve({ cellId, executionId, success: true, cancelled: false });
                            resolve();
                        },
                        onError: (error) => {
                            const isInterrupt = error.includes('KeyboardInterrupt');

                            if (isInterrupt) {
                                outputManager.onExecutionInterrupted(executionId);
                            } else {
                                // Parse ename/evalue from error string if possible
                                const match = error.match(/^([^:]+):\s(.+?)(?:\n|$)/);
                                const ename = match?.[1];
                                const evalue = match?.[2];
                                outputManager.onExecutionError(executionId, error, ename, evalue);
                            }

                            item.status = isInterrupt ? 'interrupted' : 'failed';
                            item.resolve({
                                cellId,
                                executionId,
                                success: false,
                                cancelled: false,
                            });
                            resolve();
                        },
                    },
                    executionId,
                )
                .catch((err) => {
                    // Unexpected executor error
                    outputManager.onExecutionError(
                        executionId,
                        String(err),
                        'RuntimeError',
                        String(err),
                    );
                    item.status = 'failed';
                    item.resolve({ cellId, executionId, success: false, cancelled: false });
                    resolve();
                });
        });
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    /**
     * Get code cells from NotebookManager for a given notebook.
     * Falls back to empty if notebook is not open via NotebookManager.
     */
    private resolveCodeCells(notebookId: string): IpynbCell[] {
        return notebookManager.getCodeCells(notebookId);
    }

    /**
     * Enqueue an array of cells and wait for all to complete.
     * Respects stopOnError (default: true).
     */
    private async runCellBatch(
        notebookId: string,
        cells: IpynbCell[],
        options: RunBatchOptions,
    ): Promise<void> {
        const stopOnError = options.stopOnError !== false; // default true

        const entries = cells.map((c) => ({
            cellId: c.id,
            code: notebookManager.getCellSource(c),
        }));

        const promises = executionQueue.enqueueMany(notebookId, entries);

        if (!stopOnError) {
            await Promise.allSettled(promises);
            return;
        }

        // Stop on first failure
        for (const p of promises) {
            const result = await p;
            if (!result.success && !result.cancelled) {
                // Drain the rest
                executionQueue.drain(notebookId);
                break;
            }
        }
    }
}

export const executionEngine = ExecutionEngine.getInstance();
