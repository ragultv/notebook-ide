/**
 * OutputStore.ts — SQLite-backed persistence for cell outputs, kernel sessions,
 * and notebook metadata.
 *
 * Database: userData/octopod.db  (single file, set via USER_DATA_DIR env var)
 *
 * Schema:
 *   notebooks       — tracks open/saved notebooks
 *   cell_outputs    — per-cell execution outputs (JSON blobs)
 *   kernel_sessions — tracks kernel↔notebook bindings
 *
 * Uses better-sqlite3 (synchronous) — synchronous is intentional for v1.
 * Move to worker_threads when multi-notebook concurrency exceeds ~10k cells.
 */

import Database from 'better-sqlite3';
import fs from 'fs-extra';
import path from 'path';
import type { NotebookOutput } from '../events/EventBus.js';

// ── Database path ──────────────────────────────────────────────────────────────

function resolveDbPath(): string {
    const userDataDir = process.env.USER_DATA_DIR || process.env.DATA_DIR || './data';
    fs.mkdirSync(userDataDir, { recursive: true });
    return path.resolve(userDataDir, 'octopod.db');
}

// ── Row types ──────────────────────────────────────────────────────────────────

export interface NotebookRow {
    id: string;           // notebookId (virtual, usually file path normalized)
    path: string;         // absolute OS path to .ipynb
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
    outputs_json: string;       // JSON.stringify(NotebookOutput[])
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

// ── OutputStore ────────────────────────────────────────────────────────────────

export class OutputStore {
    private static instance: OutputStore;
    private db!: Database.Database;
    private dbPath: string;

    private constructor() {
        this.dbPath = resolveDbPath();
    }

    public static getInstance(): OutputStore {
        if (!OutputStore.instance) {
            OutputStore.instance = new OutputStore();
        }
        return OutputStore.instance;
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    public initialize(): void {
        this.db = new Database(this.dbPath);

        // WAL mode: faster writes, better concurrency for reads
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = NORMAL');
        this.db.pragma('foreign_keys = ON');

        this.runMigrations();
        console.log(`[OutputStore] Initialized at ${this.dbPath}`);
    }

    public close(): void {
        if (this.db?.open) {
            this.db.close();
        }
    }

    private runMigrations(): void {
        // ── Version table ──
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER NOT NULL DEFAULT 0
            );
        `);

        const row = this.db.prepare('SELECT version FROM schema_version').get() as
            | { version: number }
            | undefined;
        const currentVersion = row?.version ?? 0;

        if (currentVersion < 1) {
            this.db.exec(`
                -- Notebooks registry
                CREATE TABLE IF NOT EXISTS notebooks (
                    id           TEXT PRIMARY KEY,
                    path         TEXT NOT NULL UNIQUE,
                    name         TEXT NOT NULL,
                    last_saved_at TEXT,
                    opened_at    TEXT NOT NULL DEFAULT (datetime('now'))
                );

                -- Cell outputs: one row per (notebook_id, cell_id, execution_id)
                CREATE TABLE IF NOT EXISTS cell_outputs (
                    id             INTEGER PRIMARY KEY AUTOINCREMENT,
                    notebook_id    TEXT NOT NULL,
                    cell_id        TEXT NOT NULL,
                    execution_id   TEXT NOT NULL,
                    execution_count INTEGER,
                    outputs_json   TEXT NOT NULL DEFAULT '[]',
                    status         TEXT NOT NULL DEFAULT 'running',
                    started_at     TEXT NOT NULL DEFAULT (datetime('now')),
                    completed_at   TEXT,
                    duration_ms    INTEGER,
                    UNIQUE(notebook_id, cell_id, execution_id)
                );

                CREATE INDEX IF NOT EXISTS idx_cell_outputs_notebook
                    ON cell_outputs(notebook_id);
                CREATE INDEX IF NOT EXISTS idx_cell_outputs_cell
                    ON cell_outputs(notebook_id, cell_id);

                -- Kernel sessions
                CREATE TABLE IF NOT EXISTS kernel_sessions (
                    notebook_id     TEXT PRIMARY KEY,
                    kernel_id       TEXT NOT NULL,
                    started_at      TEXT NOT NULL DEFAULT (datetime('now')),
                    last_active_at  TEXT NOT NULL DEFAULT (datetime('now')),
                    status          TEXT NOT NULL DEFAULT 'idle'
                );

                INSERT OR IGNORE INTO schema_version(version) VALUES (0);
                UPDATE schema_version SET version = 1;
            `);
        }

        // Future migrations: if (currentVersion < 2) { ... }
    }

    // ── Notebook CRUD ──────────────────────────────────────────────────────────

    public upsertNotebook(id: string, filePath: string, name: string): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO notebooks (id, path, name, opened_at, last_saved_at)
            VALUES (@id, @path, @name, datetime('now'), (SELECT last_saved_at FROM notebooks WHERE path = @path))
        `).run({ id, path: filePath, name });
    }

    public markNotebookSaved(id: string): void {
        this.db.prepare(`
            UPDATE notebooks SET last_saved_at = datetime('now') WHERE id = @id
        `).run({ id });
    }

    public removeNotebook(id: string): void {
        // Cascade: remove outputs associated with this notebook
        this.db.transaction(() => {
            this.db.prepare('DELETE FROM cell_outputs WHERE notebook_id = @id').run({ id });
            this.db.prepare('DELETE FROM kernel_sessions WHERE notebook_id = @id').run({ id });
            this.db.prepare('DELETE FROM notebooks WHERE id = @id').run({ id });
        })();
    }

