/**
 * Kernel Adapter - Connects agent's KernelInterface to the existing KernelManager
 * 
 * This adapter allows the agent components to use the shared kernel infrastructure
 * from the controller-node apps layer.
 * 
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */

import {
    KernelInterfaceConfig,
    ExecutionResult,
    VariableInfo,
    ExecutionOptions,
    KernelStatus,
    CategorizedError,
    KernelExecutionError,
    KernelTimeoutError,
    KernelConnectionError,
    KernelInterruptedError
} from '../types/agent.types';

/**
 * Interface for kernel operations (implemented by KernelManager from apps)
 */
export interface IKernelBridge {
    executeCode(
        notebookId: string,
        code: string,
        callbacks?: {
            onOutput?: (output: any) => void;
            onComplete?: (result: any) => void;
            onError?: (error: string) => void;
        },
        providedExecutionId?: string
    ): Promise<any>;
    
    interruptKernel(notebookId: string): Promise<void>;
    restartKernel(notebookId: string): Promise<void>;
    getVariables(notebookId: string): Promise<void>;
    getKernelStatus(notebookId: string): { status: string; executionCount: number } | null;
    startKernel(notebookId: string): Promise<{ status: string; executionCount: number }>;
    stopKernel(notebookId: string): Promise<void>;
    
    on(event: string, listener: (...args: any[]) => void): void;
    off(event: string, listener: (...args: any[]) => void): void;
}

/**
 * Kernel Adapter that wraps the apps' KernelManager
 * 
 * This allows the agent to use the existing kernel infrastructure
 * while maintaining the same interface expected by agent components.
 */
export class KernelAdapter {
    private config: KernelInterfaceConfig;
    private kernelBridge: IKernelBridge | null = null;
    private status: KernelStatus = 'disconnected';
    private reconnectAttempts = 0;
    private lastError: CategorizedError | null = null;
    private connectionStatusCallbacks: Array<(status: KernelStatus) => void> = [];
    private disconnectCallbacks: Array<() => void> = [];
    private reconnectCallbacks: Array<() => void> = [];
    private executionCounter = 0;
    private variables: VariableInfo[] = [];
    private executionHistory: Array<{
        cellId: string;
        timestamp: number;
        executionTime: number;
        status: 'success' | 'error';
        output: string;
    }> = [];

    /**
     * Create a new KernelAdapter
     * 
     * @param kernelBridge - The kernel bridge implementation (KernelManager from apps)
     * @param config - Kernel interface configuration
     */
    constructor(kernelBridge: IKernelBridge, config?: Partial<KernelInterfaceConfig>) {
        this.kernelBridge = kernelBridge;
        this.config = {
            notebookId: config?.notebookId || 'default-notebook',
            executionTimeout: config?.executionTimeout || 30000,
            maxRetries: config?.maxRetries || 3
        };
    }

    /**
     * Connect to the kernel
     * 
     * @param notebookId - Optional notebook ID (overrides config)
     */
    async connect(notebookId?: string): Promise<void> {
        if (notebookId) {
            this.config.notebookId = notebookId;
        }

        this.status = 'connecting';
        this.notifyConnectionStatusChange();

        try {
            if (this.kernelBridge) {
                await this.kernelBridge.startKernel(this.config.notebookId);
            }
            this.status = 'connected';
            this.reconnectAttempts = 0;
            this.notifyConnectionStatusChange();
        } catch (error) {
            this.status = 'disconnected';
            this.lastError = this.categorizeError(error as Error);
            this.notifyConnectionStatusChange();
            throw error;
        }
    }

