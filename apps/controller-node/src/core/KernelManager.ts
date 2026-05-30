import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { BridgeProcess, BridgeMessage } from './BridgeProcess.js';
import { claimFromPool, initPool, drainPool } from './KernelPool.js';

export interface KernelInfo {
    id: string;
    status: 'idle' | 'busy' | 'error' | 'starting';
    executionCount: number;
}

export interface ExecutionResult {
    status: 'success' | 'error' | 'timeout' | 'killed' | 'crashed';
    stdout: string;
    stderr: string;
    error_details?: string;
    execution_time: number;
    outputs?: any[];
    execution_count?: number;
}

interface InternalKernelState {
    bridge: BridgeProcess;
    info: KernelInfo;
    notebookId: string;
    executionCallbacks: Map<string, {
        onOutput: (output: any) => void;
        onComplete: (result: any) => void;
        onError: (error: string) => void;
        completed: boolean;
        timeoutId?: NodeJS.Timeout;
    }>;
    inputRequestPending: boolean;
    /** FIFO serial queue — each execution chains onto this promise so cells never
     *  run concurrently on the same kernel (mirrors Jupyter / Google Colab semantics). */
    executionQueue: Promise<any>;
}

export class KernelManager extends EventEmitter {
    private static instance: KernelManager;
    private kernels: Map<string, InternalKernelState> = new Map(); // notebookId -> state
    private pythonPath: string = 'python';

    private constructor() {
        super();
    }

    public static getInstance(): KernelManager {
        if (!KernelManager.instance) {
            KernelManager.instance = new KernelManager();
        }
        return KernelManager.instance;
    }

    public async initializePool(): Promise<void> {
        await initPool(this.pythonPath);
    }

    public async drainPool(): Promise<void> {
        await drainPool();
    }

    public async startKernel(notebookId: string): Promise<KernelInfo> {
        if (this.kernels.has(notebookId)) {
            return this.kernels.get(notebookId)!.info;
        }

        const kernelId = uuidv4();

        // Get bridge from pool or create new one
        const bridge = await claimFromPool(notebookId, this.pythonPath);

        const state: InternalKernelState = {
            bridge,
            notebookId,
            info: {
                id: kernelId,
                status: 'starting',
                executionCount: 0
            },
            executionCallbacks: new Map(),
            inputRequestPending: false,
            executionQueue: Promise.resolve(),
        };

        this.kernels.set(notebookId, state);

        // Set up bridge message handler
        bridge.on('message', (msg: BridgeMessage) => {
            this.handleBridgeMessage(notebookId, msg);
        });

        // Handle bridge exit (crash recovery)
        bridge.on('exit', (code) => {
            console.log(`[KernelManager] Bridge for ${notebookId} exited with code ${code}`);
            this.handleBridgeCrash(notebookId);
        });

        try {
            state.info.status = 'idle';
            this.emit('kernel:started', notebookId);
            return state.info;
        } catch (error) {
            state.info.status = 'error';
            this.kernels.delete(notebookId);
            throw error;
        }
    }

