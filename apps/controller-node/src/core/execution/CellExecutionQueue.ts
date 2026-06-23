/**
 * CellExecutionQueue.ts — Global FIFO cell execution queue (VS Code-like layer).
 *
 * Replaces the old ExecutionQueue + ExecutionEngine.executeSingleCell() split.
 * This class owns both the queue mechanics and the execution path:
 *
 *   Preferred path: NotebookTextModel + PythonProcessKernel (full VS Code state machine)
 *   Fallback path:  KernelManager.executeCode() (direct, no TextModel required)
 *
 * Design mirrors old ExecutionQueue:
 *   - One queue per notebookId
 *   - State machine: idle → running → idle | draining → idle
 *   - Serial execution per notebook (parallel across notebooks)
 *   - drain() cancels pending items without killing the running cell
 */

import { v4 as uuidv4 } from 'uuid';
import { KernelManager } from '../KernelManager.js';
import { eventBus } from '../events/EventBus.js';
import { outputManager } from '../output/OutputManager.js';
import { notebookManager } from '../notebook/NotebookManager.js';
import { notebookService } from '../notebook/NotebookService.js';
import { notebookKernelService } from '../kernel/NotebookKernelService.js';
import { notebookExecutionStateService } from '../state/NotebookExecutionStateService.js';
import type { QueueEntry, QueueStatus } from '../events/EventBus.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CellQueueItem {
    cellId: string;
    executionId: string;
    code: string;
    status: QueueEntry['status'];
    queuedAt: number;
    resolve: (value: CellQueueResult) => void;
    reject:  (reason?: any) => void;
}

export interface CellQueueResult {
    cellId: string;
    executionId: string;
    success: boolean;
    cancelled: boolean;
}

interface NotebookQueue {
    items: CellQueueItem[];
    status: QueueStatus;
    chain: Promise<void>;
}

// ── CellExecutionQueue ─────────────────────────────────────────────────────────

export class CellExecutionQueue {
    private static instance: CellExecutionQueue;
    private queues: Map<string, NotebookQueue> = new Map();

    private constructor() {}

    public static getInstance(): CellExecutionQueue {
        if (!CellExecutionQueue.instance) {
            CellExecutionQueue.instance = new CellExecutionQueue();
        }
        return CellExecutionQueue.instance;
    }

    // ── Queue operations ───────────────────────────────────────────────────────

    public enqueue(
        notebookId: string,
        cellId: string,
        code: string,
        providedExecutionId?: string,
    ): Promise<CellQueueResult> {
        const q = this.getOrCreateQueue(notebookId);

        if (q.status === 'draining') {
            return Promise.resolve({
                cellId,
                executionId: providedExecutionId ?? uuidv4(),
                success: false,
                cancelled: true,
            });
        }

        return new Promise<CellQueueResult>((resolve, reject) => {
            const item: CellQueueItem = {
                cellId,
                executionId: providedExecutionId ?? uuidv4(),
                code,
                status: 'queued',
                queuedAt: Date.now(),
                resolve,
                reject,
            };
            q.items.push(item);
            this.emitQueueUpdated(notebookId);
            this.scheduleNext(notebookId);
        });
    }

    public enqueueMany(
        notebookId: string,
        cells: Array<{ cellId: string; code: string; executionId?: string }>,
    ): Promise<CellQueueResult>[] {
        return cells.map((c) => this.enqueue(notebookId, c.cellId, c.code, c.executionId));
    }

    public drain(notebookId: string): void {
        const q = this.queues.get(notebookId);
        if (!q) return;

        q.status = 'draining';

        const pending = q.items.filter((i) => i.status === 'queued');
        for (const item of pending) {
            item.status = 'cancelled';
            eventBus.emit('cell:cancelled', {
                notebookId,
                cellId: item.cellId,
                executionId: item.executionId,
            });
            item.resolve({ cellId: item.cellId, executionId: item.executionId, success: false, cancelled: true });
        }

        q.items = q.items.filter((i) => i.status === 'running');
        this.emitQueueUpdated(notebookId);
    }

    public getQueueSnapshot(notebookId: string): { entries: QueueEntry[]; status: QueueStatus } {
        const q = this.queues.get(notebookId);
        if (!q) return { entries: [], status: 'idle' };
        return {
            status: q.status,
            entries: q.items.map((i) => ({
                cellId: i.cellId,
                executionId: i.executionId,
                status: i.status,
                code: i.code,
                queuedAt: i.queuedAt,
            })),
        };
    }

    public isRunning(notebookId: string): boolean {
        return this.queues.get(notebookId)?.status === 'running';
    }

    public queueSize(notebookId: string): number {
        return this.queues.get(notebookId)?.items.length ?? 0;
    }

    // ── Scheduler ──────────────────────────────────────────────────────────────

    private getOrCreateQueue(notebookId: string): NotebookQueue {
        if (!this.queues.has(notebookId)) {
            this.queues.set(notebookId, { items: [], status: 'idle', chain: Promise.resolve() });
        }
        return this.queues.get(notebookId)!;
    }