    /**
     * Execute code in the kernel
     * 
     * @param code - Code to execute
     * @param options - Execution options
     * @returns Execution result
     */
    async execute(code: string, options?: ExecutionOptions): Promise<ExecutionResult> {
        if (!this.isConnected() || !this.kernelBridge) {
            throw new Error('Kernel not connected');
        }

        this.status = 'busy';
        this.notifyConnectionStatusChange();

        const startTime = Date.now();
        const timeout = Math.min(Math.max(options?.timeout || this.config.executionTimeout, 1000), 120000);
        const cellId = `cell-${++this.executionCounter}`;

        return new Promise((resolve) => {
            const outputs: any[] = [];

            this.kernelBridge!.executeCode(
                this.config.notebookId,
                code,
                {
                    onOutput: (output) => {
                        outputs.push(output);
                    },
                    onComplete: (result) => {
                        const executionTime = (Date.now() - startTime) / 1000;
                        
                        // Record execution history
                        this.executionHistory.push({
                            cellId,
                            timestamp: Date.now(),
                            executionTime,
                            status: result.status === 'success' ? 'success' : 'error',
                            output: result.stdout || result.stderr || ''
                        });

                        // Update variables if captured
                        if (result.variables) {
                            this.variables = this.mapVariables(result.variables);
                        }

                        const execResult: ExecutionResult = {
                            success: result.status === 'success',
                            output: result.stdout || '',
                            error: result.stderr || result.error_details,
                            executionTime,
                            outputs,
                            variables: this.variables
                        };

                        this.status = 'connected';
                        this.lastError = null;
                        this.notifyConnectionStatusChange();
                        resolve(execResult);
                    },
                    onError: (error) => {
                        const executionTime = (Date.now() - startTime) / 1000;
                        const categorizedError = this.categorizeError(new Error(error), { code, timeoutMs: timeout });
                        this.lastError = categorizedError;

                        // Record failed execution
                        this.executionHistory.push({
                            cellId,
                            timestamp: Date.now(),
                            executionTime,
                            status: 'error',
                            output: error
                        });

                        const execResult: ExecutionResult = {
                            success: false,
                            output: '',
                            error: categorizedError.message,
                            executionTime,
                            outputs,
                            variables: []
                        };

                        this.status = 'error';
                        this.notifyConnectionStatusChange();
                        resolve(execResult);
                    }
                }
            ).catch((error) => {
                const executionTime = (Date.now() - startTime) / 1000;
                const categorizedError = this.categorizeError(error, { code, timeoutMs: timeout });
                this.lastError = categorizedError;

                const execResult: ExecutionResult = {
                    success: false,
                    output: '',
                    error: categorizedError.message,
                    executionTime,
                    outputs: [],
                    variables: []
                };

                this.status = 'error';
                this.notifyConnectionStatusChange();
                resolve(execResult);
            });
        });
    }

    /**
     * Get all variables from the kernel
     * 
     * @returns Array of variable information
     */
    async getVariables(): Promise<VariableInfo[]> {
        if (!this.isConnected() || !this.kernelBridge) {
            return [];
        }

        return new Promise((resolve) => {
            const variableHandler = (msgNotebookId: string, data: any) => {
                if (msgNotebookId === this.config.notebookId) {
                    this.kernelBridge!.off('kernel:variables', variableHandler);
                    this.variables = this.mapVariables(data);
                    resolve(this.variables);
                }
            };

            this.kernelBridge!.on('kernel:variables', variableHandler);
            this.kernelBridge!.getVariables(this.config.notebookId);

            // Timeout fallback
            setTimeout(() => {
                this.kernelBridge!.off('kernel:variables', variableHandler);
                resolve(this.variables);
            }, 5000);
        });
    }

    /**
     * Get execution history
     * 
     * @returns Array of execution history entries
     */
    async getExecutionHistory(): Promise<Array<{
        cellId: string;
        timestamp: number;
        executionTime: number;
        status: 'success' | 'error';
        output: string;
    }>> {
        return [...this.executionHistory];
    }

    /**
     * Interrupt current execution
     */
    async interrupt(): Promise<void> {
        if (this.kernelBridge) {
            await this.kernelBridge.interruptKernel(this.config.notebookId);
        }
        this.status = 'idle';
        this.notifyConnectionStatusChange();
    }

