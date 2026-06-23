import { INotebookCommand } from './NotebookCommandService.js';
import { notebookKernelService } from '../kernel/NotebookKernelService.js';
import { notebookService } from '../notebook/NotebookService.js';

export class InterruptKernelCommand implements INotebookCommand {
    constructor(private readonly notebookUri: string) {}

    public async run(): Promise<void> {
        const notebook = notebookService.getNotebookTextModel(this.notebookUri);
        if (!notebook) return;
        const controller = notebookKernelService.getKernelForNotebook(this.notebookUri);
        if (controller) {
            await controller.cancelNotebookCellExecution(this.notebookUri, []);
        }
    }
}

export class RestartKernelCommand implements INotebookCommand {
    constructor(_notebookUri: string) {}

    public async run(): Promise<void> {
        // Restart is handled at a higher level by KernelManager.restartKernel()
    }
}
