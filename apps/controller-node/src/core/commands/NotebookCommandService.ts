export interface INotebookCommand {
    run(...args: any[]): Promise<any>;
}

export class NotebookCommandService {
    private commands = new Map<string, INotebookCommand>();

    public registerCommand(name: string, cmd: INotebookCommand): void {
        this.commands.set(name, cmd);
    }

    public async executeCommand(name: string, ...args: any[]): Promise<any> {
        const cmd = this.commands.get(name);
        if (!cmd) throw new Error(`Command ${name} not found`);
        return cmd.run(...args);
    }
}
