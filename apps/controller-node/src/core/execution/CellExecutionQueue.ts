import { CellExecution } from './CellExecution';
import { NotebookExecutionStateService } from '../state/NotebookExecutionStateService';
import { IKernel } from '../kernel/BaseKernel';

export class CellExecutionQueue {
    private queue: number[] = [];
    private isExecuting = false;

    constructor(
        private readonly notebookUri: string,
        private readonly stateService: NotebookExecutionStateService,
        private readonly kernel: IKernel
    ) {}

    public queueCells(cellHandles: number[]) {
        this.queue.push(...cellHandles);
        
        // Mark pending
        for (const handle of cellHandles) {
            const execution = this.stateService.getCellExecution(this.notebookUri, handle);
            if (execution) {
                execution.confirm();
            }
        }

        this.processQueue();
    }

    private async processQueue() {
        if (this.isExecuting || this.queue.length === 0) return;

        this.isExecuting = true;
        try {
            while (this.queue.length > 0) {
                const handle = this.queue.shift();
                if (handle !== undefined) {
                    await this.executeCell(handle);
                }
            }
        } finally {
            this.isExecuting = false;
        }
    }

    private async executeCell(handle: number) {
        const execution = this.stateService.getCellExecution(this.notebookUri, handle);
        if (execution) {
            // Usually update is called with outputs, here we just signify execution start
            execution.update([]); 
        }

        try {
            await this.kernel.executeCells(this.notebookUri, [handle]);
        } finally {
            if (execution) {
                execution.complete(true);
            }
        }
    }
}
