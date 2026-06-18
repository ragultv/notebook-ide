/**
 * EventBus.ts — Typed, singleton event bus for the Octopod runtime.
 *
 * All notebook and kernel events are routed through here.
 * This decouples producers (ExecutionEngine, KernelManager) from
 * consumers (WebSocket routes, OutputManager, PersistenceManager).
 *
 * Usage:
 *   import { eventBus } from './EventBus.js';
 *   eventBus.emit('cell:completed', { ... });
 *   eventBus.on('cell:completed', (e) => { ... });
 */

import { EventEmitter } from 'events';

// ── Output types (Jupyter-compatible) ─────────────────────────────────────────

export interface StreamOutput {
    output_type: 'stream';
    name: 'stdout' | 'stderr';
    text: string;
}

export interface ExecuteResultOutput {
    output_type: 'execute_result';
    execution_count: number | null;
    data: Record<string, string>;
    metadata: Record<string, unknown>;
}

export interface DisplayDataOutput {
    output_type: 'display_data';
    data: Record<string, string>;
    metadata: Record<string, unknown>;
}

export interface ErrorOutput {
    output_type: 'error';
    ename: string;
    evalue: string;
    traceback: string[];
}

export type NotebookOutput = StreamOutput | ExecuteResultOutput | DisplayDataOutput | ErrorOutput;

// ── Queue entry ────────────────────────────────────────────────────────────────

export type CellStatus = 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
export type QueueStatus = 'idle' | 'running' | 'draining';

export interface QueueEntry {
    cellId: string;
    executionId: string;
    status: CellStatus;
    code: string;
    queuedAt: number;
}

// ── Event payload types ────────────────────────────────────────────────────────

export interface CellStartedEvent {
    notebookId: string;
    cellId: string;
    executionId: string;
    queuePosition: number;  // 0-based index in the current run batch
    queueSize: number;       // total cells in current run batch
}

export interface CellCompletedEvent {
    notebookId: string;
    cellId: string;
    executionId: string;
    executionCount: number | null;
    durationMs: number;
    success: boolean;
    outputs: NotebookOutput[];
}

export interface CellFailedEvent {
    notebookId: string;
    cellId: string;
    executionId: string;
    error: string;
    ename?: string;
    evalue?: string;
    traceback?: string[];
    outputs: NotebookOutput[];
    durationMs: number;
}

export interface CellInterruptedEvent {
    notebookId: string;
    cellId: string;
    executionId: string;
}

export interface CellCancelledEvent {
    notebookId: string;
    cellId: string;
    executionId: string;
}

export interface OutputReceivedEvent {
    notebookId: string;
    cellId: string;
    executionId: string;
    output: NotebookOutput;
}

export interface QueueUpdatedEvent {
    notebookId: string;
    queue: QueueEntry[];
    status: QueueStatus;
    activeExecutionId: string | null;
}

export interface KernelStartedEvent {
    notebookId: string;
    kernelId: string;
}

export interface KernelRestartedEvent {
    notebookId: string;
    kernelId: string;
}

export interface KernelCrashedEvent {
    notebookId: string;
    code: number | null;
}

export interface KernelReconnectedEvent {
    notebookId: string;
}

export interface KernelStatusChangedEvent {
    notebookId: string;
    status: 'idle' | 'busy' | 'starting' | 'error' | 'dead';
}

export interface NotebookSavedEvent {
    notebookId: string;
    path: string;
    trigger: 'manual' | 'autosave' | 'execution_complete';
}

export interface NotebookOpenedEvent {
    notebookId: string;
    path: string;
    cellCount: number;
}

export interface NotebookClosedEvent {
    notebookId: string;
    path: string;
}

// ── Typed event map ────────────────────────────────────────────────────────────

export interface OctopodEvents {
    // Cell lifecycle
    'cell:started':       [CellStartedEvent];
    'cell:completed':     [CellCompletedEvent];
    'cell:failed':        [CellFailedEvent];
    'cell:interrupted':   [CellInterruptedEvent];
    'cell:cancelled':     [CellCancelledEvent];

    // Streaming output
    'output:received':    [OutputReceivedEvent];

    // Queue state
    'queue:updated':      [QueueUpdatedEvent];

    // Kernel lifecycle
    'kernel:started':     [KernelStartedEvent];
    'kernel:restarted':   [KernelRestartedEvent];
    'kernel:crashed':     [KernelCrashedEvent];
    'kernel:reconnected': [KernelReconnectedEvent];
    'kernel:status':      [KernelStatusChangedEvent];

    // Notebook lifecycle
    'notebook:saved':     [NotebookSavedEvent];
    'notebook:opened':    [NotebookOpenedEvent];
    'notebook:closed':    [NotebookClosedEvent];
}

// ── Implementation ─────────────────────────────────────────────────────────────

class TypedEventBus extends EventEmitter {
    emit<K extends keyof OctopodEvents>(event: K, ...args: OctopodEvents[K]): boolean {
        return super.emit(event as string, ...args);
    }

    on<K extends keyof OctopodEvents>(
        event: K,
        listener: (...args: OctopodEvents[K]) => void,
    ): this {
        return super.on(event as string, listener as (...args: any[]) => void);
    }

    once<K extends keyof OctopodEvents>(
        event: K,
        listener: (...args: OctopodEvents[K]) => void,
    ): this {
        return super.once(event as string, listener as (...args: any[]) => void);
    }

    off<K extends keyof OctopodEvents>(
        event: K,
        listener: (...args: OctopodEvents[K]) => void,
    ): this {
        return super.off(event as string, listener as (...args: any[]) => void);
    }
}

/** Global singleton — import this everywhere, never construct a new one. */
export const eventBus = new TypedEventBus();
export { TypedEventBus };
