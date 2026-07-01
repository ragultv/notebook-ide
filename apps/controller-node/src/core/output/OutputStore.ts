/**
 * OutputStore.ts — In-memory store for cell outputs, kernel sessions,
 * and notebook metadata.
 *
 * Replaces the previous SQLite-backed implementation (octopod.db).
 * All data is transient — outputs are persisted by NotebookManager via .ipynb files.
 */

import type { NotebookOutput } from '../events/EventBus.js';

// ── Row types (kept for API compatibility) ────────────────────────────────────

export interface NotebookRow {
    id: string;
    path: string;
    name: string;
    last_saved_at: string | null;
    opened_at: string;
}

export interface CellOutputRow {
    id: number;
    notebook_id: string;
    cell_id: string;
    execution_id: string;
    execution_count: number | null;
    outputs_json: string;
    status: 'running' | 'completed' | 'failed' | 'interrupted';
    started_at: string;
    completed_at: string | null;
    duration_ms: number | null;
}

export interface KernelSessionRow {
    notebook_id: string;
    kernel_id: string;
    started_at: string;
    last_active_at: string;
    status: 'idle' | 'busy' | 'crashed' | 'stopped';
}

// ── Internal state ─────────────────────────────────────────────────────────────

interface ActiveExecution {
    outputs: NotebookOutput[];
    status: 'running' | 'completed' | 'failed' | 'interrupted';
    execution_count: number | null;
    started_at: string;
    completed_at: string | null;
    duration_ms: number | null;
}

// ── OutputStore ────────────────────────────────────────────────────────────────

export class OutputStore {
    private static instance: OutputStore;

    private notebooks: Map<string, NotebookRow> = new Map();
    private cellOutputs: Map<string, Map<string, ActiveExecution>> = new Map(); // notebookId → cellId → execution
    private kernelSessions: Map<string, KernelSessionRow> = new Map();
    private rowCounter = 0;

    private constructor() {}

    public static getInstance(): OutputStore {
        if (!OutputStore.instance) {
            OutputStore.instance = new OutputStore();
        }
        return OutputStore.instance;
    }

    public initialize(): void {
        // no-op: in-memory store needs no initialization
    }

    public close(): void {
        // no-op: nothing to close
        this.notebooks.clear();
        this.cellOutputs.clear();
        this.kernelSessions.clear();
    }

    // ── Notebook CRUD ──────────────────────────────────────────────────────────

    public upsertNotebook(id: string, filePath: string, name: string): void {
        const existing = this.notebooks.get(id);
        this.notebooks.set(id, {
            id,
            path: filePath,
            name,
            last_saved_at: existing?.last_saved_at ?? null,
            opened_at: existing?.opened_at ?? new Date().toISOString(),
        });
    }

    public markNotebookSaved(id: string): void {
        const nb = this.notebooks.get(id);
        if (nb) nb.last_saved_at = new Date().toISOString();
    }

    public removeNotebook(id: string): void {
        this.notebooks.delete(id);
        this.cellOutputs.delete(id);
        this.kernelSessions.delete(id);
    }

    public getNotebook(id: string): NotebookRow | null {
        return this.notebooks.get(id) ?? null;
    }

    public getAllNotebooks(): NotebookRow[] {
        return [...this.notebooks.values()].sort(
            (a, b) => b.opened_at.localeCompare(a.opened_at),
        );
    }

    // ── Cell outputs CRUD ──────────────────────────────────────────────────────

    public startCellExecution(notebookId: string, cellId: string, _executionId: string): void {
        let cells = this.cellOutputs.get(notebookId);
        if (!cells) {
            cells = new Map();
            this.cellOutputs.set(notebookId, cells);
        }
        cells.set(cellId, {
            outputs: [],
            status: 'running',
            execution_count: null,
            started_at: new Date().toISOString(),
            completed_at: null,
            duration_ms: null,
        });
    }

    public appendOutput(
        notebookId: string,
        cellId: string,
        _executionId: string,
        output: NotebookOutput,
    ): void {
        this.cellOutputs.get(notebookId)?.get(cellId)?.outputs.push(output);
    }

    public completeCellExecution(
        notebookId: string,
        cellId: string,
        _executionId: string,
        status: 'completed' | 'failed' | 'interrupted',
        executionCount: number | null,
        durationMs: number,
        finalOutputs: NotebookOutput[],
    ): void {
        const exec = this.cellOutputs.get(notebookId)?.get(cellId);
        if (!exec) return;
        exec.status = status;
        exec.execution_count = executionCount;
        exec.completed_at = new Date().toISOString();
        exec.duration_ms = durationMs;
        exec.outputs = finalOutputs;
    }

    public getLatestCellOutputs(notebookId: string, cellId: string): NotebookOutput[] {
        return this.cellOutputs.get(notebookId)?.get(cellId)?.outputs ?? [];
    }

    public getNotebookOutputs(notebookId: string): CellOutputRow[] {
        const cells = this.cellOutputs.get(notebookId);
        if (!cells) return [];
        const rows: CellOutputRow[] = [];
        for (const [cellId, exec] of cells.entries()) {
            if (exec.status === 'running') continue;
            rows.push({
                id: ++this.rowCounter,
                notebook_id: notebookId,
                cell_id: cellId,
                execution_id: '',
                execution_count: exec.execution_count,
                outputs_json: JSON.stringify(exec.outputs),
                status: exec.status,
                started_at: exec.started_at,
                completed_at: exec.completed_at,
                duration_ms: exec.duration_ms,
            });
        }
        return rows;
    }

    public clearNotebookOutputs(notebookId: string): void {
        this.cellOutputs.delete(notebookId);
    }

    // ── Kernel sessions ────────────────────────────────────────────────────────

    public upsertKernelSession(
        notebookId: string,
        kernelId: string,
        status: KernelSessionRow['status'] = 'idle',
    ): void {
        const now = new Date().toISOString();
        const existing = this.kernelSessions.get(notebookId);
        this.kernelSessions.set(notebookId, {
            notebook_id: notebookId,
            kernel_id: kernelId,
            started_at: existing?.started_at ?? now,
            last_active_at: now,
            status,
        });
    }

    public updateKernelStatus(notebookId: string, status: KernelSessionRow['status']): void {
        const session = this.kernelSessions.get(notebookId);
        if (!session) return;
        session.status = status;
        session.last_active_at = new Date().toISOString();
    }

    public getKernelSession(notebookId: string): KernelSessionRow | null {
        return this.kernelSessions.get(notebookId) ?? null;
    }

    public removeKernelSession(notebookId: string): void {
        this.kernelSessions.delete(notebookId);
    }
}

export const outputStore = OutputStore.getInstance();