    private handleBridgeMessage(notebookId: string, msg: BridgeMessage): void {
        const state = this.kernels.get(notebookId);
        if (!state) return;

        const executionId = msg.execution_id;
        const callbacks = executionId ? state.executionCallbacks.get(executionId) : undefined;

        switch (msg.type) {
            case 'status':
                const oldStatus = state.info.status;
                state.info.status = msg.state === 'busy' ? 'busy' : 'idle';
                this.emit('kernel:status_change', notebookId, state.info.status);

                // Detect execution completion: busy -> idle transition for a specific execution
                // This handles cases like print() where there's no result message
                if (oldStatus === 'busy' && state.info.status === 'idle' && callbacks && !callbacks.completed) {
                    // Complete with success - execution finished without error
                    state.info.executionCount++;
                    callbacks.onComplete({
                        status: 'success',
                        stdout: '',
                        stderr: '',
                        execution_count: state.info.executionCount,
                        outputs: []
                    });
                }
                break;

            case 'stream':
                if (callbacks) {
                    callbacks.onOutput({
                        type: 'stream',
                        stream: msg.name,
                        data: msg.text
                    });
                }
                break;

            case 'result':
                // Execute result - store execution count and output, but don't complete yet
                // Wait for the idle status to ensure all output is captured
                if (callbacks) {
                    callbacks.onOutput({
                        type: msg.type,
                        data: msg.data,
                        execution_count: msg.execution_count
                    });
                }
                break;

            case 'display':
                if (callbacks) {
                    callbacks.onOutput({
                        type: msg.type,
                        data: msg.data,
                        execution_count: msg.execution_count
                    });
                }
                break;

            case 'error':
                if (callbacks && !callbacks.completed) {
                    callbacks.onError(`${msg.ename}: ${msg.evalue}\n${msg.traceback}`);
                }
                break;

            case 'input_request':
                state.inputRequestPending = true;
                // Clear the timeout since we're waiting for user input
                if (callbacks?.timeoutId) {
                    clearTimeout(callbacks.timeoutId);
                }
                this.emit('kernel:input_request', notebookId, {
                    execution_id: msg.execution_id,
                    prompt: msg.prompt,
                    password: msg.password
                });
                break;

            case 'kernel_dead':
                this.emit('kernel:dead', notebookId);
                break;

            case 'kernel_restarted':
                state.info.executionCount = 0;
                this.emit('kernel:restarted', notebookId);
                break;

            case 'variables':
                this.emit('kernel:variables', notebookId, msg.data);
                break;

            case 'completions':
                // P1-2: route completion reply to getCompletions() promise listener
                this.emit('kernel:completions', notebookId, {
                    request_id:   msg.request_id,
                    matches:      msg.matches,
                    cursor_start: msg.cursor_start,
                    cursor_end:   msg.cursor_end,
                });
                break;

            case 'debug':
                console.log(`[Bridge ${notebookId}] ${msg.message}`);
                this.emit('kernel:debug', notebookId, msg.message);
                break;

            // Comm protocol - widgets (ipywidgets, tqdm, HuggingFace)
            case 'comm_open':
                console.log(`[Bridge ${notebookId}] comm_open: target=${msg.target_name}, comm_id=${msg.comm_id}`);
                this.emit('kernel:comm_open', notebookId, {
                    comm_id: msg.comm_id,
                    target_name: msg.target_name,
                    data: msg.data,
                    metadata: msg.metadata,
                    execution_id: executionId
                });
                break;

            case 'comm_msg':
                this.emit('kernel:comm_msg', notebookId, {
                    comm_id: msg.comm_id,
                    data: msg.data
                });
                break;

            case 'comm_close':
                this.emit('kernel:comm_close', notebookId, msg.comm_id);
                break;

            default:
                // Log unknown message types for debugging
                if (msg.type !== 'ready') {
                    console.log(`[Bridge ${notebookId}] Unknown message type: ${msg.type}`);
                }
                break;
        }
    }

    private async handleBridgeCrash(notebookId: string): Promise<void> {
        const state = this.kernels.get(notebookId);
        if (!state) return;

        console.log(`[KernelManager] Attempting to reconnect bridge for ${notebookId}...`);

        // Wait 1 second then reconnect
        setTimeout(async () => {
            try {
                const newBridge = new BridgeProcess(notebookId, this.pythonPath);
                await newBridge.start(true); // reconnect=true

                // Update state with new bridge
                state.bridge = newBridge;
                state.info.status = 'idle';

                // Re-attach listeners
                newBridge.on('message', (msg: BridgeMessage) => {
                    this.handleBridgeMessage(notebookId, msg);
                });

                newBridge.on('exit', (_code) => {
                    this.handleBridgeCrash(notebookId);
                });

                this.emit('kernel:reconnected', notebookId);
                console.log(`[KernelManager] Successfully reconnected bridge for ${notebookId}`);
            } catch (e) {
                console.error(`[KernelManager] Failed to reconnect bridge for ${notebookId}:`, e);
                this.kernels.delete(notebookId);
                this.emit('kernel:disconnected', notebookId);
            }
        }, 1000);
    }

    public async stopKernel(notebookId: string): Promise<void> {
        const state = this.kernels.get(notebookId);
        if (state) {
            try {
                state.bridge.send({ type: 'shutdown', notebook_id: notebookId });
                await new Promise(r => setTimeout(r, 500));
            } catch (e) {
                // Ignore errors during shutdown
            }
            state.bridge.kill();
            this.kernels.delete(notebookId);
            this.emit('kernel:stopped', notebookId);
        }
    }

