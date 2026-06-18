/**
 * ExecutionQueue.ts — Production FIFO execution queue per notebook.
 *
 * Design:
 *   - One queue per notebookId (notebookQueues map)
 *   - Each queue is an ordered array of QueueItem
 *   - State machine: idle → running → idle | draining → idle
 *   - Draining cancels all queued (not yet running) items
 *   - Each QueueItem chains via Promise to enforce strict serial execution
 *
 * Improvements over Deepnote's bare Promise chain:
 *   - Drainable (stop mid-run-all without restarting kernel)
 *   - Named entries with cellId + executionId (UI feedback)
 *   - State machine (prevents concurrent runAll calls)
 *   - Queue snapshot API (for queue:updated events)
 */

import { v4 as uuidv4 } from 'uuid';
import { eventBus } from '../events/EventBus.js';
import type { QueueEntry, QueueStatus } from '../events/EventBus.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface QueueItem {
    cellId: string;
    executionId: string;
    code: string;
    status: QueueEntry['status'];
    queuedAt: number;
    resolve: (value: QueueItemResult) => void;
    reject: (reason?: any) => void;
}

export interface QueueItemResult {
    cellId: string;
    executionId: string;
    success: boolean;
    cancelled: boolean;
}

interface NotebookQueue {
    items: QueueItem[];
    status: QueueStatus;
    /** Chain promise — next item waits for this to settle before running */
    chain: Promise<void>;
}

// ── ExecutionQueue ─────────────────────────────────────────────────────────────

export class ExecutionQueue {
    private static instance: ExecutionQueue;

    /** Per-notebook queues. Key: notebookId */
    private queues: Map<string, NotebookQueue> = new Map();

    /**
     * External executor — provided by ExecutionEngine.
     * Called when the queue dequeues an item for execution.
     * Must resolve when the cell execution is fully complete (or failed/interrupted).
     */
    private executor!: (
        notebookId: string,
        item: QueueItem,
        queuePosition: number,
        queueSize: number,
    ) => Promise<void>;

    private constructor() {}

    public static getInstance(): ExecutionQueue {
        if (!ExecutionQueue.instance) {
            ExecutionQueue.instance = new ExecutionQueue();
        }
        return ExecutionQueue.instance;
    }

    // ── Setup ──────────────────────────────────────────────────────────────────

    public setExecutor(
        fn: (
            notebookId: string,
            item: QueueItem,
            queuePosition: number,
            queueSize: number,
        ) => Promise<void>,
    ): void {
        this.executor = fn;
    }

    // ── Queue operations ───────────────────────────────────────────────────────

    /**
     * Enqueue a single cell for execution.
     * Returns a promise that resolves when the cell is done (success or failure).
     * Rejects only on unexpected executor-level errors (never on cell errors).
     */
    public enqueue(
        notebookId: string,
        cellId: string,
        code: string,
        providedExecutionId?: string,
    ): Promise<QueueItemResult> {
        const q = this.getOrCreateQueue(notebookId);

        if (q.status === 'draining') {
            // Queue is being cancelled — reject immediately
            return Promise.resolve({
                cellId,
                executionId: providedExecutionId ?? uuidv4(),
                success: false,
                cancelled: true,
            });
        }

        return new Promise<QueueItemResult>((resolve, reject) => {
            const item: QueueItem = {
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

    /**
     * Enqueue multiple cells in order (Run All / Run Above / Run Below / Run Selection).
     * Returns an array of promises in input order.
     */
    public enqueueMany(
        notebookId: string,
        cells: Array<{ cellId: string; code: string; executionId?: string }>,
    ): Promise<QueueItemResult>[] {
        return cells.map((c) => this.enqueue(notebookId, c.cellId, c.code, c.executionId));
    }

    /**
     * Drain the queue — cancel all pending (queued) items immediately.
     * The currently running item is NOT cancelled here; call KernelManager.interrupt separately.
     */
    public drain(notebookId: string): void {
        const q = this.queues.get(notebookId);
        if (!q) return;

        q.status = 'draining';

        // Cancel every item that hasn't started yet
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

        // Clear the queued items; keep any running item for natural completion
        q.items = q.items.filter((i) => i.status === 'running');
        this.emitQueueUpdated(notebookId);
    }

    /** Get a snapshot of the current queue state for a notebook. */
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

    // ── Internal scheduler ─────────────────────────────────────────────────────

    private getOrCreateQueue(notebookId: string): NotebookQueue {
        if (!this.queues.has(notebookId)) {
            this.queues.set(notebookId, {
                items: [],
                status: 'idle',
                chain: Promise.resolve(),
            });
        }
        return this.queues.get(notebookId)!;
    }

    /**
     * Attach the next pending item onto the serial chain.
     * Only one item runs at a time per notebook.
     */
    private scheduleNext(notebookId: string): void {
        const q = this.queues.get(notebookId);
        if (!q) return;
        if (q.status === 'running') return; // already processing
        if (q.status === 'draining') return; // cancelled
        if (q.items.every((i) => i.status !== 'queued')) return; // nothing pending

        q.chain = q.chain.then(async () => {
            await this.processNext(notebookId);
        });
    }

    private async processNext(notebookId: string): Promise<void> {
        const q = this.queues.get(notebookId);
        if (!q) return;

        // Find next queued item
        const item = q.items.find((i) => i.status === 'queued');
        if (!item) {
            // Nothing left — queue goes idle
            q.status = 'idle';
            this.emitQueueUpdated(notebookId);
            return;
        }

        // Compute position info before marking running
        const queueSize = q.items.filter(
            (i) => i.status === 'queued' || i.status === 'running',
        ).length;
        const queuePosition = q.items.indexOf(item);

        item.status = 'running';
        q.status = 'running';
        this.emitQueueUpdated(notebookId);

        let wasDraining = false;
        try {
            await this.executor(notebookId, item, queuePosition, queueSize);
        } catch (err) {
            // Executor threw unexpectedly — fail this item but continue the queue
            console.error(`[ExecutionQueue] Executor error for cell ${item.cellId}:`, err);
            item.status = 'failed';
            item.resolve({ cellId: item.cellId, executionId: item.executionId, success: false, cancelled: false });
        } finally {
            // Capture drain flag before mutating status
            wasDraining = (this.queues.get(notebookId)?.status as string) === 'draining';
            // Remove the completed item from the queue
            const idx = q.items.indexOf(item);
            if (idx !== -1) q.items.splice(idx, 1);
        }

        // Continue if there are more items
        const hasMore = q.items.some((i) => i.status === 'queued');
        if (hasMore && !wasDraining) {
            q.status = 'idle'; // briefly idle before next starts
            await this.processNext(notebookId);
        } else {
            q.status = 'idle';
            this.emitQueueUpdated(notebookId);
        }
    }

    private emitQueueUpdated(notebookId: string): void {
        const snap = this.getQueueSnapshot(notebookId);
        const running = snap.entries.find((e) => e.status === 'running');
        eventBus.emit('queue:updated', {
            notebookId,
            queue: snap.entries,
            status: snap.status,
            activeExecutionId: running?.executionId ?? null,
        });
    }
}

export const executionQueue = ExecutionQueue.getInstance();
