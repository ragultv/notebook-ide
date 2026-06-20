import { NotebookTextModel } from '../notebook/model/NotebookTextModel';
import { NotebookCellTextModel } from '../notebook/model/NotebookCellTextModel';
import { NotebookExecutionStateService } from '../state/NotebookExecutionStateService';
import { NotebookKernelService } from '../kernel/NotebookKernelService';
import { NotebookCellExecutionManager } from './NotebookCellExecutionManager';

export interface INotebookExecutionService {
    executeNotebookCells(notebook: NotebookTextModel, cells: NotebookCellTextModel[]): Promise<void>;
}

export class NotebookExecutionService implements INotebookExecutionService {
    constructor(
        private readonly stateService: NotebookExecutionStateService,
        private readonly kernelService: NotebookKernelService
    ) {}

    public async executeNotebookCells(notebook: NotebookTextModel, cells: NotebookCellTextModel[]): Promise<void> {
        const execution = this.stateService.createExecution(notebook.uri);
        execution.confirm();
        execution.begin();
        
        const manager = new NotebookCellExecutionManager(notebook, cells, this.stateService, this.kernelService);
        await manager.start();
        
        execution.complete();
    }
}
