import { BaseKernel } from './BaseKernel';

export class PythonProcessKernel extends BaseKernel {
    constructor(id: string, label: string) {
        super(id, label);
    }

    public async executeCells(uri: string, cellHandles: number[]): Promise<void> {
        // Implement stdio-based execution logic
    }

    public async interrupt(): Promise<void> {
        // Implement process SIGINT
    }

    public async restart(): Promise<void> {
        // Implement process restart
    }

    public async shutdown(): Promise<void> {
        // Implement process kill
    }

    public async provideVariables(): Promise<any[]> {
        return [];
    }
}