    /**
     * Restart the kernel
     */
    async restart(): Promise<void> {
        if (this.kernelBridge) {
            await this.kernelBridge.restartKernel(this.config.notebookId);
        }
        this.executionHistory = [];
        this.variables = [];
        this.executionCounter = 0;
        this.status = 'connected';
        this.notifyConnectionStatusChange();
    }

    /**
     * Disconnect from kernel
     */
    async disconnect(): Promise<void> {
        if (this.kernelBridge) {
            await this.kernelBridge.stopKernel(this.config.notebookId);
        }
        this.status = 'disconnected';
        this.notifyConnectionStatusChange();
    }

    /**
     * Get current kernel status
     * 
     * @returns Current kernel status
     */
    getStatus(): KernelStatus {
        return this.status;
    }

    /**
     * Check if connected to kernel
     * 
     * @returns True if connected
     */
    isConnected(): boolean {
        return this.status === 'connected' || this.status === 'idle' || this.status === 'busy';
    }

    /**
     * Register callback for connection status changes
     * 
     * @param callback - Callback function
     * @returns Unsubscribe function
     */
    onConnectionStatusChange(callback: (status: KernelStatus) => void): () => void {
        this.connectionStatusCallbacks.push(callback);
        return () => {
            const index = this.connectionStatusCallbacks.indexOf(callback);
            if (index > -1) {
                this.connectionStatusCallbacks.splice(index, 1);
            }
        };
    }

    /**
     * Register callback for disconnection events
     * 
     * @param callback - Callback function
     * @returns Unsubscribe function
     */
    onDisconnect(callback: () => void): () => void {
        this.disconnectCallbacks.push(callback);
        return () => {
            const index = this.disconnectCallbacks.indexOf(callback);
            if (index > -1) {
                this.disconnectCallbacks.splice(index, 1);
            }
        };
    }

    /**
     * Register callback for reconnection events
     * 
     * @param callback - Callback function
     * @returns Unsubscribe function
     */
    onReconnect(callback: () => void): () => void {
        this.reconnectCallbacks.push(callback);
        return () => {
            const index = this.reconnectCallbacks.indexOf(callback);
            if (index > -1) {
                this.reconnectCallbacks.splice(index, 1);
            }
        };
    }

    /**
     * Categorize an error
     * 
     * @param error - Error to categorize
     * @param context - Additional context
     * @returns Categorized error
     */
    categorizeError(error: Error, context?: Record<string, unknown>): CategorizedError {
        const errorMessage = error.message.toLowerCase();
        
        if (errorMessage.includes('timeout')) {
            const timeoutContext = context || {};
            const elapsedTime = timeoutContext.elapsedTime as number || timeoutContext.timeoutMs as number || 30001;
            return this.createTimeoutError(
                (timeoutContext.timeoutMs as number) || 30000,
                elapsedTime,
                timeoutContext.partialOutput as string | undefined
            );
        }
        
        if (errorMessage.includes('connection') || errorMessage.includes('network')) {
            return this.createConnectionError(
                this.config.notebookId,
                this.reconnectAttempts,
                this.isConnected()
            );
        }
        
        if (errorMessage.includes('interrupt') || errorMessage.includes('cancel')) {
            const interruptContext = context || {};
            return this.createInterruptedError(
                interruptContext.cellId as string | undefined,
                (interruptContext.userInitiated as boolean | undefined) ?? false
            );
        }
        
        if (error.message === 'Unknown error') {
            return {
                type: 'unknown',
                message: 'Unknown error',
                errorCode: 'UNKNOWN_ERROR',
                recoverable: false,
                stack: error.stack,
                timestamp: Date.now(),
                context: {
                    notebookId: this.config.notebookId
                }
            };
        }
        
        return this.createExecutionError(error, context?.code as string || '');
    }

