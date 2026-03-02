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
        completed: boolean;  // Track if execution has completed
        timeoutId?: NodeJS.Timeout;  // Track timeout for cleanup
    }>;
    inputRequestPending: boolean;  // Track if waiting for user input
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
            inputRequestPending: false
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

                newBridge.on('exit', (code) => {
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

        return new Promise((resolve, reject) => {
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
                    const cb = state!.executionCallbacks.get(executionId);
                    if (cb && !cb.completed) {
                        cb.completed = true;
                        if (cb.timeoutId) {
                            clearTimeout(cb.timeoutId);
                        }
                        state!.executionCallbacks.delete(executionId);
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
                    const cb = state!.executionCallbacks.get(executionId);
                    if (cb && !cb.completed) {
                        cb.completed = true;
                        if (cb.timeoutId) {
                            clearTimeout(cb.timeoutId);
                        }
                        state!.executionCallbacks.delete(executionId);
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

            // Set timeout for execution (5 minutes for shell commands, 30s for normal code)
            // Shell commands may need longer for package installs, downloads, etc.
            const isShellCommand = code.trim().startsWith('!');
            const timeoutMs = isShellCommand ? 3000000 : 3000000; // 5 min for shell, 30s for normal

            const timeoutId = setTimeout(() => {
                // Don't timeout if waiting for user input
                if (state!.inputRequestPending) {
                    return;
                }
                if (state!.executionCallbacks.has(executionId)) {
                    state!.executionCallbacks.delete(executionId);
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
            state!.executionCallbacks.set(executionId, wrappedCallbacks);

            // Send execute command to bridge
            state!.bridge.send({
                type: 'execute',
                notebook_id: notebookId,
                cell_id: cellId,
                code: code,
                execution_id: executionId
            });
        });
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

    /** Forward raw input to the kernel bridge (used by /input route) */
    public sendInput(notebookId: string, value: string): void {
        const state = this.kernels.get(notebookId);
        if (state) {
            state.bridge.send({
                type: 'stdin_reply',
                notebook_id: notebookId,
                execution_id: '',
                value,
            });
        }
    }

    /** No-op terminal resize — placeholder for pty-based terminal support */
    public resizeTerminal(_notebookId: string, _cols: number, _rows: number): void {
        // Terminal resize is handled via the dedicated terminal WebSocket route
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

            // Bridge process doesn't expose PID directly, so we use placeholder metrics
            // In a real implementation, you might track the bridge PID
            return {
                notebook_id: notebookId,
                available: true,
                status: state.info.status,
                memory_mb: 0, // Bridge doesn't track individual process memory
                memory_percent: 0,
                cpu_percent: 0,
                disk_mb: diskMb,
                gpu_memory_mb: 0,
                system_memory_used_mb: sysMemUsedMb,
                system_memory_total_mb: sysMemTotalMb
            };
        } catch (error) {
            console.error('Failed to get kernel metrics:', error);
            return {
                notebook_id: notebookId,
                available: true,
                status: state.info.status
            };
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

    public async getCompletions(notebookId: string, code: string, cursorPos: number, contextCode?: string): Promise<any[]> {
        // TODO: Implement completions via the bridge
        // For now, return empty array
        return [];
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
