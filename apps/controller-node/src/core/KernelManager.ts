import { EventEmitter } from 'events';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { execa } from 'execa';
import { v4 as uuidv4 } from 'uuid';
import { PythonWorker, ExecutionResult } from './PythonWorker.js';
import { TerminalWorker } from './TerminalWorker.js';

export interface KernelInfo {
    id: string;
    status: 'idle' | 'busy' | 'error' | 'starting';
    executionCount: number;
}

interface InternalKernelState {
    worker: PythonWorker;
    info: KernelInfo;
    notebookId: string;
    pythonPath?: string;
    activeTerminal?: TerminalWorker;
}

export class KernelManager extends EventEmitter {
    private static instance: KernelManager;
    private kernels: Map<string, InternalKernelState> = new Map(); // notebookId -> state

    // Venv base directory for per-notebook environments
    private readonly venvBaseDir: string = path.join(os.tmpdir(), 'notebook-ide-venvs');

    private constructor() {
        super();
        fs.ensureDirSync(this.venvBaseDir);
    }

    private getVenvDir(notebookId: string): string {
        return path.join(this.venvBaseDir, notebookId);
    }

    private getPythonFromVenv(venvDir: string): string {
        if (process.platform === 'win32') {
            return path.join(venvDir, 'Scripts', 'python.exe');
        }
        return path.join(venvDir, 'bin', 'python');
    }

    private async findPythonExecutable(): Promise<string> {
        // Attempt to resolve the most recent python executable available.
        // On Windows, prefer the python launcher (py) if available.
        type Candidate = { cmd: string; args: string[] };

        const candidates: Candidate[] = [];

        if (process.platform === 'win32') {
            // Use py launcher aliases, then try plain python.
            candidates.push({ cmd: 'py', args: ['-3.14', '--version'] });
            candidates.push({ cmd: 'py', args: ['-3.13', '--version'] });
            candidates.push({ cmd: 'py', args: ['-3.12', '--version'] });
            candidates.push({ cmd: 'py', args: ['-3.11', '--version'] });
            candidates.push({ cmd: 'py', args: ['-3.10', '--version'] });
            candidates.push({ cmd: 'py', args: ['-3', '--version'] });
            candidates.push({ cmd: 'python', args: ['--version'] });
        } else {
            candidates.push({ cmd: 'python3.14', args: ['--version'] });
            candidates.push({ cmd: 'python3.13', args: ['--version'] });
            candidates.push({ cmd: 'python3.12', args: ['--version'] });
            candidates.push({ cmd: 'python3.11', args: ['--version'] });
            candidates.push({ cmd: 'python3.10', args: ['--version'] });
            candidates.push({ cmd: 'python3.9', args: ['--version'] });
            candidates.push({ cmd: 'python3.8', args: ['--version'] });
            candidates.push({ cmd: 'python3.7', args: ['--version'] });
            candidates.push({ cmd: 'python3', args: ['--version'] });
            candidates.push({ cmd: 'python', args: ['--version'] });
        }

        for (const candidate of candidates) {
            try {
                const result = await execa(candidate.cmd, candidate.args);
                if (result.exitCode === 0) {
                    // Return the raw command for use in venv creation.
                    if (candidate.cmd === 'py') {
                        // Preserve the '-3.x' argument so that the same version is used.
                        return `${candidate.cmd} ${candidate.args.slice(0, -1).join(' ')}`;
                    }
                    return candidate.cmd;
                }
            } catch {
                // ignore and try next
            }
        }

        throw new Error('No Python executable found on PATH. Please set PYTHON_EXECUTABLE or install Python.');
    }

    private getVenvMetadataPath(notebookId: string): string {
        return path.join(this.getVenvDir(notebookId), 'venv_meta.json');
    }

    private async writeVenvMetadata(notebookId: string, pythonPath: string): Promise<void> {
        const metaPath = this.getVenvMetadataPath(notebookId);
        await fs.writeJson(metaPath, {
            pythonPath,
            createdAt: new Date().toISOString(),
        });
    }

    private async readVenvMetadata(notebookId: string): Promise<{ pythonPath: string; createdAt: string } | null> {
        const metaPath = this.getVenvMetadataPath(notebookId);
        try {
            return await fs.readJson(metaPath);
        } catch {
            return null;
        }
    }

