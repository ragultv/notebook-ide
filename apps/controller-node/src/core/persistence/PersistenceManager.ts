/**
 * PersistenceManager.ts — Coordinates autosave for all open notebooks.
 *
 * Autosave strategy (matching VS Code + Deepnote behavior):
 *   1. On every execution completion  → saves immediately
 *   2. Timer-based every 30 seconds   → saves any notebook with pending changes
 *
 * Writes .ipynb to disk. Delegates output persistence to OutputStore.
 */

import { eventBus } from '../events/EventBus.js';
import { outputStore } from '../output/OutputStore.js';

const AUTOSAVE_INTERVAL_MS = 30_000; // 30 seconds, matching VS Code default

// Lazy-import NotebookManager to avoid circular dependency at module load time
type NotebookManagerType = import('../notebook/NotebookManager.js').NotebookManager;

export class PersistenceManager {
    private static instance: PersistenceManager;
    private autosaveTimer: NodeJS.Timeout | null = null;
    private notebookManager: NotebookManagerType | null = null;

    /** notebookIds that have unsaved changes (dirty set) */
    private dirtyNotebooks: Set<string> = new Set();

    private constructor() {}

    public static getInstance(): PersistenceManager {
        if (!PersistenceManager.instance) {
            PersistenceManager.instance = new PersistenceManager();
        }
        return PersistenceManager.instance;
    }

    // ── Initialization ─────────────────────────────────────────────────────────

    /** Must be called once at startup after DB and NotebookManager are ready. */
    public initialize(notebookManager: NotebookManagerType): void {
        this.notebookManager = notebookManager;

        // Initialize the SQLite database
        outputStore.initialize();

        // Mark notebooks dirty when execution completes (trigger 1)
        eventBus.on('cell:completed', (e) => {
            this.dirtyNotebooks.add(e.notebookId);
            // Save immediately on execution_complete
            void this.saveNotebook(e.notebookId, 'execution_complete');
        });

        eventBus.on('cell:failed', (e) => {
            this.dirtyNotebooks.add(e.notebookId);
            void this.saveNotebook(e.notebookId, 'execution_complete');
        });

        eventBus.on('notebook:opened', (e) => {
            // Ensure notebook is registered in SQLite
            outputStore.upsertNotebook(e.notebookId, e.path, this.nameFromPath(e.path));
        });

        eventBus.on('notebook:closed', (e) => {
            this.dirtyNotebooks.delete(e.notebookId);
        });

        eventBus.on('kernel:restarted', (e) => {
            // Restart clears all outputs — reflect that in the DB
            outputStore.clearNotebookOutputs(e.notebookId);
        });

        // Start timer-based autosave (trigger 2)
        this.startAutosaveTimer();

        console.log('[PersistenceManager] Initialized. Autosave every 30s + on completion.');
    }

    public shutdown(): void {
        this.stopAutosaveTimer();
        // Flush all remaining dirty notebooks synchronously
        for (const notebookId of this.dirtyNotebooks) {
            this.saveNotebookSync(notebookId, 'autosave');
        }
        outputStore.close();
        console.log('[PersistenceManager] Shutdown complete.');
    }

    // ── Autosave timer ─────────────────────────────────────────────────────────

    private startAutosaveTimer(): void {
        this.autosaveTimer = setInterval(() => {
            this.flushDirtyNotebooks();
        }, AUTOSAVE_INTERVAL_MS);

        // Don't hold the process open just for autosave
        this.autosaveTimer.unref();
    }

    private stopAutosaveTimer(): void {
        if (this.autosaveTimer) {
            clearInterval(this.autosaveTimer);
            this.autosaveTimer = null;
        }
    }

    private flushDirtyNotebooks(): void {
        if (this.dirtyNotebooks.size === 0) return;

        const toSave = Array.from(this.dirtyNotebooks);
        for (const notebookId of toSave) {
            this.saveNotebookSync(notebookId, 'autosave');
        }
    }

    // ── Save operations ────────────────────────────────────────────────────────

    /**
     * Async save — called on execution_complete.
     * Uses setImmediate to avoid blocking the output streaming pipeline.
     */
    private async saveNotebook(
        notebookId: string,
        trigger: 'manual' | 'autosave' | 'execution_complete',
    ): Promise<void> {
        if (!this.notebookManager) return;

        try {
            await this.notebookManager.saveNotebook(notebookId, trigger);
            this.dirtyNotebooks.delete(notebookId);
        } catch (err) {
            console.error(`[PersistenceManager] Failed to save notebook ${notebookId}:`, err);
        }
    }

    /**
     * Synchronous save — called from timer and shutdown.
     * Safe to call from any context since better-sqlite3 is synchronous anyway.
     */
    private saveNotebookSync(
        notebookId: string,
        trigger: 'manual' | 'autosave' | 'execution_complete',
    ): void {
        if (!this.notebookManager) return;

        try {
            this.notebookManager.saveNotebookSync(notebookId, trigger);
            this.dirtyNotebooks.delete(notebookId);
        } catch (err) {
            console.error(`[PersistenceManager] Sync save failed for ${notebookId}:`, err);
        }
    }

    /** Public: called when user explicitly saves (Ctrl+S). */
    public async manualSave(notebookId: string): Promise<void> {
        await this.saveNotebook(notebookId, 'manual');
    }

    /** Mark a notebook as having unsaved changes. */
    public markDirty(notebookId: string): void {
        this.dirtyNotebooks.add(notebookId);
    }

    public isDirty(notebookId: string): boolean {
        return this.dirtyNotebooks.has(notebookId);
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private nameFromPath(filePath: string): string {
        const basename = filePath.split(/[/\\]/).pop() ?? filePath;
        return basename.replace(/\.ipynb$/, '');
    }
}

export const persistenceManager = PersistenceManager.getInstance();
