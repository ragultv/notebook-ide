import { INotebookCommand } from './NotebookCommandService';
import { NotebookExecutionService } from '../execution/NotebookExecutionService';
import { NotebookService } from '../notebook/NotebookService';

export class ExecuteCellCommand implements INotebookCommand {
    constructor(
        private readonly executionService: NotebookExecutionService,
        private readonly notebookService: NotebookService
    ) {}

    public async run(notebookUri: string, cellHandle: number): Promise<void> {
        const notebook = this.notebookService.getNotebookTextModel(notebookUri);
        if (!notebook) throw new Error('Notebook not found');

        const cell = notebook.cells.find(c => c.handle === cellHandle);
        if (!cell) throw new Error('Cell not found');

        await this.executionService.executeNotebookCells(notebook, [cell]);
    }
}

export class RunAllCommand implements INotebookCommand {
    constructor(
        private readonly executionService: NotebookExecutionService,
        private readonly notebookService: NotebookService
    ) {}

    public async run(notebookUri: string): Promise<void> {
        const notebook = this.notebookService.getNotebookTextModel(notebookUri);
        if (!notebook) throw new Error('Notebook not found');

        // Only run code cells
        const codeCells = notebook.cells.filter(c => c.cellKind === 2); // 2 is Code
        
        await this.executionService.executeNotebookCells(notebook, codeCells);
    }
}
