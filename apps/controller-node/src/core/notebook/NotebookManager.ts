/**
 * NotebookManager.ts — Manages open notebooks in memory and on disk.
 *
 * Responsibilities:
 *   - Parse .ipynb files (nbformat 4)
 *   - Track open notebooks with in-memory state
 *   - Save .ipynb files with current cell outputs
 *   - Integrate with PersistenceManager for autosave
 *   - Inject persisted outputs into notebook on open (session restore)
 *
 * Does NOT manage kernel lifecycle — that stays in KernelManager.
 */

import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { eventBus } from '../events/EventBus.js';
import { outputManager } from '../output/OutputManager.js';
import { outputStore } from '../output/OutputStore.js';
import { notebookService } from './NotebookService.js';

// ── .ipynb types (nbformat 4) ──────────────────────────────────────────────────

export interface IpynbCell {
    cell_type: 'code' | 'markdown' | 'raw';
    id: string;
    metadata: Record<string, any>;
    source: string | string[];
    outputs?: IpynbOutput[];
    execution_count?: number | null;
}

export interface IpynbOutput {
    output_type: 'stream' | 'execute_result' | 'display_data' | 'error';
    [key: string]: any;
}

export interface IpynbNotebook {
    nbformat: number;
    nbformat_minor: number;
    metadata: {
        kernelspec?: {
            display_name: string;
            language: string;
            name: string;
        };
        [key: string]: any;
    };
    cells: IpynbCell[];
}

// ── In-memory notebook state ───────────────────────────────────────────────────

export interface OpenNotebook {
    notebookId: string;    // normalized path used as stable ID
    path: string;          // absolute OS path
    name: string;
    notebook: IpynbNotebook;
    openedAt: number;
    lastSavedAt: number | null;
}

// ── NotebookManager ────────────────────────────────────────────────────────────

export class NotebookManager {
    private static instance: NotebookManager;

    /** Open notebooks indexed by notebookId (normalized path) */
    private notebooks: Map<string, OpenNotebook> = new Map();

    private constructor() {}

    public static getInstance(): NotebookManager {
        if (!NotebookManager.instance) {
            NotebookManager.instance = new NotebookManager();
        }
        return NotebookManager.instance;
    }

    // ── Open ───────────────────────────────────────────────────────────────────

    /**
     * Open a .ipynb file. Returns the in-memory notebook state.
     * If already open, returns the existing state.
     * Persisted outputs from the last session are injected into the cells.
     */
    public async openNotebook(filePath: string): Promise<OpenNotebook> {
        const resolvedPath = path.resolve(filePath);
        const notebookId = this.pathToId(resolvedPath);

        // Return existing if already open
        const existing = this.notebooks.get(notebookId);
        if (existing) return existing;

        // Read and parse
        const raw = await fs.readFile(resolvedPath, 'utf-8');
        let notebook: IpynbNotebook;
        try {
            notebook = JSON.parse(raw);
        } catch (err) {
            throw new Error(`Failed to parse notebook at ${resolvedPath}: ${(err as Error).message}`);
        }

        // Ensure all cells have stable IDs
        if (!notebook.cells) {
            notebook.cells = [];
        }
        if (!notebook.metadata) {
            notebook.metadata = {};
        }

        for (const cell of notebook.cells) {
            if (!cell.id) {
                cell.id = uuidv4().replace(/-/g, '');
            }
        }

        // Restore persisted outputs from SQLite
        const persistedOutputs = outputManager.getNotebookOutputs(notebookId);
        if (persistedOutputs.size > 0) {
            for (const cell of notebook.cells) {
                const outputs = persistedOutputs.get(cell.id);
                if (outputs && outputs.length > 0) {
                    cell.outputs = outputs as IpynbOutput[];
                }
            }
        }

        const name = path.basename(resolvedPath, '.ipynb');
        const openNotebook: OpenNotebook = {
            notebookId,
            path: resolvedPath,
            name,
            notebook,
            openedAt: Date.now(),
            lastSavedAt: null,
        };

        this.notebooks.set(notebookId, openNotebook);
        outputStore.upsertNotebook(notebookId, resolvedPath, name);

        // Register VS Code-like text model for kernel execution tracking
        notebookService.createFromIpynb(notebookId, notebook);

        eventBus.emit('notebook:opened', {
            notebookId,
            path: resolvedPath,
            cellCount: notebook.cells.length,
        });

        return openNotebook;
    }

    // ── Close ──────────────────────────────────────────────────────────────────

    public closeNotebook(notebookId: string): void {
        const nb = this.notebooks.get(notebookId);
        if (!nb) return;

        this.notebooks.delete(notebookId);
        notebookService.removeNotebookTextModel(notebookId);

        eventBus.emit('notebook:closed', {
            notebookId,
            path: nb.path,
        });
    }

    // ── Save ───────────────────────────────────────────────────────────────────

    /**
     * Async save — merges current persisted outputs into notebook cells and writes .ipynb.
     */
    public async saveNotebook(
        notebookId: string,
        trigger: 'manual' | 'autosave' | 'execution_complete' = 'manual',
    ): Promise<void> {
        const nb = this.notebooks.get(notebookId);
        if (!nb) return;

        // Merge latest outputs from OutputManager into cells before writing
        this.mergeOutputsIntoNotebook(nb);

        const json = JSON.stringify(nb.notebook, null, 1);
        await fs.writeFile(nb.path, json, 'utf-8');

        nb.lastSavedAt = Date.now();
        outputStore.markNotebookSaved(notebookId);

        eventBus.emit('notebook:saved', {
            notebookId,
            path: nb.path,
            trigger,
        });
    }

