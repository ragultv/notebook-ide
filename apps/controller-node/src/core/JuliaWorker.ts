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

        // Resolve absolute path for Julia executable
        const actualJuliaPath = await this.resolveActualJuliaPath();
        console.log(`[JuliaWorker] Using Julia executable: ${actualJuliaPath}`);


        if (!fs.existsSync(this.workerScript)) {
            const error = `Julia worker script not found at ${this.workerScript}`;
            console.error(error);
            throw new Error(error);
        }

        // Resolve the Project.toml directory for Julia environment management
        const projectDir = path.dirname(this.workerScript);

        this.process = execa(
            actualJuliaPath,
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

    private async resolveActualJuliaPath(): Promise<string> {
        // If the path is already set to something that looks like an absolute path, check it
        if (path.isAbsolute(this.juliaPath)) {
            if (fs.existsSync(this.juliaPath)) return this.juliaPath;
            // On Windows, if they pointed to a folder, try appending bin/julia.exe
            if (process.platform === 'win32') {
                const binPath = path.join(this.juliaPath, 'bin', 'julia.exe');
                if (fs.existsSync(binPath)) return binPath;
            }
        }

        // Auto-discovery logic for Windows if the current juliaPath is just "julia"
        if (this.juliaPath === 'julia' && process.platform === 'win32') {
            const userProfile = process.env.USERPROFILE || '';
            const localAppData = process.env.LOCALAPPDATA || path.join(userProfile, 'AppData', 'Local');

            const candidates = [
                // 1. Windows Store Alias (often where it lands first)
                path.join(localAppData, 'Microsoft', 'WindowsApps', 'julia.exe'),
            ];

            // 2. Discover standard installations in AppData\Local\Programs\Julia-*
            try {
                const programsDir = path.join(localAppData, 'Programs');
                if (fs.existsSync(programsDir)) {
                    const dirs = await fs.readdir(programsDir);
                    const juliaDirs = dirs
                        .filter(d => d.toLowerCase().startsWith('julia-'))
                        .sort((a, b) => b.localeCompare(a)); // Check newer versions first

                    for (const d of juliaDirs) {
                        candidates.push(path.join(programsDir, d, 'bin', 'julia.exe'));
                    }
                }
            } catch (e) { /* ignore */ }

            // 3. Program Files
            candidates.push('C:\\Program Files\\Julia\\bin\\julia.exe');

            for (const c of candidates) {
                if (fs.existsSync(c)) return c;
            }
        }

        // Fallback to the provided string — might be in manual PATH or a full path already
        return this.juliaPath;
    }
}