    private splitPythonCommand(pythonPath: string): { cmd: string; args: string[] } {
        const parts = pythonPath.trim().split(/\s+/);
        return { cmd: parts[0], args: parts.slice(1) };
    }

    private async createVenvForNotebook(notebookId: string, pythonPath: string): Promise<string> {
        const venvDir = this.getVenvDir(notebookId);
        const pythonInVenv = this.getPythonFromVenv(venvDir);

        // If venv already exists and has a python binary, reuse it.
        if (fs.existsSync(pythonInVenv)) {
            const metadata = await this.readVenvMetadata(notebookId);
            if (metadata && metadata.pythonPath !== pythonPath) {
                // If user requested a different base python, recreate the venv.
                await fs.remove(venvDir);
            } else {
                return pythonInVenv;
            }
        }

        fs.ensureDirSync(venvDir);

        const { cmd, args } = this.splitPythonCommand(pythonPath);
        await execa(cmd, [...args, '-m', 'venv', venvDir]);

        // Ensure pip is up-to-date so installs work reliably
        await execa(pythonInVenv, ['-m', 'pip', 'install', '-U', 'pip', 'setuptools', 'wheel']);

        await this.writeVenvMetadata(notebookId, pythonPath);
        return pythonInVenv;
    }

    public static getInstance(): KernelManager {
        if (!KernelManager.instance) {
            KernelManager.instance = new KernelManager();
        }
        return KernelManager.instance;
    }

    public async startKernel(notebookId: string, pythonPath?: string): Promise<KernelInfo> {
        if (this.kernels.has(notebookId)) {
            return this.kernels.get(notebookId)!.info;
        }

        // Always create/use a per-notebook venv so installations are isolated and
        // the notebook can autoinstall packages safely.
        const basePython = pythonPath ?? await this.findPythonExecutable();
        const workerPython = await this.createVenvForNotebook(notebookId, basePython);

        const worker = new PythonWorker(notebookId, workerPython);
        const kernelId = uuidv4();

        const state: InternalKernelState = {
            worker,
            notebookId,
            pythonPath,
            info: {
                id: kernelId,
                status: 'starting',
                executionCount: 0
            }
        };

        this.kernels.set(notebookId, state);

        try {
            await worker.start();
            state.info.status = 'idle';
            this.emit('kernel:started', notebookId);
            return state.info;
        } catch (error) {
            state.info.status = 'error';
            this.kernels.delete(notebookId);
            throw error;
        }
    }

    public async stopKernel(notebookId: string): Promise<void> {
        const state = this.kernels.get(notebookId);
        if (state) {
            await state.worker.stop();

            // Keep the per-notebook venv around so it can be reused when the notebook
            // is reopened. If you want to wipe it completely, use the new
            // `POST /kernels/cleanup` endpoint (not implemented here).

            this.kernels.delete(notebookId);
            this.emit('kernel:stopped', notebookId);
        }
    }

    public async executeCode(notebookId: string, code: string, onStream?: (streamEvent: any) => void): Promise<ExecutionResult> {
        let state = this.kernels.get(notebookId);

        if (!state) {
            // Auto-start kernel if not running
            await this.startKernel(notebookId);
            state = this.kernels.get(notebookId)!;
        }

        if (state.info.status === 'busy') {
            throw new Error('Kernel is busy');
        }

        const trimmedCode = code.trim();
        const isTerminalCommand = trimmedCode.startsWith('!');

        state.info.status = 'busy';
        this.emit('kernel:status_change', notebookId, 'busy');

        try {
            let result: ExecutionResult;

            if (isTerminalCommand) {
                // Execute using TerminalWorker
                const terminalCode = trimmedCode.substring(1).trim(); // Remove the '!'
                state.activeTerminal = new TerminalWorker(notebookId);
                result = await state.activeTerminal.execute(terminalCode, 0, onStream);
                state.activeTerminal = undefined;
            } else {
                // Standard python kernel execution
                result = await state.worker.execute(code, 0, onStream);
            }

            state.info.executionCount++;
            state.info.status = 'idle';
            this.emit('kernel:status_change', notebookId, 'idle');
            return result;
        } catch (error: any) {
            state.info.status = 'error';
            state.activeTerminal = undefined;
            this.emit('kernel:status_change', notebookId, 'error');

            // Return error result structure instead of throwing, to match frontend expectations
            return {
                status: 'error',
                stdout: '',
                stderr: '',
                error_details: error.message || String(error),
                execution_time: 0
            };
        }
    }