    public async executeCode(
        notebookId: string,
        code: string,
        callbacks?: {
            onOutput?: (output: any) => void;
            onComplete?: (result: ExecutionResult) => void;
            onError?: (error: string) => void;
        },
        providedExecutionId?: string
    ): Promise<ExecutionResult> {
        let state = this.kernels.get(notebookId);

        if (!state) {
            // Auto-start kernel if not running
            await this.startKernel(notebookId);
            state = this.kernels.get(notebookId)!;
        }

        // Use caller-supplied executionId so the WebSocket route can tell the browser
        // the SAME id it passes here — without this the browser listens to a phantom id.
        const executionId = providedExecutionId ?? uuidv4();
        const cellId = 'cell_' + Date.now();

        // ── Serial FIFO queue: chain this execution onto the previous one.
        // The promise stored in state.executionQueue resolves only when the PREVIOUS
        // execution fully completes (onComplete / onError / timeout). This ensures
        // back-to-back cell runs are serialised, matching Jupyter / Colab semantics.
        const executionPromise = new Promise<ExecutionResult>((resolve, _reject) => {
            // Wait for the queue head to settle, then run our execution.
            state!.executionQueue.then(async () => {
                // Refresh state after the queue wait (kernel may have restarted)
                const currentState = this.kernels.get(notebookId);
                if (!currentState) {
                    const err: ExecutionResult = { status: 'error', stdout: '', stderr: 'Kernel not found', execution_time: 0 };
                    callbacks?.onError?.('Kernel not found');
                    resolve(err);
                    return;
                }

                const outputs: any[] = [];
                const startTime = Date.now();

                const wrappedCallbacks: {
                    onOutput: (output: any) => void;
                    onComplete: (result: ExecutionResult) => void;
                    onError: (error: string) => void;
                    completed: boolean;
                    timeoutId?: NodeJS.Timeout;
                } = {
                    onOutput: (output: any) => {
                        outputs.push(output);
                        callbacks?.onOutput?.(output);
                    },
                    onComplete: (result: ExecutionResult) => {
                        const cb = currentState.executionCallbacks.get(executionId);
                        if (cb && !cb.completed) {
                            cb.completed = true;
                            if (cb.timeoutId) clearTimeout(cb.timeoutId);
                            currentState.executionCallbacks.delete(executionId);
                            const finalResult = {
                                ...result,
                                outputs,
                                execution_time: (Date.now() - startTime) / 1000
                            };
                            callbacks?.onComplete?.(finalResult);
                            resolve(finalResult);
                        }
                    },
                    onError: (error: string) => {
                        const cb = currentState.executionCallbacks.get(executionId);
                        if (cb && !cb.completed) {
                            cb.completed = true;
                            if (cb.timeoutId) clearTimeout(cb.timeoutId);
                            currentState.executionCallbacks.delete(executionId);
                            const errorResult: ExecutionResult = {
                                status: 'error',
                                stdout: '',
                                stderr: error,
                                error_details: error,
                                execution_time: (Date.now() - startTime) / 1000,
                                outputs
                            };
                            callbacks?.onError?.(error);
                            resolve(errorResult);
                        }
                    },
                    completed: false
                };

                // Shell commands (!pip) get 30 min; regular Python gets 5 min.
                const isShellCommand = code.trim().startsWith('!');
                const timeoutMs = isShellCommand ? 1_800_000 : 300_000;

                const timeoutId = setTimeout(() => {
                    if (currentState.inputRequestPending) return;
                    if (currentState.executionCallbacks.has(executionId)) {
                        currentState.executionCallbacks.delete(executionId);
                        const timeoutResult: ExecutionResult = {
                            status: 'timeout',
                            stdout: '',
                            stderr: `Execution timed out after ${timeoutMs / 1000} seconds`,
                            error_details: 'Execution timed out',
                            execution_time: timeoutMs / 1000,
                            outputs
                        };
                        callbacks?.onComplete?.(timeoutResult);
                        resolve(timeoutResult);
                    }
                }, timeoutMs);

                wrappedCallbacks.timeoutId = timeoutId;
                currentState.executionCallbacks.set(executionId, wrappedCallbacks);

                currentState.bridge.send({
                    type: 'execute',
                    notebook_id: notebookId,
                    cell_id: cellId,
                    code,
                    execution_id: executionId
                });
            }).catch((err) => {
                const errorResult: ExecutionResult = { status: 'error', stdout: '', stderr: String(err), execution_time: 0 };
                callbacks?.onError?.(String(err));
                resolve(errorResult);
            });
        });

        // Update the queue head — next execution will chain onto this one.
        // We use a catch-all so a failed execution still unlocks the queue.
        state!.executionQueue = executionPromise.catch(() => {});

        return executionPromise;
    }

    public async interruptKernel(notebookId: string): Promise<void> {
        const state = this.kernels.get(notebookId);
        if (state) {
            state.bridge.send({
                type: 'interrupt',
                notebook_id: notebookId
            });
        }
    }

    public async restartKernel(notebookId: string): Promise<void> {
        const state = this.kernels.get(notebookId);
        if (state) {
            state.bridge.send({
                type: 'restart',
                notebook_id: notebookId
            });
            state.info.executionCount = 0;
        }
    }

    public async sendStdin(notebookId: string, executionId: string, value: string): Promise<void> {
        const state = this.kernels.get(notebookId);
        if (state) {
            state.bridge.send({
                type: 'stdin_reply',
                notebook_id: notebookId,
                execution_id: executionId,
                value
            });
        }
    }

    public async sendCommMsg(notebookId: string, commId: string, data: any): Promise<void> {
        const state = this.kernels.get(notebookId);
        if (state) {
            state.bridge.send({
                type: 'comm_msg',
                notebook_id: notebookId,
                comm_id: commId,
                data
            });
        }
    }