    /**
     * Synchronous save — called from PersistenceManager on autosave timer and shutdown.
     */
    public saveNotebookSync(
        notebookId: string,
        trigger: 'manual' | 'autosave' | 'execution_complete' = 'autosave',
    ): void {
        const nb = this.notebooks.get(notebookId);
        if (!nb) return;

        this.mergeOutputsIntoNotebook(nb);

        const json = JSON.stringify(nb.notebook, null, 1);
        fs.writeFileSync(nb.path, json, 'utf-8');

        nb.lastSavedAt = Date.now();
        outputStore.markNotebookSaved(notebookId);

        eventBus.emit('notebook:saved', {
            notebookId,
            path: nb.path,
            trigger,
        });
    }

    // ── Cell operations ────────────────────────────────────────────────────────

    /**
     * Update execution_count for a cell after execution completes.
     * Called by ExecutionEngine when it receives cell:completed.
     */
    public updateCellExecutionCount(
        notebookId: string,
        cellId: string,
        executionCount: number | null,
    ): void {
        const nb = this.notebooks.get(notebookId);
        if (!nb) return;

        const cell = nb.notebook.cells.find((c) => c.id === cellId);
        if (cell && cell.cell_type === 'code') {
            cell.execution_count = executionCount;
        }
    }

    /**
     * Update/overwrite entire notebook cells and metadata when saved by frontend.
     */
    public updateNotebookContent(notebookId: string, ipynb: IpynbNotebook): void {
        const nb = this.notebooks.get(notebookId);
        if (!nb) return;

        nb.notebook = ipynb;
        // Ensure all cells have stable IDs
        for (const cell of nb.notebook.cells) {
            if (!cell.id) {
                cell.id = uuidv4().replace(/-/g, '');
            }
        }

        // Refresh VS Code-like text model to reflect new cell structure
        notebookService.createFromIpynb(notebookId, nb.notebook);
    }

    /**
     * Update a single cell's source code in-memory right before execution.
     */
    public updateCellSource(notebookId: string, cellId: string, source: string): void {
        const nb = this.notebooks.get(notebookId);
        if (!nb) return;

        const cell = nb.notebook.cells.find((c) => c.id === cellId);
        if (cell) {
            cell.source = source.split('\n').map((line, i, arr) =>
                i < arr.length - 1 ? line + '\n' : line
            );
        }

        // Keep the VS Code TextModel in sync so PythonProcessKernel reads the latest source.
        notebookService.updateCellSource(notebookId, cellId, source);
    }

    /**
     * Update cell outputs in-memory (called after execution with final outputs).
     */
    public updateCellOutputs(
        notebookId: string,
        cellId: string,
        outputs: IpynbOutput[],
    ): void {
        const nb = this.notebooks.get(notebookId);
        if (!nb) return;

        const cell = nb.notebook.cells.find((c) => c.id === cellId);
        if (cell && cell.cell_type === 'code') {
            cell.outputs = outputs;
        }
    }

    /**
     * Clear all outputs from all code cells (after kernel restart).
     */
    public clearAllOutputs(notebookId: string): void {
        const nb = this.notebooks.get(notebookId);
        if (!nb) return;

        for (const cell of nb.notebook.cells) {
            if (cell.cell_type === 'code') {
                cell.outputs = [];
                cell.execution_count = null;
            }
        }
    }

    // ── Query API ──────────────────────────────────────────────────────────────

    public getNotebook(notebookId: string): OpenNotebook | null {
        return this.notebooks.get(notebookId) ?? null;
    }

    public isOpen(notebookId: string): boolean {
        return this.notebooks.has(notebookId);
    }

    public getAllOpen(): OpenNotebook[] {
        return Array.from(this.notebooks.values());
    }

    /**
     * Get ordered list of cells for execution operations.
     * Filters out non-code cells.
     */
    public getCodeCells(notebookId: string): IpynbCell[] {
        const nb = this.notebooks.get(notebookId);
        if (!nb) return [];
        return nb.notebook.cells.filter((c) => c.cell_type === 'code');
    }

    /**
     * Get all cells (including markdown) in notebook order.
     */
    public getAllCells(notebookId: string): IpynbCell[] {
        return this.notebooks.get(notebookId)?.notebook.cells ?? [];
    }

    /** Get raw source string from a cell (normalizes string[] to string). */
    public getCellSource(cell: IpynbCell): string {
        return Array.isArray(cell.source) ? cell.source.join('') : cell.source;
    }

    // ── ID helpers ─────────────────────────────────────────────────────────────

    /** Normalize a file path to a stable notebookId. */
    public pathToId(filePath: string): string {
        return path.resolve(filePath).replace(/\\/g, '/');
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private mergeOutputsIntoNotebook(nb: OpenNotebook): void {
        // Pull latest outputs from OutputManager (in-memory/SQLite) into notebook cells
        const allOutputs = outputManager.getNotebookOutputs(nb.notebookId);

        for (const cell of nb.notebook.cells) {
            if (cell.cell_type !== 'code') continue;
            const outputs = allOutputs.get(cell.id);
            if (outputs !== undefined) {
                cell.outputs = outputs as IpynbOutput[];
            }
        }
    }
}

export const notebookManager = NotebookManager.getInstance();
