import { execa, Subprocess } from 'execa';
import path from 'path';
import { EventEmitter } from 'events';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface WorkerConfig {
    max_memory_mb?: number;
}

export interface ExecutionResult {
    status: 'success' | 'error' | 'timeout' | 'killed' | 'crashed';
    stdout: string;
    stderr: string;
    error_details?: string;
    execution_time: number;
    metrics?: any;
    namespace_vars?: Record<string, string>;
    outputs?: any[];
}

export class JuliaWorker extends EventEmitter {
    private process: Subprocess | null = null;
    private workerScript: string;
    private juliaPath: string;
    public readonly notebookId: string;
    private isReady: boolean = false;

    constructor(notebookId: string, juliaPath: string = 'julia') {
        super();
        this.notebookId = notebookId;
        this.juliaPath = juliaPath;

        // Resolve path to worker_entry.jl — mirrors the logic in PythonWorker.ts
        const possiblePaths = [
            path.resolve(__dirname, '../../../kernel-julia/worker_entry.jl'),
            path.resolve(process.cwd(), '../kernel-julia/worker_entry.jl'),
        ];

        const foundPath = possiblePaths.find(p => fs.existsSync(p));

        if (!foundPath) {
            console.error('Julia worker script not found. Tried paths:', possiblePaths);
            console.error('__dirname:', __dirname);
            console.error('process.cwd():', process.cwd());
        }

        this.workerScript = foundPath || possiblePaths[0];
    }

    public get pid(): number | undefined {
        return this.process?.pid;
    }

    public async start(config: WorkerConfig = {}): Promise<void> {
        if (this.process) return;

        if (!fs.existsSync(this.workerScript)) {
            const error = `Julia worker script not found at ${this.workerScript}`;
            console.error(error);
            throw new Error(error);
        }

        // Resolve the Project.toml directory for Julia environment management
        const projectDir = path.dirname(this.workerScript);

        console.log(`Starting Julia worker: ${this.juliaPath} --project=${projectDir} ${this.workerScript}`);

        this.process = execa(
            this.juliaPath,
            ['--project=' + projectDir, this.workerScript],
            {
                stdin: 'pipe',
                stdout: 'pipe',
                stderr: 'pipe', // JSON-RPC responses arrive via stderr
                buffer: false,
            }
        );

        if (!this.process.stdin || !this.process.stderr) {
            throw new Error('Failed to open streams for Julia worker');
        }

        // Send initial configuration
        this.process.stdin.write(JSON.stringify(config) + '\n');

        // Julia has JIT compilation overhead — allow a longer startup window
        return new Promise((resolve, reject) => {
            const STARTUP_TIMEOUT_MS = 120_000; // 2 minutes for first-run JIT + Pkg resolution

            const timeout = setTimeout(() => {
                console.error('Julia worker failed to start within timeout');
                reject(new Error('Julia worker startup timeout'));
            }, STARTUP_TIMEOUT_MS);

            const onData = (data: Buffer) => {
                const line = data.toString().trim();
                console.log('Julia worker output:', line);
                try {
                    const response = JSON.parse(line);
                    if (response.status === 'ready') {
                        this.isReady = true;
                        this.process?.stderr?.off('data', onData);
                        this.process?.stderr?.off('error', onError);
                        clearTimeout(timeout);
                        resolve();
                    } else if (response.status === 'error') {
                        this.process?.stderr?.off('data', onData);
                        this.process?.stderr?.off('error', onError);
                        clearTimeout(timeout);
                        reject(new Error(`Julia worker failed to start: ${response.message || JSON.stringify(response)}`));
                    }
                } catch (e) {
                    // Not JSON — likely debug / precompilation output; ignore
                }
            };

            const onError = (error: Error) => {
                console.error('Julia worker stderr error:', error);
                this.process?.stderr?.off('data', onData);
                this.process?.stderr?.off('error', onError);
                clearTimeout(timeout);
                reject(error);
            };

            const processStderr = this.process?.stderr;
            if (!processStderr) {
                clearTimeout(timeout);
                reject(new Error('Failed to access stderr stream'));
                return;
            }

            processStderr.on('data', onData);
            processStderr.on('error', onError);
        });
    }

    public async execute(code: string, timeoutMs: number = 0, onStream?: (streamEvent: any) => void): Promise<ExecutionResult> {
        if (!this.process || !this.isReady) {
            throw new Error('Julia worker not running');
        }

        return new Promise((resolve, reject) => {
            const request = { command: 'EXECUTE', code };
            this.process!.stdin!.write(JSON.stringify(request) + '\n');

            const onStderr = (data: Buffer) => {
                const lines = data.toString().split('\n');
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const response = JSON.parse(line);

                        if ((response.type === 'stream' || response.type === 'input_request') && onStream) {
                            onStream(response);
                            continue;
                        }

                        if (response.status && response.status !== 'ready') {
                            cleanup();
                            resolve(response as ExecutionResult);
                            return;
                        }
                    } catch (e) {
                        // ignore non-JSON lines
                    }
                }
            };

            const cleanup = () => {
                this.process?.stderr?.off('data', onStderr);
            };

            this.process!.stderr!.on('data', onStderr);

            if (timeoutMs > 0) {
                setTimeout(() => {
                    cleanup();
                    this.stop();
                    reject(new Error('Execution timed out'));
                }, timeoutMs);
            }
        });
    }

    public async snapshot(): Promise<any> {
        if (!this.process || !this.isReady) {
            throw new Error('Julia worker not running');
        }

        return new Promise((resolve, reject) => {
            const request = { command: 'SNAPSHOT' };
            this.process!.stdin!.write(JSON.stringify(request) + '\n');

            const onStderr = (data: Buffer) => {
                const lines = data.toString().split('\n');
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const response = JSON.parse(line);
                        if (response.variables) {
                            cleanup();
                            resolve(response);
                            return;
                        }
                    } catch (e) {
                        // ignore
                    }
                }
            };

            const cleanup = () => {
                this.process?.stderr?.off('data', onStderr);
            };

            this.process!.stderr!.on('data', onStderr);
        });
    }

    public async getCompletions(code: string, cursorPos: number, contextCode?: string): Promise<any[]> {
        if (!this.process || !this.isReady) {
            throw new Error('Julia worker not running');
        }

        return new Promise((resolve, reject) => {
            const request = { command: 'COMPLETE', code, cursor_pos: cursorPos, context_code: contextCode };
            this.process!.stdin!.write(JSON.stringify(request) + '\n');

            const onStderr = (data: Buffer) => {
                const lines = data.toString().split('\n');
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const response = JSON.parse(line);
                        if (response.type === 'completions') {
                            cleanup();
                            resolve(response.completions);
                            return;
                        }
                    } catch (e) {
                        // ignore
                    }
                }
            };

            const cleanup = () => {
                this.process?.stderr?.off('data', onStderr);
            };

            this.process!.stderr!.on('data', onStderr);
        });
    }

    public sendInput(value: string): void {
        if (this.process && this.isReady) {
            this.process.stdin?.write(JSON.stringify({ command: 'INPUT_REPLY', value }) + '\n');
        }
    }

    public interrupt(): void {
        if (this.process && !this.process.killed) {
            this.process.kill('SIGINT');
        }
    }

    public stop(): void {
        if (this.process) {
            try {
                this.process.stdin?.write(JSON.stringify({ command: 'SHUTDOWN' }) + '\n');
            } catch (e) {
                // ignore
            }

            setTimeout(() => {
                if (this.process && !this.process.killed) {
                    this.process.kill();
                }
                this.process = null;
                this.isReady = false;
            }, 1000);
        }
    }
}