    public async getVariables(notebookId: string): Promise<void> {
        const state = this.kernels.get(notebookId);
        if (state) {
            state.bridge.send({
                type: 'get_variables',
                notebook_id: notebookId,
                execution_id: uuidv4()
            });
        }
    }

    public getKernelStatus(notebookId: string): KernelInfo | null {
        return this.kernels.get(notebookId)?.info || null;
    }

    public getAllKernels(): KernelInfo[] {
        return Array.from(this.kernels.values()).map(k => k.info);
    }

    /**
     * Resize the PTY terminal associated with this notebook.
     * No-ops gracefully if no terminal session is active.
     * Full implementation is part of P1-1 (node-pty terminal integration).
     */
    public resizeTerminal(_notebookId: string, _cols: number, _rows: number): void {
        // P1-1: node-pty session resize will be wired here.
        // No-op until terminal sessions are implemented.
    }

    public async getKernelMetrics(notebookId: string): Promise<KernelMetrics> {
        const state = this.kernels.get(notebookId);

        if (!state) {
            return { notebook_id: notebookId, available: false, status: 'disconnected' };
        }

        try {
            const si = await import('systeminformation');

            // P2-1: Use bridge PID to get per-process metrics.
            const bridgePid = state.bridge.pid;
            const [mem, diskStats] = await Promise.all([si.mem(), si.fsSize()]);
            const rootDisk = diskStats[0] || { used: 0, size: 0 };

            const sysMemUsedMb   = mem.active / (1024 * 1024);
            const sysMemTotalMb  = mem.total  / (1024 * 1024);
            const diskMb         = rootDisk.used / (1024 * 1024);

            let processMb  = 0;
            let cpuPercent = 0;

            if (bridgePid) {
                // systeminformation.processes() returns { all, running, blocked, sleeping, list[] }
                // The list array contains per-process data with memRss (KB) and cpu (%).
                const procsResult = await si.processes();
                const proc = procsResult.list?.find((p: any) => p.pid === bridgePid);
                if (proc) {
                    processMb  = (proc.memRss ?? 0) / 1024; // RSS in KB → MB
                    cpuPercent = proc.cpu ?? 0;
                }
            }

            return {
                notebook_id:           notebookId,
                available:             true,
                status:                state.info.status,
                pid:                   bridgePid,
                memory_mb:             Math.round(processMb * 100) / 100,
                memory_percent:        sysMemTotalMb > 0 ? Math.round((processMb / sysMemTotalMb) * 10000) / 100 : 0,
                cpu_percent:           Math.round(cpuPercent * 100) / 100,
                disk_mb:               Math.round(diskMb * 100) / 100,
                gpu_memory_mb:         0, // GPU metrics require nvidia-smi — out of scope for P2-1
                system_memory_used_mb: Math.round(sysMemUsedMb * 100) / 100,
                system_memory_total_mb: Math.round(sysMemTotalMb * 100) / 100,
            };
        } catch (error) {
            console.error('Failed to get kernel metrics:', error);
            return { notebook_id: notebookId, available: true, status: state.info.status };
        }
    }

    public async getMemorySnapshot(notebookId: string): Promise<any> {
        const state = this.kernels.get(notebookId);
        if (!state) {
            throw new Error('Kernel not running for this notebook');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout getting memory snapshot'));
            }, 5000);

            const onVariables = (msgNotebookId: string, data: any) => {
                if (msgNotebookId === notebookId) {
                    clearTimeout(timeout);
                    this.off('kernel:variables', onVariables);
                    resolve({
                        timestamp: Date.now() / 1000,
                        variables: data || [],
                        coordinates_2d: [],
                        total_memory_bytes: 0,
                        algorithm: 'umap'
                    });
                }
            };

            this.on('kernel:variables', onVariables);
            this.getVariables(notebookId);
        });
    }

    public async getCompletions(
        notebookId: string,
        code: string,
        cursorPos: number,
        _contextCode?: string
    ): Promise<any[]> {
        const state = this.kernels.get(notebookId);
        if (!state) return [];

        return new Promise((resolve) => {
            const requestId = uuidv4();
            const timeout = setTimeout(() => {
                this.off('kernel:completions', onCompletions);
                resolve([]);
            }, 5000);

            const onCompletions = (id: string, data: any) => {
                if (id === notebookId && data?.request_id === requestId) {
                    clearTimeout(timeout);
                    this.off('kernel:completions', onCompletions);
                    resolve(data.matches ?? []);
                }
            };

            this.on('kernel:completions', onCompletions);
            state.bridge.send({ type: 'complete', notebook_id: notebookId, request_id: requestId, code, cursor_pos: cursorPos });
        });
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
