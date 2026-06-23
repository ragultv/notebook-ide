/**
 * KernelBootstrap.ts — Wires KernelManager lifecycle events to the VS Code-like
 * kernel system (PythonProcessKernel → NotebookKernelController → NotebookKernelService).
 *
 * Import this module once in index.ts for side-effects only.
 * It listens on KernelManager's EventEmitter and registers/unregisters
 * PythonProcessKernel instances as kernels start and stop.
 */

import { KernelManager } from '../KernelManager.js';
import { PythonProcessKernel } from './PythonProcessKernel.js';
import { NotebookKernelController } from './NotebookKernelController.js';
import { notebookKernelService } from './NotebookKernelService.js';
import { notebookExecutionStateService } from '../state/NotebookExecutionStateService.js';

const kernelManager = KernelManager.getInstance();

// When a real Python kernel starts, create a PythonProcessKernel and register it
kernelManager.on('kernel:started', (notebookId: string) => {
    const pyKernel = new PythonProcessKernel(
        notebookId,                        // id = notebookId (one kernel per notebook)
        `Python (${notebookId})`,          // label
        notebookId,                        // notebookUri
        (id, code, cbs, execId) =>
            kernelManager.executeCode(id, code, cbs, execId),
        (id) => kernelManager.interruptKernel(id),
        notebookExecutionStateService,
    );

    const controller = new NotebookKernelController(pyKernel);
    notebookKernelService.registerKernel(controller);
    notebookKernelService.selectKernelForNotebook(controller.id, notebookId);
});

// When a kernel stops, unregister it so stale handles aren't used
kernelManager.on('kernel:stopped', (notebookId: string) => {
    notebookKernelService.unregisterKernel(notebookId);
});