    private scheduleNext(notebookId: string): void {
        const q = this.queues.get(notebookId);
        if (!q) return;
        if (q.status === 'running') return;
        if (q.status === 'draining') return;
        if (q.items.every((i) => i.status !== 'queued')) return;

        q.chain = q.chain.then(async () => {
            await this.processNext(notebookId);
        });
    }

    private async processNext(notebookId: string): Promise<void> {
        const q = this.queues.get(notebookId);
        if (!q) return;

        const item = q.items.find((i) => i.status === 'queued');
        if (!item) {
            q.status = 'idle';
            this.emitQueueUpdated(notebookId);
            return;
        }

        const queueSize = q.items.filter((i) => i.status === 'queued' || i.status === 'running').length;
        const queuePosition = q.items.indexOf(item);

        item.status = 'running';
        q.status = 'running';
        this.emitQueueUpdated(notebookId);

        let wasDraining = false;
        try {
            await this.executeCell(notebookId, item, queuePosition, queueSize);
        } catch (err) {
            console.error(`[CellExecutionQueue] Executor error for cell ${item.cellId}:`, err);
            item.status = 'failed';
            item.resolve({ cellId: item.cellId, executionId: item.executionId, success: false, cancelled: false });
        } finally {
            wasDraining = (this.queues.get(notebookId)?.status as string) === 'draining';
            const idx = q.items.indexOf(item);
            if (idx !== -1) q.items.splice(idx, 1);
        }

        const hasMore = q.items.some((i) => i.status === 'queued');
        if (hasMore && !wasDraining) {
            q.status = 'idle';
            await this.processNext(notebookId);
        } else {
            q.status = 'idle';
            this.emitQueueUpdated(notebookId);
        }
    }

    // ── Cell executor ──────────────────────────────────────────────────────────

    /**
     * Try the VS Code kernel path first; fall back to direct KernelManager when
     * the TextModel or a registered kernel controller is unavailable.
     */
    private async executeCell(
        notebookId: string,
        item: CellQueueItem,
        queuePosition: number,
        queueSize: number,
    ): Promise<void> {
        const { cellId, executionId, code } = item;

        // ── VS Code-like path ──────────────────────────────────────────────────
        const model      = notebookService.getNotebookTextModel(notebookId);
        const cell       = model?.cells.find((c) => c.cellId === cellId);
        const controller = cell ? notebookKernelService.getKernelForNotebook(notebookId) : undefined;

        if (model && cell && controller) {
            try {
                const cellExecution = notebookExecutionStateService.createCellExecution(
                    notebookId, cell.handle, executionId,
                );
                cellExecution.initialize();

                await controller.executeNotebookCellsRequest(notebookId, [cell.handle]);

                item.status = cellExecution.isCompleted ? 'completed' : 'failed';
                item.resolve({
                    cellId,
                    executionId,
                    success: item.status === 'completed',
                    cancelled: false,
                });
            } catch (err) {
                outputManager.onExecutionError(executionId, String(err), 'RuntimeError', String(err));
                item.status = 'failed';
                item.resolve({ cellId, executionId, success: false, cancelled: false });
            }
            return;
        }

        // ── Fallback: direct KernelManager path ────────────────────────────────
        outputManager.onExecutionStart(notebookId, cellId, executionId);
        eventBus.emit('cell:started', { notebookId, cellId, executionId, queuePosition, queueSize });

        return new Promise<void>((resolve) => {
            KernelManager.getInstance()
                .executeCode(
                    notebookId,
                    code,
                    {
                        onOutput: (rawOutput) => {
                            outputManager.onOutput(executionId, rawOutput);
                        },
                        onComplete: (result) => {
                            const executionCount = result.execution_count ?? null;
                            notebookManager.updateCellExecutionCount(notebookId, cellId, executionCount);
                            notebookManager.updateCellOutputs(notebookId, cellId, (result.outputs ?? []) as any);
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
                                const match = error.match(/^([^:]+):\s(.+?)(?:\n|$)/);
                                outputManager.onExecutionError(executionId, error, match?.[1], match?.[2]);
                            }
                            item.status = isInterrupt ? 'interrupted' : 'failed';
                            item.resolve({ cellId, executionId, success: false, cancelled: false });
                            resolve();
                        },
                    },
                    executionId,
                )
                .catch((err) => {
                    outputManager.onExecutionError(executionId, String(err), 'RuntimeError', String(err));
                    item.status = 'failed';
                    item.resolve({ cellId, executionId, success: false, cancelled: false });
                    resolve();
                });
        });
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private emitQueueUpdated(notebookId: string): void {
        const snap = this.getQueueSnapshot(notebookId);
        const running = snap.entries.find((e) => e.status === 'running');
        eventBus.emit('queue:updated', {
            notebookId,
            queue:             snap.entries,
            status:            snap.status,
            activeExecutionId: running?.executionId ?? null,
        });
    }
}

export const cellExecutionQueue = CellExecutionQueue.getInstance();
