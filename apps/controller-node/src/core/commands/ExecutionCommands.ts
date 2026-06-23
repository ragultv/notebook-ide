import { INotebookCommand } from './NotebookCommandService.js';
import { notebookExecutionService } from '../execution/NotebookExecutionService.js';
import { notebookService } from '../notebook/NotebookService.js';
import { CellKind } from '../notebook/NotebookCommon.js';

export class ExecuteCellCommand implements INotebookCommand {
    public async run(notebookUri: string, cellHandle: number): Promise<void> {
        const notebook = notebookService.getNotebookTextModel(notebookUri);
        if (!notebook) throw new Error('Notebook not found');

        const cell = notebook.cells.find((c) => c.handle === cellHandle);
        if (!cell) throw new Error('Cell not found');

        await notebookExecutionService.runCell(notebookUri, cell.cellId, cell.source);
    }
}

export class RunAllCommand implements INotebookCommand {
    public async run(notebookUri: string): Promise<void> {
        const notebook = notebookService.getNotebookTextModel(notebookUri);
        if (!notebook) throw new Error('Notebook not found');

        const cells = notebook.cells
            .filter((c) => c.cellKind === CellKind.Code)
            .map((c) => ({ cellId: c.cellId, code: c.source }));

        await notebookExecutionService.runCellsExplicit(notebookUri, cells);
    }
}
