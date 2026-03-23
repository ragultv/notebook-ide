import { execa, execaSync, Subprocess } from 'execa';
import path from 'path';
import { EventEmitter } from 'events';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { runtimePaths } from '../runtimePaths.js';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Types for communication
interface WorkerConfig {
    max_memory_mb?: number;
}

interface ExecutionRequest {
    command: 'EXECUTE';
    code: string;
}

interface ShutdownRequest {
    command: 'SHUTDOWN';
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

export class PythonWorker extends EventEmitter {
    private process: Subprocess | null = null;
    private workerScript: string;
    private pythonPath: string;
    public readonly notebookId: string;
    private isReady: boolean = false;

    constructor(notebookId: string, pythonPath?: string) {
        super();
        this.notebookId = notebookId;


        if (pythonPath) {
            this.pythonPath = pythonPath;
        } else if (process.env.PYTHON_EXECUTABLE) {
            this.pythonPath = process.env.PYTHON_EXECUTABLE;
        } else {
            this.pythonPath = this.findAvailablePython();
        }

        const possiblePaths = [
            path.join(runtimePaths.kernelPythonDir, 'worker_entry.py'),
            path.resolve(__dirname, '../../../kernel-python/worker_entry.py'),
            path.resolve(process.cwd(), '../kernel-python/worker_entry.py'),
        ];

        // Find the first path that exists
        const foundPath = possiblePaths.find(p => fs.existsSync(p));

        if (!foundPath) {
            console.error('Worker script not found. Tried paths:', possiblePaths);
            console.error('__dirname:', __dirname);
            console.error('process.cwd():', process.cwd());
        }

        this.workerScript = foundPath || possiblePaths[0];
    }

    private findAvailablePython(): string {
        // Attempt to find a stable Python interpreter on PATH.
        // Prefer python3 where available.
        const candidates = ['python3', 'python', 'python3.11', 'python3.10', 'python3.9', 'python3.8', 'python3.7'];
        for (const candidate of candidates) {
            try {
                const result = execaSync(candidate, ['--version'], { stdio: 'ignore' });
                if (result.exitCode === 0) {
                    return candidate;
                }
            } catch {
                // ignore and try next candidate
            }
        }

        console.warn(
            'Unable to locate a Python executable (tried python3, python, and common python3 versions).',
            'Set PYTHON_EXECUTABLE to the path of a Python binary if you have a custom installation.'
        );

        // Fall back to 'python' so the error path remains consistent if it truly isn't present.
        return 'python';
    }

    public static async listAvailablePythonVersions(): Promise<Array<{ path: string; version: string }>> {
        const candidates = [
            'python3',
            'python',
            'python3.11',
            'python3.10',
            'python3.9',
            'python3.8',
            'python3.7',
            'python2',
        ];

        const foundPaths = new Set<string>();

        // Helper to resolve if an executable exists on PATH
        const probe = async (exe: string) => {
            try {
                const whichCmd = process.platform === 'win32' ? 'where' : 'which';
                const { stdout } = await execa(whichCmd, [exe]);
                for (const line of stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
                    foundPaths.add(line);
                }
            } catch {
                // ignore
            }
        };

        for (const candidate of candidates) {
            await probe(candidate);
        }

        const versions: Array<{ path: string; version: string }> = [];
        for (const p of Array.from(foundPaths)) {
            try {
                const { stdout } = await execa(p, ['-c', 'import sys; print(sys.version.split()[0])'], {
                    timeout: 5000,
                });
                versions.push({ path: p, version: stdout.trim() });
            } catch {
                // ignore non-executable things
            }
        }

        return versions.sort((a, b) => a.version.localeCompare(b.version));
    }

    public get pid(): number | undefined {
        return this.process?.pid;
    }

    public async start(config: WorkerConfig = {}): Promise<void> {
        if (this.process) return;

        if (!fs.existsSync(this.workerScript)) {
            const error = `Worker script not found at ${this.workerScript}. Tried paths: ${this.workerScript}`;
            console.error(error);
            throw new Error(error);
        }

        console.log(`Starting Python worker: ${this.pythonPath} ${this.workerScript}`);

        this.process = execa(this.pythonPath, [this.workerScript], {
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe', // JSON-RPC responses come via stderr
            buffer: false,
        });

        if (!this.process.stdin || !this.process.stderr) {
            throw new Error('Failed to open streams for Python worker');
        }

        // Send configuration
        this.process.stdin.write(JSON.stringify(config) + '\n');

        // Wait for ready signal with timeout
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                console.error('Python worker failed to start within 5 seconds');
                reject(new Error('Python worker startup timeout'));
            }, 5000);

            const onData = (data: Buffer) => {
                const line = data.toString().trim();
                console.log('Worker output:', line);
                try {
                    const response = JSON.parse(line);
                    if (response.status === 'ready') {
                        this.isReady = true;
                        this.process?.stderr?.off('data', onData);
                        this.process?.stderr?.off('error', onError);
                        clearTimeout(timeout);
                        resolve();
                    } else {
                        reject(new Error(`Worker failed to start: ${JSON.stringify(response)}`));
                    }
                } catch (e) {
                    // Not JSON, might be debug output
                }
            };

            const onError = (error: Error) => {
                console.error('Worker stderr error:', error);
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

            // Safety timeout
            setTimeout(() => {
                if (!this.isReady) {
                    processStderr.off('data', onData);
                    processStderr.off('error', onError);
                    this.process?.kill();
                    reject(new Error('Worker startup timed out'));
                }
            }, 5500);
        });
    }

    public async execute(code: string, timeoutMs: number = 0, onStream?: (streamEvent: any) => void): Promise<ExecutionResult> {
        if (!this.process || !this.isReady) {
            throw new Error('Worker not running');
        }

        return new Promise((resolve, reject) => {
            const request: ExecutionRequest = { command: 'EXECUTE', code };
            this.process!.stdin!.write(JSON.stringify(request) + '\n');

            const onStderr = (data: Buffer) => {
                const lines = data.toString().split('\n');
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const response = JSON.parse(line);

                        // Handle streaming and interaction output
                        if ((response.type === 'stream' || response.type === 'input_request') && onStream) {
                            onStream(response);
                            continue;
                        }

                        if (response.status && response.status !== 'ready') { // Valid result has a status
                            cleanup();
                            resolve(response as ExecutionResult);
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
            throw new Error('Worker not running');
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
            throw new Error('Worker not running');
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
                // Try graceful shutdown
                this.process.stdin?.write(JSON.stringify({ command: 'SHUTDOWN' }) + '\n');
            } catch (e) {
                // ignore
            }

            // Kill if still running
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