    public getNotebook(id: string): NotebookRow | null {
        return (this.db.prepare('SELECT * FROM notebooks WHERE id = @id').get({ id }) as
            NotebookRow | undefined) ?? null;
    }

    public getAllNotebooks(): NotebookRow[] {
        return this.db.prepare('SELECT * FROM notebooks ORDER BY opened_at DESC').all() as NotebookRow[];
    }

    // ── Cell outputs CRUD ──────────────────────────────────────────────────────

    /** Called at execution start — creates a 'running' row. */
    public startCellExecution(
        notebookId: string,
        cellId: string,
        executionId: string,
    ): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO cell_outputs
                (notebook_id, cell_id, execution_id, outputs_json, status, started_at)
            VALUES
                (@notebookId, @cellId, @executionId, '[]', 'running', datetime('now'))
        `).run({ notebookId, cellId, executionId });
    }

    /** Append one output to the JSON array (streaming). */
    public appendOutput(
        notebookId: string,
        cellId: string,
        executionId: string,
        output: NotebookOutput,
    ): void {
        const row = this.db.prepare(`
            SELECT outputs_json FROM cell_outputs
            WHERE notebook_id = @notebookId AND cell_id = @cellId AND execution_id = @executionId
        `).get({ notebookId, cellId, executionId }) as { outputs_json: string } | undefined;

        if (!row) return;

        const outputs: NotebookOutput[] = JSON.parse(row.outputs_json);
        outputs.push(output);

        this.db.prepare(`
            UPDATE cell_outputs
            SET outputs_json = @json
            WHERE notebook_id = @notebookId AND cell_id = @cellId AND execution_id = @executionId
        `).run({ json: JSON.stringify(outputs), notebookId, cellId, executionId });
    }

    /** Called at execution completion — sets final status, count, timing. */
    public completeCellExecution(
        notebookId: string,
        cellId: string,
        executionId: string,
        status: 'completed' | 'failed' | 'interrupted',
        executionCount: number | null,
        durationMs: number,
        finalOutputs: NotebookOutput[],
    ): void {
        this.db.prepare(`
            UPDATE cell_outputs SET
                status          = @status,
                execution_count = @executionCount,
                completed_at    = datetime('now'),
                duration_ms     = @durationMs,
                outputs_json    = @json
            WHERE notebook_id = @notebookId AND cell_id = @cellId AND execution_id = @executionId
        `).run({
            status,
            executionCount,
            durationMs,
            json: JSON.stringify(finalOutputs),
            notebookId,
            cellId,
            executionId,
        });
    }

    /** Get latest outputs for a cell (most recent execution). */
    public getLatestCellOutputs(notebookId: string, cellId: string): NotebookOutput[] {
        const row = this.db.prepare(`
            SELECT outputs_json FROM cell_outputs
            WHERE notebook_id = @notebookId AND cell_id = @cellId
            ORDER BY id DESC LIMIT 1
        `).get({ notebookId, cellId }) as { outputs_json: string } | undefined;

        if (!row) return [];
        try {
            return JSON.parse(row.outputs_json) as NotebookOutput[];
        } catch {
            return [];
        }
    }

    /** Get all cell output rows for a notebook (for restoring state on open). */
    public getNotebookOutputs(notebookId: string): CellOutputRow[] {
        return this.db.prepare(`
            SELECT * FROM (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY cell_id ORDER BY id DESC) as rn
                FROM cell_outputs
                WHERE notebook_id = @notebookId AND status != 'running'
            ) WHERE rn = 1
            ORDER BY id ASC
        `).all({ notebookId }) as CellOutputRow[];
    }

    /** Clear all persisted outputs for a notebook (e.g., after kernel restart). */
    public clearNotebookOutputs(notebookId: string): void {
        this.db.prepare('DELETE FROM cell_outputs WHERE notebook_id = @notebookId').run({ notebookId });
    }

    // ── Kernel sessions ────────────────────────────────────────────────────────

    public upsertKernelSession(
        notebookId: string,
        kernelId: string,
        status: KernelSessionRow['status'] = 'idle',
    ): void {
        this.db.prepare(`
            INSERT INTO kernel_sessions (notebook_id, kernel_id, started_at, last_active_at, status)
            VALUES (@notebookId, @kernelId, datetime('now'), datetime('now'), @status)
            ON CONFLICT(notebook_id) DO UPDATE SET
                kernel_id      = excluded.kernel_id,
                last_active_at = datetime('now'),
                status         = excluded.status
        `).run({ notebookId, kernelId, status });
    }

    public updateKernelStatus(
        notebookId: string,
        status: KernelSessionRow['status'],
    ): void {
        this.db.prepare(`
            UPDATE kernel_sessions
            SET status = @status, last_active_at = datetime('now')
            WHERE notebook_id = @notebookId
        `).run({ notebookId, status });
    }

    public getKernelSession(notebookId: string): KernelSessionRow | null {
        return (
            this.db
                .prepare('SELECT * FROM kernel_sessions WHERE notebook_id = @notebookId')
                .get({ notebookId }) as KernelSessionRow | undefined
        ) ?? null;
    }

    public removeKernelSession(notebookId: string): void {
        this.db.prepare('DELETE FROM kernel_sessions WHERE notebook_id = @notebookId').run({
            notebookId,
        });
    }
}

export const outputStore = OutputStore.getInstance();
