import { NotebookTextModel } from '../notebook/model/NotebookTextModel';
import { NotebookKernelController } from './NotebookKernelController';

export class NotebookKernelService {
    private controllers = new Map<string, NotebookKernelController>();
    private activeBindings = new Map<string, NotebookKernelController>(); // notebookUri -> controller

    public registerKernel(controller: NotebookKernelController): void {
        this.controllers.set(controller.id, controller);
    }

    public getSelectedOrSuggestedKernel(notebook: NotebookTextModel): NotebookKernelController | undefined {
        return this.activeBindings.get(notebook.uri) || this.getSuggestedKernel(notebook);
    }

    public selectKernelForNotebook(controllerId: string, notebookUri: string): void {
        const controller = this.controllers.get(controllerId);
        if (controller) {
            this.activeBindings.set(notebookUri, controller);
        }
    }

    private getSuggestedKernel(notebook: NotebookTextModel): NotebookKernelController | undefined {
        // Find best match (affinity scoring)
        for (const controller of this.controllers.values()) {
            // Simplified match logic
            return controller;
        }
        return undefined;
    }
}
