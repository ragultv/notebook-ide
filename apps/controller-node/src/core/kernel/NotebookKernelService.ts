import { NotebookTextModel } from '../notebook/model/NotebookTextModel.js';
import { NotebookKernelController } from './NotebookKernelController.js';

export class NotebookKernelService {
    private static instance: NotebookKernelService;

    private controllers = new Map<string, NotebookKernelController>();
    private activeBindings = new Map<string, NotebookKernelController>(); // notebookUri → controller

    private constructor() {}

    public static getInstance(): NotebookKernelService {
        if (!NotebookKernelService.instance) {
            NotebookKernelService.instance = new NotebookKernelService();
        }
        return NotebookKernelService.instance;
    }

    public registerKernel(controller: NotebookKernelController): void {
        this.controllers.set(controller.id, controller);
    }

    public unregisterKernel(controllerId: string): void {
        this.controllers.delete(controllerId);
        // Remove any notebook bindings that pointed to this controller
        for (const [uri, ctrl] of this.activeBindings.entries()) {
            if (ctrl.id === controllerId) {
                this.activeBindings.delete(uri);
            }
        }
    }

    public selectKernelForNotebook(controllerId: string, notebookUri: string): void {
        const controller = this.controllers.get(controllerId);
        if (controller) {
            this.activeBindings.set(notebookUri, controller);
        }
    }

    public getSelectedOrSuggestedKernel(notebook: NotebookTextModel): NotebookKernelController | undefined {
        return this.activeBindings.get(notebook.uri) ?? this.getSuggestedKernel(notebook);
    }

    public getKernelForNotebook(notebookUri: string): NotebookKernelController | undefined {
        return this.activeBindings.get(notebookUri);
    }

    private getSuggestedKernel(_notebook: NotebookTextModel): NotebookKernelController | undefined {
        // Return first registered controller as fallback
        return this.controllers.values().next().value;
    }
}

export const notebookKernelService = NotebookKernelService.getInstance();