    /**
     * Create execution error
     */
    private createExecutionError(error: Error, code: string): KernelExecutionError {
        const lineNumberMatch = error.message.match(/line (\d+)/);
        const lineNumber = lineNumberMatch ? parseInt(lineNumberMatch[1]) : undefined;

        return {
            type: 'execution',
            message: `Execution error: ${error.message}`,
            errorCode: 'EXECUTION_ERROR',
            recoverable: true,
            stack: error.stack,
            timestamp: Date.now(),
            context: {
                notebookId: this.config.notebookId,
                code,
                lineNumber
            },
            code,
            lineNumber,
            errorName: error.name || 'Error'
        };
    }

    /**
     * Create timeout error
     */
    private createTimeoutError(
        requestedTimeout: number, 
        elapsedTime: number, 
        partialOutput?: string
    ): KernelTimeoutError {
        return {
            type: 'timeout',
            message: `Execution timeout after ${elapsedTime}ms (requested: ${requestedTimeout}ms)`,
            errorCode: 'TIMEOUT_ERROR',
            recoverable: true,
            stack: new Error().stack,
            timestamp: Date.now(),
            context: {
                notebookId: this.config.notebookId,
                requestedTimeout,
                elapsedTime,
                partialOutput
            },
            requestedTimeout,
            elapsedTime,
            partialOutput
        };
    }

    /**
     * Create connection error
     */
    private createConnectionError(
        kernelId: string, 
        reconnectAttempts: number, 
        wasConnected: boolean
    ): KernelConnectionError {
        const message = wasConnected 
            ? `connection lost to kernel ${kernelId} (attempt ${reconnectAttempts})`
            : `unable to establish connection to kernel ${kernelId} (attempt ${reconnectAttempts})`;

        return {
            type: 'connection',
            message,
            errorCode: 'CONNECTION_ERROR',
            recoverable: reconnectAttempts < this.config.maxRetries,
            stack: new Error().stack,
            timestamp: Date.now(),
            context: {
                notebookId: this.config.notebookId,
                kernelId,
                reconnectAttempts,
                wasConnected
            },
            kernelId,
            reconnectAttempts,
            wasConnected
        };
    }

    /**
     * Create interrupted error
     */
    private createInterruptedError(
        cellId?: string, 
        userInitiated: boolean = false
    ): KernelInterruptedError {
        const message = cellId 
            ? `Execution interrupted for cell ${cellId}`
            : 'Execution interrupted';

        return {
            type: 'interrupted',
            message,
            errorCode: 'INTERRUPTED_ERROR',
            recoverable: true,
            stack: new Error().stack,
            timestamp: Date.now(),
            context: {
                notebookId: this.config.notebookId,
                cellId,
                userInitiated
            },
            cellId,
            userInitiated
        };
    }

    /**
     * Get last error
     * 
     * @returns Last categorized error or null
     */
    getLastError(): CategorizedError | null {
        return this.lastError;
    }

    /**
     * Clear last error
     */
    clearError(): void {
        this.lastError = null;
    }

    /**
     * Map variables from kernel format to agent format
     */
    private mapVariables(kernelVariables: any[]): VariableInfo[] {
        if (!kernelVariables || !Array.isArray(kernelVariables)) {
            return [];
        }

        return kernelVariables.map((v: any) => ({
            name: v.name || v.n || 'unknown',
            type: v.type || v.t || 'unknown',
            shape: v.shape || v.s,
            value: v.value || v.v || String(v),
            references: v.references || v.r || 0
        }));
    }

    /**
     * Notify connection status change to all callbacks
     */
    private notifyConnectionStatusChange(): void {
        this.connectionStatusCallbacks.forEach(callback => callback(this.status));
    }
}

/**
 * Create a KernelAdapter from an existing KernelManager instance
 * 
 * @param kernelManager - KernelManager instance from controller-node
 * @param config - Optional configuration
 * @returns KernelAdapter instance
 */
export function createKernelAdapter(kernelManager: any, config?: Partial<KernelInterfaceConfig>): KernelAdapter {
    return new KernelAdapter(kernelManager, config);
}