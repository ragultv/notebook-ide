import { NotebookExecution } from '../execution/NotebookExecution';
import { CellExecution } from '../execution/CellExecution';
import { NotebookService } from '../notebook/NotebookService';

export class NotebookExecutionStateService {
    private notebookExecutions = new Map<string, NotebookExecution>();
    private cellExecutions = new Map<string, CellExecution>();

    constructor(private readonly notebookService: NotebookService) {}

    public createExecution(notebookUri: string): NotebookExecution {
        let execution = this.notebookExecutions.get(notebookUri);
        if (!execution) {
            execution = new NotebookExecution(notebookUri);
            this.notebookExecutions.set(notebookUri, execution);
        }
        return execution;
    }

    public getExecution(notebookUri: string): NotebookExecution | undefined {
        return this.notebookExecutions.get(notebookUri);
    }

    public createCellExecution(notebookUri: string, cellHandle: number): CellExecution {
        const key = `${notebookUri}#${cellHandle}`;
        let execution = this.cellExecutions.get(key);
        if (!execution) {
            const model = this.notebookService.getNotebookTextModel(notebookUri);
            if (!model) {
                throw new Error(`Notebook model not found for URI: ${notebookUri}`);
            }
            execution = new CellExecution(cellHandle, notebookUri, model);
            this.cellExecutions.set(key, execution);
        }
        return execution;
    }

    public getCellExecution(notebookUri: string, cellHandle: number): CellExecution | undefined {
        const key = `${notebookUri}#${cellHandle}`;
        return this.cellExecutions.get(key);
    }

    public removeCellExecution(notebookUri: string, cellHandle: number): void {
        const key = `${notebookUri}#${cellHandle}`;
        this.cellExecutions.delete(key);
    }

    public removeExecution(notebookUri: string): void {
        this.notebookExecutions.delete(notebookUri);
    }
}
