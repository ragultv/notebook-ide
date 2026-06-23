import { BaseKernel } from './BaseKernel.js';

export class JupyterKernel extends BaseKernel {
    constructor(id: string, label: string) {
        super(id, label);
    }

    public async executeCells(_uri: string, _cellHandles: number[]): Promise<void> {
        // TODO: Implement ZeroMQ IOPub/Shell execution logic
    }

    public async interrupt(): Promise<void> {
        // TODO: Implement ZeroMQ Control channel interrupt
    }

    public async restart(): Promise<void> {
        // TODO: Implement ZeroMQ restart
    }

    public async shutdown(): Promise<void> {
        // TODO: Implement ZeroMQ shutdown
    }

    public async provideVariables(): Promise<any[]> {
        return [];
    }
}
