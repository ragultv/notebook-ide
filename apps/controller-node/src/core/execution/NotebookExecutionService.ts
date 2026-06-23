/**
 * NotebookExecutionService.ts — Public execution API (replaces ExecutionEngine).
 *
 * Entry points:
 *   runCell()           — execute one cell by cellId
 *   runAll()            — execute all code cells in notebook order
 *   runAbove()          — execute all code cells above a target cell
 *   runBelow()          — execute all code cells below a target cell
 *   runSelection()      — execute a specific subset of cells in notebook order
 *   runCellsExplicit()  — execute an explicit list of { cellId, code } pairs
 *   stopExecution()     — drain queue + interrupt kernel
 *
 * Delegates queue management and execution to CellExecutionQueue.
 */

import { v4 as uuidv4 } from 'uuid';
import { KernelManager } from '../KernelManager.js';
import { eventBus } from '../events/EventBus.js';
import { outputManager } from '../output/OutputManager.js';
import { notebookManager } from '../notebook/NotebookManager.js';
import { cellExecutionQueue } from './CellExecutionQueue.js';
import type { IpynbCell } from '../notebook/NotebookManager.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RunCellOptions {
    executionId?: string;
}

export interface RunBatchOptions {
    stopOnError?: boolean;
}

// ── NotebookExecutionService ───────────────────────────────────────────────────

export class NotebookExecutionService {
    private static instance: NotebookExecutionService;

    private constructor() {
        // On kernel restart, clear outputs
        eventBus.on('kernel:restarted', ({ notebookId }: { notebookId: string }) => {
            notebookManager.clearAllOutputs(notebookId);
            outputManager.clearNotebookOutputs(notebookId);
        });
    }

    public static getInstance(): NotebookExecutionService {
        if (!NotebookExecutionService.instance) {
            NotebookExecutionService.instance = new NotebookExecutionService();
        }
        return NotebookExecutionService.instance;
    }

    // ── Public execution API ───────────────────────────────────────────────────

    public async runCell(
        notebookId: string,
        cellId: string,
        code: string,
        options: RunCellOptions = {},
    ): Promise<void> {
        const executionId = options.executionId ?? uuidv4();
        await cellExecutionQueue.enqueue(notebookId, cellId, code, executionId);
    }

    public async runAll(
        notebookId: string,
        options: RunBatchOptions = {},
    ): Promise<void> {
        const cells = this.resolveCodeCells(notebookId);
        if (cells.length === 0) return;
        await this.runCellBatch(notebookId, cells, options);
    }

    public async runAbove(
        notebookId: string,
        targetCellId: string,
        options: RunBatchOptions = {},
    ): Promise<void> {
        const allCells = this.resolveCodeCells(notebookId);
        const targetIdx = allCells.findIndex((c) => c.id === targetCellId);
        if (targetIdx <= 0) return;
        await this.runCellBatch(notebookId, allCells.slice(0, targetIdx), options);
    }

    public async runBelow(
        notebookId: string,
        targetCellId: string,
        options: RunBatchOptions = {},
    ): Promise<void> {
        const allCells = this.resolveCodeCells(notebookId);
        const targetIdx = allCells.findIndex((c) => c.id === targetCellId);
        if (targetIdx === -1 || targetIdx >= allCells.length - 1) return;
        await this.runCellBatch(notebookId, allCells.slice(targetIdx + 1), options);
    }

    public async runSelection(
        notebookId: string,
        selectedCellIds: string[],
        options: RunBatchOptions = {},
    ): Promise<void> {
        if (selectedCellIds.length === 0) return;
        const idSet = new Set(selectedCellIds);
        const cells = this.resolveCodeCells(notebookId).filter((c) => idSet.has(c.id));
        if (cells.length === 0) return;
        await this.runCellBatch(notebookId, cells, options);
    }

    /**
     * Execute an explicit list of { cellId, code } pairs (for WebSocket callers
     * that send current cell content with the execution request).
     */
    public async runCellsExplicit(
        notebookId: string,
        cells: Array<{ cellId: string; code: string }>,
        options: RunBatchOptions = {},
    ): Promise<void> {
        if (cells.length === 0) return;

        const promises = cellExecutionQueue.enqueueMany(
            notebookId,
            cells.map((c) => ({ cellId: c.cellId, code: c.code })),
        );

        if (options.stopOnError === false) {
            await Promise.allSettled(promises);
        } else {
            for (const p of promises) {
                const result = await p;
                if (!result.success && !result.cancelled) {
                    cellExecutionQueue.drain(notebookId);
                    break;
                }
            }
        }
    }

    public async stopExecution(notebookId: string): Promise<void> {
        cellExecutionQueue.drain(notebookId);
        await KernelManager.getInstance().interruptKernel(notebookId);
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private resolveCodeCells(notebookId: string): IpynbCell[] {
        return notebookManager.getCodeCells(notebookId);
    }

    private async runCellBatch(
        notebookId: string,
        cells: IpynbCell[],
        options: RunBatchOptions,
    ): Promise<void> {
        const stopOnError = options.stopOnError !== false;

        const entries = cells.map((c) => ({
            cellId: c.id,
            code:   notebookManager.getCellSource(c),
        }));

        const promises = cellExecutionQueue.enqueueMany(notebookId, entries);

        if (!stopOnError) {
            await Promise.allSettled(promises);
            return;
        }

        for (const p of promises) {
            const result = await p;
            if (!result.success && !result.cancelled) {
                cellExecutionQueue.drain(notebookId);
                break;
            }
        }
    }
}

export const notebookExecutionService = NotebookExecutionService.getInstance();
