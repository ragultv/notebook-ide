import { execa, Subprocess } from 'execa';
import { v4 as uuidv4 } from 'uuid';
import { ExecutionResult } from './PythonWorker.js';

export class TerminalWorker {
    private process: Subprocess | null = null;
    public pid: number | null = null;
    public id: string;

    constructor(_notebookId: string) {
        this.id = uuidv4();
    }

    public async execute(commandStr: string, timeoutMs: number = 0, onStream?: (streamEvent: any) => void): Promise<ExecutionResult> {
        const args = commandStr.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
        if (args.length === 0) {
            throw new Error('Empty command');
        }

        const command = args[0]?.replace(/^"|"$/g, '') || '';
        const commandArgs = args.slice(1).map((arg) => arg?.replace(/^"|"$/g, '') || '');
        const startTime = performance.now();
        let outputBuffer = '';

        this.process = execa(command, commandArgs, {
            cwd: process.cwd(),
            env: process.env as Record<string, string>,
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe',
            all: true,
            reject: false,
            shell: false,
        });

        this.pid = this.process.pid ?? null;

        const appendOutput = (chunk: string | Buffer) => {
            const text = chunk.toString();
            outputBuffer += text;
            if (onStream) {
                onStream({
                    type: 'terminal_output',
                    data: text,
                });
            }
        };

        this.process.stdout?.on('data', appendOutput);
        this.process.stderr?.on('data', appendOutput);

        let timeoutHandle: NodeJS.Timeout | undefined;
        if (timeoutMs > 0) {
            timeoutHandle = setTimeout(() => {
                this.stop();
            }, timeoutMs);
        }

        try {
            const result = await this.process;
            return {
                status: result.exitCode === 0 ? 'success' : 'error',
                stdout: outputBuffer,
                stderr: '',
                error_details: result.exitCode === 0 ? undefined : `Process exited with code ${result.exitCode}`,
                execution_time: (performance.now() - startTime) / 1000,
                outputs: [{ type: 'terminal_output', data: outputBuffer }],
                execution_count: 0,
            } as ExecutionResult;
        } finally {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }
            this.process = null;
            this.pid = null;
        }
    }

    public sendInput(value: string): void {
        this.process?.stdin?.write(value);
    }

    public resize(_cols: number, _rows: number): void {
        // No-op without a PTY backend.
    }

    public stop(): void {
        if (this.process && !this.process.killed) {
            this.process.kill('SIGTERM');
        }
        this.process = null;
        this.pid = null;
    }
}
