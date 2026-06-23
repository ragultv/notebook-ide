import { NotebookTextModel } from './model/NotebookTextModel.js';
import { ICellDto, CellKind } from './NotebookCommon.js';
import type { IpynbNotebook } from './NotebookManager.js';

export class NotebookService {
    private static instance: NotebookService;
    private models = new Map<string, NotebookTextModel>();

    private constructor() {}

    public static getInstance(): NotebookService {
        if (!NotebookService.instance) {
            NotebookService.instance = new NotebookService();
        }
        return NotebookService.instance;
    }

    public getNotebookTextModel(uri: string): NotebookTextModel | undefined {
        return this.models.get(uri);
    }

    /**
     * Create a NotebookTextModel from an .ipynb notebook and register it.
     * Called by NotebookManager whenever a notebook is opened or its content updated.
     */
    public createFromIpynb(notebookId: string, ipynb: IpynbNotebook): NotebookTextModel {
        const cells: ICellDto[] = ipynb.cells.map((cell, index) => ({
            handle:   index,
            cellId:   cell.id,
            cellKind: cell.cell_type === 'code' ? CellKind.Code : CellKind.Markup,
            source:   Array.isArray(cell.source) ? cell.source.join('') : (cell.source ?? ''),
            language: cell.cell_type === 'code' ? 'python' : 'markdown',
            outputs:  [],
            metadata: cell.metadata ?? {},
        }));

        const model = new NotebookTextModel(notebookId, cells, ipynb.metadata ?? {});
        this.models.set(notebookId, model);
        return model;
    }

    public removeNotebookTextModel(uri: string): void {
        this.models.delete(uri);
    }

    /** Keep the TextModel's cell source in sync when the user edits before execution. */
    public updateCellSource(notebookId: string, cellId: string, source: string): void {
        const model = this.models.get(notebookId);
        if (!model) return;
        const cell = model.cells.find((c) => c.cellId === cellId);
        if (cell) cell.source = source;
    }
}

export const notebookService = NotebookService.getInstance();
