import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { PythonWorker, ExecutionResult } from './PythonWorker.js';

export interface KernelInfo {
    id: string;
    status: 'idle' | 'busy' | 'error' | 'starting';
    executionCount: number;
}

interface InternalKernelState {
    worker: PythonWorker;
    info: KernelInfo;
    notebookId: string;
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

    public async startKernel(notebookId: string): Promise<KernelInfo> {
        if (this.kernels.has(notebookId)) {
            return this.kernels.get(notebookId)!.info;
        }

        const worker = new PythonWorker(notebookId);
        const kernelId = uuidv4();

        const state: InternalKernelState = {
            worker,
            notebookId,
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
            this.kernels.delete(notebookId);
            this.emit('kernel:stopped', notebookId);
        }
    }

    public async executeCode(notebookId: string, code: string): Promise<ExecutionResult> {
        let state = this.kernels.get(notebookId);

        if (!state) {
            // Auto-start kernel if not running
            await this.startKernel(notebookId);
            state = this.kernels.get(notebookId)!;
        }

        if (state.info.status === 'busy') {
            throw new Error('Kernel is busy');
        }

        state.info.status = 'busy';
        this.emit('kernel:status_change', notebookId, 'busy');

        try {
            const result = await state.worker.execute(code);
            state.info.executionCount++;
            state.info.status = 'idle';
            this.emit('kernel:status_change', notebookId, 'idle');
            return result;
        } catch (error: any) {
            state.info.status = 'error';
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

    public getKernelMetrics(notebookId: string): KernelMetrics {
        const state = this.kernels.get(notebookId);

        if (!state) {
            return {
                notebook_id: notebookId,
                available: false,
                status: 'disconnected'
            };
        }

        return {
            notebook_id: notebookId,
            available: true,
            pid: state.worker.pid,
            status: state.info.status,
            memory_mb: 50, // Stub
            memory_percent: 1.5, // Stub
            cpu_percent: 0.5 // Stub
        };
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
}

export interface KernelMetrics {
    notebook_id: string;
    available: boolean;
    pid?: number;
    memory_mb?: number;
    memory_percent?: number;
    cpu_percent?: number;
    status?: string;
    error?: string;
}
