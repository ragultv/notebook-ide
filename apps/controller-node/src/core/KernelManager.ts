import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { PythonWorker, ExecutionResult } from './PythonWorker.js';
import { JuliaWorker } from './JuliaWorker.js';
import { TerminalWorker } from './TerminalWorker.js';

export type KernelLanguage = 'python' | 'julia';

export interface KernelInfo {
    id: string;
    status: 'idle' | 'busy' | 'error' | 'starting';
    executionCount: number;
    language: KernelLanguage;
}

interface InternalKernelState {
    worker: PythonWorker | JuliaWorker;
    info: KernelInfo;
    notebookId: string;
    language: KernelLanguage;
    activeTerminal?: TerminalWorker;
}

export class KernelManager extends EventEmitter {
    private static instance: KernelManager;
    private kernels: Map<string, InternalKernelState> = new Map(); // notebookId -> state

    private constructor() {
        super();
    }

    public static getInstance(): KernelManager {
        if (!KernelManager.instance) {
            KernelManager.instance = new KernelManager();
        }
        return KernelManager.instance;
    }

    public async startKernel(notebookId: string, language: KernelLanguage = 'python', device?: 'cpu' | 'cuda'): Promise<KernelInfo> {
        if (this.kernels.has(notebookId)) {
            return this.kernels.get(notebookId)!.info;
        }

        const worker: PythonWorker | JuliaWorker =
            language === 'julia' ? new JuliaWorker(notebookId) : new PythonWorker(notebookId);
        const kernelId = uuidv4();

        const state: InternalKernelState = {
            worker,
            notebookId,
            language,
            info: {
                id: kernelId,
                status: 'starting',
                executionCount: 0,
                language,
            }
        };

        this.kernels.set(notebookId, state);

        try {
            await worker.start({ device });
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
            this.kernels.delete(notebookId);
            this.emit('kernel:stopped', notebookId);
        }
    }

    public async executeCode(notebookId: string, code: string, onStream?: (streamEvent: any) => void, language: KernelLanguage = 'python', device?: 'cpu' | 'cuda'): Promise<ExecutionResult> {
        let state = this.kernels.get(notebookId);

        if (!state) {
            // Auto-start kernel; use supplied language and device
            await this.startKernel(notebookId, language, device);
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

            // Best-effort GPU memory — system-wide VRAM used (not per-process)
            let gpuMemoryMb = 0;
            try {
                const graphicsData = await si.graphics();
                const controller = graphicsData.controllers[0];
                if (controller && controller.memoryUsed != null) {
                    gpuMemoryMb = controller.memoryUsed; // already in MB
                }
            } catch {
                // GPU metrics unavailable on this platform
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
                gpu_memory_mb: gpuMemoryMb,
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
