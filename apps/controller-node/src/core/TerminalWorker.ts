import * as pty from 'node-pty';
import { v4 as uuidv4 } from 'uuid';
import { ExecutionResult } from './PythonWorker.js';

export class TerminalWorker {
    private ptyProcess: pty.IPty | null = null;
    public pid: number | null = null;
    public id: string;

    constructor(notebookId: string) {
        this.id = uuidv4();
    }

    public async execute(commandStr: string, timeoutMs: number = 0, onStream?: (streamEvent: any) => void): Promise<ExecutionResult> {
        return new Promise((resolve, reject) => {
            try {
                // Split command string into executable and args
                // Handle basic quoting and spaces, e.g. "oprel run qwen" -> ["oprel", "run", "qwen"]
                const args = commandStr.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
                if (args.length === 0) {
                    throw new Error("Empty command");
                }

                const command = args[0]?.replace(/^"|"$/g, '') || ''; // Remove quotes if any
                const commandArgs = args.slice(1).map(arg => arg?.replace(/^"|"$/g, '') || '');

                const shell = process.platform === 'win32' ? 'cmd.exe' : 'sh';

                // For direct command execution (like "oprel run ...") we just spawn it directly
                // If it fails, fallback to cmd.exe /c
                try {
                    this.ptyProcess = pty.spawn(command, commandArgs, {
                        name: 'xterm-color',
                        cols: 120,
                        rows: 30,
                        cwd: process.cwd(),
                        env: process.env as Record<string, string>,
                        useConpty: true
                    });
                } catch (spawnError) {
                    console.warn(`Direct spawn failed, falling back to shell: ${spawnError}`);
                    this.ptyProcess = pty.spawn(shell, process.platform === 'win32' ? ['/c', commandStr] : ['-c', commandStr], {
                        name: 'xterm-color',
                        cols: 120,
                        rows: 30,
                        cwd: process.cwd(),
                        env: process.env as Record<string, string>,
                        useConpty: true
                    });
                }

                if (!this.ptyProcess) {
                    throw new Error("Failed to spawn PTY");
                }

                this.pid = this.ptyProcess.pid;

                let outputBuffer = '';
                const startTime = performance.now();

                this.ptyProcess.onData((data) => {
                    outputBuffer += data;
                    if (onStream) {
                        onStream({
                            type: 'terminal_output',
                            data: data
                        });
                    }
                });

                this.ptyProcess.onExit(({ exitCode, signal }) => {
                    this.pid = null;
                    this.ptyProcess = null;

                    resolve({
                        status: exitCode === 0 ? 'success' : 'error',
                        stdout: outputBuffer,
                        stderr: '', // PTY merges stderr into stdout
                        error_details: exitCode !== 0 ? `Process exited with code ${exitCode}` : undefined,
                        execution_time: (performance.now() - startTime) / 1000,
                        outputs: [{ type: 'terminal_output', data: outputBuffer }],
                        execution_count: 0
                    } as ExecutionResult);
                });

                if (timeoutMs > 0) {
                    setTimeout(() => {
                        this.stop();
                        reject(new Error('Terminal execution timed out'));
                    }, timeoutMs);
                }

            } catch (error: any) {
                reject(error);
            }
        });
    }

    public sendInput(value: string): void {
        if (this.ptyProcess) {
            this.ptyProcess.write(value);
        }
    }

    public resize(cols: number, rows: number): void {
        if (this.ptyProcess) {
            try {
                this.ptyProcess.resize(cols, rows);
            } catch (e) {
                console.warn('Failed to resize pty:', e);
            }
        }
    }

    public stop(): void {
        if (this.ptyProcess) {
            try {
                this.ptyProcess.kill();
            } catch (e) {
                // Ignore kill errors
            }
            this.ptyProcess = null;
            this.pid = null;
        }
    }
}