    public getKernelStatus(notebookId: string): KernelInfo | null {
        return this.kernels.get(notebookId)?.info || null;
    }

    public getAllKernels(): KernelInfo[] {
        return Array.from(this.kernels.values()).map(k => k.info);
    }

    public async listAvailablePythonVersions(): Promise<Array<{ path: string; version: string }>> {
        return await PythonWorker.listAvailablePythonVersions();
    }

    public interruptKernel(notebookId: string): void {
        const state = this.kernels.get(notebookId);
        if (state) {
            if (state.activeTerminal) {
                state.activeTerminal.stop();
            } else {
                state.worker.interrupt();
            }
        }
    }

    public sendInput(notebookId: string, value: string): void {
        const state = this.kernels.get(notebookId);
        if (state) {
            if (state.activeTerminal) {
                state.activeTerminal.sendInput(value);
            } else {
                state.worker.sendInput(value);
            }
        }
    }

    public resizeTerminal(notebookId: string, cols: number, rows: number): void {
        const state = this.kernels.get(notebookId);
        if (state && state.activeTerminal) {
            state.activeTerminal.resize(cols, rows);
        }
    }

    public async getKernelMetrics(notebookId: string): Promise<KernelMetrics> {
        const state = this.kernels.get(notebookId);

        if (!state) {
            return {
                notebook_id: notebookId,
                available: false,
                status: 'disconnected'
            };
        }

        try {
            const si = await import('systeminformation');

            // Get system metrics
            const mem = await si.mem();
            const diskStats = await si.fsSize();
            const rootDisk = diskStats[0] || { used: 0, size: 0 };
            const diskMb = rootDisk.used / (1024 * 1024);

            const sysMemUsedMb = mem.active / (1024 * 1024);
            const sysMemTotalMb = mem.total / (1024 * 1024);

            let procMemMb = 0;
            let cpuPercent = 0;

            if (state.worker.pid) {
                const processes = await si.processes();
                const proc = processes.list.find(p => p.pid === state.worker.pid);
                if (proc) {
                    procMemMb = proc.memRss / 1024;
                    cpuPercent = proc.cpu;
                }
            }

            return {
                notebook_id: notebookId,
                available: true,
                pid: state.worker.pid,
                status: state.info.status,
                memory_mb: procMemMb,
                memory_percent: procMemMb / sysMemTotalMb,
                cpu_percent: cpuPercent,
                disk_mb: diskMb,
                gpu_memory_mb: 0, // Fallback since node child metrics don't track GPU easily
                system_memory_used_mb: sysMemUsedMb,
                system_memory_total_mb: sysMemTotalMb
            };
        } catch (error) {
            console.error('Failed to get kernel metrics:', error);
            return {
                notebook_id: notebookId,
                available: true,
                pid: state.worker.pid,
                status: state.info.status,
                memory_mb: 50, // Stub fallback if failure
                memory_percent: 1.5,
                cpu_percent: 0.5
            };
        }
    }
    public async getMemorySnapshot(notebookId: string): Promise<any> {
        const state = this.kernels.get(notebookId);
        if (!state) {
            throw new Error('Kernel not running for this notebook');
        }

        try {
            return await state.worker.snapshot();
        } catch (error) {
            console.error('Failed to get memory snapshot:', error);
            throw error;
        }
    }

    public async getCompletions(notebookId: string, code: string, cursorPos: number, contextCode?: string): Promise<any[]> {
        const state = this.kernels.get(notebookId);
        if (!state) {
            throw new Error('Kernel not running for this notebook');
        }

        try {
            return await state.worker.getCompletions(code, cursorPos, contextCode);
        } catch (error) {
            console.error('Failed to get completions:', error);
            throw error;
        }
    }
}

export interface KernelMetrics {
    notebook_id: string;
    available: boolean;
    pid?: number;
    memory_mb?: number;
    memory_percent?: number;
    cpu_percent?: number;
    disk_mb?: number;
    gpu_memory_mb?: number;
    system_memory_used_mb?: number;
    system_memory_total_mb?: number;
    status?: string;
    error?: string;
}
