export interface IKernel {
    readonly id: string;
    readonly label: string;

    executeCells(uri: string, cellHandles: number[]): Promise<void>;
    interrupt(): Promise<void>;
    restart(): Promise<void>;
    shutdown(): Promise<void>;
    provideVariables(): Promise<any[]>;
}

export abstract class BaseKernel implements IKernel {
    constructor(public readonly id: string, public readonly label: string) {}

    public abstract executeCells(uri: string, cellHandles: number[]): Promise<void>;
    public abstract interrupt(): Promise<void>;
    public abstract restart(): Promise<void>;
    public abstract shutdown(): Promise<void>;
    public abstract provideVariables(): Promise<any[]>;
}
