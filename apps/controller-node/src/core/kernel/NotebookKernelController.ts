import { IKernel } from './BaseKernel';

export class NotebookKernelController {
    public readonly id: string;
    public readonly label: string;
    public readonly supportedLanguages: string[] = ['python'];
    public readonly notebookType = 'jupyter-notebook';

    constructor(private readonly kernel: IKernel) {
        this.id = kernel.id;
        this.label = kernel.label;
    }

    public async executeNotebookCellsRequest(uri: string, cellHandles: number[]): Promise<void> {
        await this.kernel.executeCells(uri, cellHandles);
    }

    public async cancelNotebookCellExecution(uri: string, cellHandles: number[]): Promise<void> {
        await this.kernel.interrupt();
    }
}
