import { NotebookTextModel } from '../notebook/model/NotebookTextModel.js';
import { NotebookCellTextModel } from '../notebook/model/NotebookCellTextModel.js';
import { NotebookExecutionStateService } from '../state/NotebookExecutionStateService.js';
import { NotebookKernelService } from '../kernel/NotebookKernelService.js';

export class NotebookCellExecutionManager {
    constructor(
        private readonly notebook: NotebookTextModel,
        private readonly cells: NotebookCellTextModel[],
        private readonly stateService: NotebookExecutionStateService,
        private readonly kernelService: NotebookKernelService,
    ) {}

    public async start(): Promise<void> {
        const kernel = this.kernelService.getSelectedOrSuggestedKernel(this.notebook);
        if (!kernel) return;

        // Create CellExecution tokens for each cell before calling the kernel.
        // PythonProcessKernel.executeCells() reads these via getCellExecution().
        const executions = this.cells.map(c =>
            this.stateService.createCellExecution(this.notebook.uri, c.handle),
        );
        executions.forEach(e => e.initialize());

        try {
            await kernel.executeNotebookCellsRequest(
                this.notebook.uri,
                this.cells.map(c => c.handle),
            );
        } catch (err) {
            // Complete any executions that the kernel left open (idempotent — safe to call twice)
            executions.forEach(e => e.complete(false));
        }
    }
}
