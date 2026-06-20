import { INotebookCommand } from './NotebookCommandService';
import { NotebookKernelService } from '../kernel/NotebookKernelService';
import { NotebookService } from '../notebook/NotebookService';

export class InterruptKernelCommand implements INotebookCommand {
    constructor(
        private readonly kernelService: NotebookKernelService,
        private readonly notebookService: NotebookService
    ) {}

    public async run(notebookUri: string): Promise<void> {
        const notebook = this.notebookService.getNotebookTextModel(notebookUri);
        if (!notebook) throw new Error('Notebook not found');

        const kernel = this.kernelService.getSelectedOrSuggestedKernel(notebook);
        if (!kernel) throw new Error('No active kernel for notebook');

        // We interrupt the execution of all running cells by passing empty array or specific handles if needed
        await kernel.cancelNotebookCellExecution(notebookUri, []);
    }
}

export class RestartKernelCommand implements INotebookCommand {
    constructor(
        private readonly kernelService: NotebookKernelService,
        private readonly notebookService: NotebookService
    ) {}

    public async run(notebookUri: string): Promise<void> {
        const notebook = this.notebookService.getNotebookTextModel(notebookUri);
        if (!notebook) throw new Error('Notebook not found');

        // Note: The NotebookKernelController would need a restart method passing to BaseKernel,
        // for now we'll assume it exists or will be added.
        throw new Error('Restart implementation pending Kernel Controller wiring');
    }
}
