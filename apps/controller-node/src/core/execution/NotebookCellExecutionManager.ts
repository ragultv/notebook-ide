import { NotebookTextModel } from '../notebook/model/NotebookTextModel';
import { NotebookCellTextModel } from '../notebook/model/NotebookCellTextModel';
import { NotebookExecutionStateService } from '../state/NotebookExecutionStateService';
import { NotebookKernelService } from '../kernel/NotebookKernelService';

export class NotebookCellExecutionManager {
    constructor(
        private readonly notebook: NotebookTextModel,
        private readonly cells: NotebookCellTextModel[],
        private readonly stateService: NotebookExecutionStateService,
        private readonly kernelService: NotebookKernelService
    ) {}

    public async start(): Promise<void> {
        const kernel = this.kernelService.getSelectedOrSuggestedKernel(this.notebook);
        if (!kernel) return;

        // Instantiate and register CellExecution tokens.
        const executions = this.cells.map(c => this.stateService.createCellExecution(this.notebook.uri, c.handle));
        executions.forEach(e => e.initialize());
        
        try {
            await kernel.executeNotebookCellsRequest(this.notebook.uri, this.cells.map(c => c.handle));
        } finally {
            executions.forEach(e => e.complete(false)); // Should be updated to real success status eventually
        }
    }
}
