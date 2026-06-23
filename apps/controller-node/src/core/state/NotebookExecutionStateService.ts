import { NotebookExecution } from '../execution/NotebookExecution.js';
import { CellExecution } from '../execution/CellExecution.js';
import { notebookService } from '../notebook/NotebookService.js';

export class NotebookExecutionStateService {
    private static instance: NotebookExecutionStateService;

    private notebookExecutions = new Map<string, NotebookExecution>();
    private cellExecutions = new Map<string, CellExecution>();

    private constructor() {}

    public static getInstance(): NotebookExecutionStateService {
        if (!NotebookExecutionStateService.instance) {
            NotebookExecutionStateService.instance = new NotebookExecutionStateService();
        }
        return NotebookExecutionStateService.instance;
    }

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

    /**
     * Create (or replace) a CellExecution for the given cell handle.
     * Pass executionId from the queue item so the frontend ID matches throughout.
     */
    public createCellExecution(notebookUri: string, cellHandle: number, executionId?: string): CellExecution {
        const key = `${notebookUri}#${cellHandle}`;
        const model = notebookService.getNotebookTextModel(notebookUri);
        if (!model) {
            throw new Error(`NotebookTextModel not found for URI: ${notebookUri}`);
        }
        const execution = new CellExecution(cellHandle, notebookUri, model, executionId);
        this.cellExecutions.set(key, execution);
        return execution;
    }

    public getCellExecution(notebookUri: string, cellHandle: number): CellExecution | undefined {
        return this.cellExecutions.get(`${notebookUri}#${cellHandle}`);
    }

    public removeCellExecution(notebookUri: string, cellHandle: number): void {
        this.cellExecutions.delete(`${notebookUri}#${cellHandle}`);
    }

    public removeExecution(notebookUri: string): void {
        this.notebookExecutions.delete(notebookUri);
    }
}

export const notebookExecutionStateService = NotebookExecutionStateService.getInstance();
