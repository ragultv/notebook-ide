/**
 * Agent Error Handler for recovery and error management
 * 
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

import {
    AgentError,
    AgentErrorType,
    ErrorResolution,
    ErrorContext
} from './types/agent.types';
import { KernelInterface } from './kernel/KernelInterface';

/**
 * Configuration for the error handler
 */
export interface AgentErrorHandlerConfig {
    /** Maximum number of errors to keep in the log */
    maxErrors: number;
    /** Maximum retry attempts for recoverable errors */
    maxRetries: number;
    /** Whether to attempt kernel restart for kernel errors */
    enableKernelRestart: boolean;
    /** Whether to suggest fixes for execution errors */
    enableFixSuggestions: boolean;
}

/**
 * Default configuration for the error handler
 */
const DEFAULT_CONFIG: AgentErrorHandlerConfig = {
    maxErrors: 50,
    maxRetries: 3,
    enableKernelRestart: true,
    enableFixSuggestions: true
};

/**
 * Agent Error Handler for categorizing, logging, and recovering from errors
 * 
 * This class provides comprehensive error handling capabilities including:
 * - Error categorization (execution, state, memory, LLM, kernel)
 * - Kernel restart as recovery strategy
 * - Fix suggestions based on error type
 * - Error logging with timestamps and context
 * - Error budget management with pruning
 * 
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */
export class AgentErrorHandler {
    private errorLog: AgentError[];
    private config: AgentErrorHandlerConfig;
    private kernelInterface: KernelInterface | null;
    private retryCounts: Map<string, number>;

    /**
     * Create a new AgentErrorHandler
     * 
     * @param kernelInterface - Optional kernel interface for kernel operations
     * @param config - Optional configuration
     */
    constructor(kernelInterface?: KernelInterface, config?: Partial<AgentErrorHandlerConfig>) {
        this.errorLog = [];
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.kernelInterface = kernelInterface || null;
        this.retryCounts = new Map();
    }

    /**
     * Set the kernel interface (for dependency injection)
     * 
     * @param kernelInterface - Kernel interface instance
     */
    setKernelInterface(kernelInterface: KernelInterface): void {
        this.kernelInterface = kernelInterface;
    }

    /**
     * Handle an error and attempt recovery
     * 
     * @param error - The error to handle
     * @param context - Error context information
     * @returns Error resolution result
     */
    async handle(error: Error, context: ErrorContext): Promise<ErrorResolution> {
        const agentError = this.categorize(error, context);
        
        // Log the error with timestamp
        this.logError(agentError);
        
        // Prune old errors if budget exceeded
        this.pruneErrorLog();
        
        // Handle based on error type
        switch (agentError.type) {
            case 'kernel':
                return this.handleKernelError(agentError, context);
            case 'execution':
                return this.handleExecutionError(agentError, context);
            case 'memory':
                return this.handleMemoryError(agentError, context);
            case 'state':
                return this.handleStateError(agentError, context);
            case 'llm':
                return this.handleLLMError(agentError, context);
            default:
                return this.handleUnknownError(agentError, context);
        }
    }

    /**
     * Categorize an error into one of the five error types
     * 
     * Requirements: 9.1
     * 
     * @param error - The error to categorize
     * @param context - Error context
     * @returns Categorized agent error
     */
    categorize(error: Error, context: ErrorContext): AgentError {
        const errorMessage = error.message.toLowerCase();
        const errorName = error.name.toLowerCase();
        
        // Check for kernel-related errors
        if (this.isKernelError(errorMessage, errorName)) {
            return {
                type: 'kernel',
                message: error.message,
                recoverable: true,
                context: {
                    ...context,
                    originalError: error.message,
                    errorName: error.name
                },
                timestamp: Date.now(),
                stack: error.stack
            };
        }
        
        // Check for execution errors (syntax, runtime, etc.)
        if (this.isExecutionError(errorMessage, errorName)) {
            return {
                type: 'execution',
                message: error.message,
                recoverable: true,
                context: {
                    ...context,
                    originalError: error.message,
                    errorName: error.name
                },
                timestamp: Date.now(),
                stack: error.stack
            };
        }
        
        // Check for memory/resource errors
        if (this.isMemoryError(errorMessage, errorName)) {
            return {
                type: 'memory',
                message: error.message,
                recoverable: true,
                context: {
                    ...context,
                    originalError: error.message,
                    errorName: error.name
                },
                timestamp: Date.now(),
                stack: error.stack
            };
        }
        
        // Check for LLM API errors
        if (this.isLLMError(errorMessage, errorName)) {
            return {
                type: 'llm',
                message: error.message,
                recoverable: true,
                context: {
                    ...context,
                    originalError: error.message,
                    errorName: error.name
                },
                timestamp: Date.now(),
                stack: error.stack
            };
        }
        
        // Check for state management errors
        if (this.isStateError(errorMessage, errorName)) {
            return {
                type: 'state',
                message: error.message,
                recoverable: true,
                context: {
                    ...context,
                    originalError: error.message,
                    errorName: error.name
                },
                timestamp: Date.now(),
                stack: error.stack
            };
        }
        
        // Default to execution error for unknown errors
        return {
            type: 'execution',
            message: error.message,
            recoverable: true,
            context: {
                ...context,
                originalError: error.message,
                errorName: error.name
            },
            timestamp: Date.now(),
            stack: error.stack
        };
    }

    /**
     * Check if error is a kernel error
     * 
     * @param message - Error message
     * @param name - Error name
     * @returns True if kernel error
     */
    private isKernelError(message: string, name: string): boolean {
        const kernelIndicators = [
            'kernel',
            'connection',
            'disconnected',
            'jupyter',
            'notebook server',
            'zmq',
            'websocket'
        ];
        
        return kernelIndicators.some(indicator => 
            message.includes(indicator) || name.includes(indicator)
        );
    }

    /**
     * Check if error is an execution error
     * 
     * @param message - Error message
     * @param name - Error name
     * @returns True if execution error
     */
    private isExecutionError(message: string, name: string): boolean {
        const executionIndicators = [
            'syntaxerror',
            'nameerror',
            'typeerror',
            'valueerror',
            'attributeerror',
            'indexerror',
            'keyerror',
            'zerodivisionerror',
            'runtimeerror',
            'indentationerror',
            'taberror',
            'undefined',
            'not defined',
            'cannot',
            'unsupported',
            'invalid'
        ];
        
        return executionIndicators.some(indicator => 
            message.includes(indicator) || name.includes(indicator)
        );
    }

    /**
     * Check if error is a memory error
     * 
     * @param message - Error message
     * @param name - Error name
     * @returns True if memory error
     */
    private isMemoryError(message: string, name: string): boolean {
        const memoryIndicators = [
            'memory',
            'out of memory',
            'oom',
            'allocation',
            'heap',
            'stack overflow',
            'recursion',
            'maximum call stack',
            'too many',
            'memoryerror'
        ];
        
        return memoryIndicators.some(indicator => 
            message.includes(indicator) || name.includes(indicator)
        );
    }

    /**
     * Check if error is an LLM API error
     * 
     * @param message - Error message
     * @param name - Error name
     * @returns True if LLM error
     */
    private isLLMError(message: string, name: string): boolean {
        const llmIndicators = [
            'api',
            'openai',
            'anthropic',
            'rate limit',
            'quota',
            'token',
            'context length',
            'model',
            'completion',
            'embedding',
            'llm'
        ];
        
        return llmIndicators.some(indicator => 
            message.includes(indicator) || name.includes(indicator)
        );
    }

    /**
     * Check if error is a state management error
     * 
     * @param message - Error message
     * @param name - Error name
     * @returns True if state error
     */
    private isStateError(message: string, name: string): boolean {
        const stateIndicators = [
            'state',
            'mutex',
            'lock',
            'race condition',
            'concurrent',
            'synchronization',
            'deadlock',
            'timeout',
            'polling',
            'update'
        ];
        
        return stateIndicators.some(indicator => 
            message.includes(indicator) || name.includes(indicator)
        );
    }

    /**
     * Handle kernel errors with restart recovery
     * 
     * Requirements: 9.2
     * 
     * @param error - The agent error
     * @param context - Error context
     * @returns Error resolution result
     */
    async handleKernelError(error: AgentError, context: ErrorContext): Promise<ErrorResolution> {
        if (!this.config.enableKernelRestart) {
            return {
                action: 'fail',
                success: false,
                suggestion: 'Kernel restart is disabled. Please restart the kernel manually.',
                details: { errorType: error.type }
            };
        }

        if (!this.kernelInterface) {
            return {
                action: 'fail',
                success: false,
                suggestion: 'No kernel interface available. Please restart the kernel manually.',
                details: { errorType: error.type }
            };
        }

        try {
            // Attempt kernel restart
            await this.kernelInterface.restart();
            
            return {
                action: 'restart',
                success: true,
                suggestion: 'Kernel has been restarted successfully. You can retry your operation.',
                details: {
                    errorType: error.type,
                    restartPerformed: true,
                    timestamp: Date.now()
                }
            };
        } catch (restartError) {
            return {
                action: 'fail',
                success: false,
                suggestion: 'Failed to restart kernel. Please restart the kernel manually.',
                details: {
                    errorType: error.type,
                    restartPerformed: false,
                    restartError: restartError instanceof Error ? restartError.message : 'Unknown error'
                }
            };
        }
    }

    /**
     * Handle execution errors with fix suggestions
     * 
     * Requirements: 9.3
     * 
     * @param error - The agent error
     * @param context - Error context
     * @returns Error resolution result
     */
    async handleExecutionError(error: AgentError, context: ErrorContext): Promise<ErrorResolution> {
        const suggestion = this.suggestFix(error);
        
        if (!this.config.enableFixSuggestions) {
            return {
                action: 'suggest_fix',
                success: true,
                suggestion: 'Fix suggestions are disabled.',
                details: { errorType: error.type }
            };
        }

        return {
            action: 'suggest_fix',
            success: true,
            suggestion,
            details: {
                errorType: error.type,
                suggestionProvided: true,
                timestamp: Date.now()
            }
        };
    }

    /**
     * Handle memory errors with cleanup suggestions
     * 
     * @param error - The agent error
     * @param context - Error context
     * @returns Error resolution result
     */
    async handleMemoryError(error: AgentError, context: ErrorContext): Promise<ErrorResolution> {
        const suggestion = this.suggestMemoryFix(error);
        
        return {
            action: 'suggest_fix',
            success: true,
            suggestion,
            details: {
                errorType: error.type,
                suggestionProvided: true,
                timestamp: Date.now()
            }
        };
    }

    /**
     * Handle state errors with recovery suggestions
     * 
     * @param error - The agent error
     * @param context - Error context
     * @returns Error resolution result
     */
    async handleStateError(error: AgentError, context: ErrorContext): Promise<ErrorResolution> {
        const suggestion = this.suggestStateFix(error);
        
        return {
            action: 'suggest_fix',
            success: true,
            suggestion,
            details: {
                errorType: error.type,
                suggestionProvided: true,
                timestamp: Date.now()
            }
        };
    }

    /**
     * Handle LLM errors with retry suggestions
     * 
     * @param error - The agent error
     * @param context - Error context
     * @returns Error resolution result
     */
    async handleLLMError(error: AgentError, context: ErrorContext): Promise<ErrorResolution> {
        const suggestion = this.suggestLLMFix(error);
        
        return {
            action: 'retry',
            success: true,
            suggestion,
            details: {
                errorType: error.type,
                suggestionProvided: true,
                timestamp: Date.now()
            }
        };
    }

    /**
     * Handle unknown errors
     * 
     * @param error - The agent error
     * @param context - Error context
     * @returns Error resolution result
     */
    async handleUnknownError(error: AgentError, context: ErrorContext): Promise<ErrorResolution> {
        return {
            action: 'fail',
            success: false,
            suggestion: 'An unknown error occurred. Please check the error details and try again.',
            details: {
                errorType: error.type,
                errorMessage: error.message,
                timestamp: Date.now()
            }
        };
    }

    /**
     * Suggest a fix based on the error type
     * 
     * Requirements: 9.3
     * 
     * @param error - The agent error
     * @returns Fix suggestion
     */
    suggestFix(error: AgentError): string {
        const message = error.message.toLowerCase();
        const context = error.context;
        
        // Syntax errors
        if (message.includes('syntax')) {
            return 'Check your code for syntax errors. Common issues include: missing colons, incorrect indentation, unmatched parentheses, or typos in keywords.';
        }
        
        // Name errors (undefined variables)
        if (message.includes('name') || message.includes('not defined')) {
            return 'You\'re using a variable that hasn\'t been defined. Make sure to: (1) Define the variable before using it, (2) Check for typos in variable names, (3) Import required modules.';
        }
        
        // Type errors
        if (message.includes('type')) {
            return 'You\'re performing an operation on incompatible types. Check: (1) Variable types match expected types, (2) You\'re not mixing up data types (e.g., string + number), (3) Function arguments are correct types.';
        }
        
        // Value errors
        if (message.includes('value')) {
            return 'The value provided is invalid. Check: (1) Value is within expected range, (2) Format matches expected format, (3) Required fields are present.';
        }
        
        // Attribute errors
        if (message.includes('attribute')) {
            return 'You\'re trying to access an attribute that doesn\'t exist. Check: (1) Object type has the attribute, (2) No typos in attribute name, (3) Object is properly initialized.';
        }
        
        // Index/Key errors
        if (message.includes('index') || message.includes('key')) {
            return 'You\'re trying to access an index or key that doesn\'t exist. Check: (1) Index/key is within bounds, (2) Key exists in dictionary/container, (3) Data structure is properly populated.';
        }
        
        // Division by zero
        if (message.includes('division') || message.includes('zero')) {
            return 'You\'re dividing by zero. Add a check to ensure the divisor is not zero before performing the division.';
        }
        
        // Import errors
        if (message.includes('import') || message.includes('module')) {
            return 'There\'s an issue with importing a module. Check: (1) Module is installed, (2) Import path is correct, (3) No circular imports.';
        }
        
        // Default suggestion
        return `An execution error occurred: ${error.message}. Please review your code for the issues mentioned in the error message.`;
    }

    /**
     * Suggest a fix for memory errors
     * 
     * @param error - The agent error
     * @returns Memory fix suggestion
     */
    private suggestMemoryFix(error: AgentError): string {
        const message = error.message.toLowerCase();
        
        if (message.includes('recursion') || message.includes('stack')) {
            return 'Your code has excessive recursion. Consider: (1) Converting to iterative approach, (2) Increasing recursion limit (not recommended), (3) Using tail recursion optimization.';
        }
        
        if (message.includes('out of memory') || message.includes('memory')) {
            return 'You\'re running out of memory. Try: (1) Deleting unused large variables with `del variable`, (2) Processing data in chunks, (3) Using generators instead of lists, (4) Reducing data size.';
        }
        
        return `A memory error occurred: ${error.message}. Consider reducing memory usage or processing data in smaller chunks.`;
    }

    /**
     * Suggest a fix for state errors
     * 
     * @param error - The agent error
     * @returns State fix suggestion
     */
    private suggestStateFix(error: AgentError): string {
        const message = error.message.toLowerCase();
        
        if (message.includes('lock') || message.includes('mutex')) {
            return 'There\'s a concurrency issue with state access. Ensure proper lock acquisition order and release to prevent deadlocks.';
        }
        
        if (message.includes('timeout')) {
            return 'An operation timed out. Try: (1) Increasing timeout value, (2) Breaking operation into smaller parts, (3) Checking for blocking operations.';
        }
        
        return `A state management error occurred: ${error.message}. Check for concurrent access issues and proper synchronization.`;
    }

    /**
     * Suggest a fix for LLM errors
     * 
     * @param error - The agent error
     * @returns LLM fix suggestion
     */
    private suggestLLMFix(error: AgentError): string {
        const message = error.message.toLowerCase();
        
        if (message.includes('rate limit') || message.includes('quota')) {
            return 'You\'ve hit a rate limit. Wait a moment and retry, or consider reducing request frequency.';
        }
        
        if (message.includes('context') || message.includes('token')) {
            return 'Your request exceeds the context window. Try: (1) Reducing message history, (2) Truncating long inputs, (3) Summarizing earlier conversation.';
        }
        
        if (message.includes('connection') || message.includes('network')) {
            return 'There\'s a network issue with the LLM API. Check your connection and retry.';
        }
        
        return `An LLM API error occurred: ${error.message}. Please check your API configuration and try again.`;
    }

    /**
     * Log an error with timestamp
     * 
     * Requirements: 9.4
     * 
     * @param error - The error to log
     */
    private logError(error: AgentError): void {
        this.errorLog.push(error);
    }

    /**
     * Prune older errors when threshold is exceeded
     * 
     * Requirements: 9.5
     */
    private pruneErrorLog(): void {
        while (this.errorLog.length > this.config.maxErrors) {
            // Remove the oldest error (from the beginning)
            this.errorLog.shift();
        }
    }

    /**
     * Get the current error log
     * 
     * @returns Array of logged errors
     */
    getErrorLog(): AgentError[] {
        return [...this.errorLog];
    }

    /**
     * Get recent errors of a specific type
     * 
     * @param type - Error type to filter by
     * @param count - Maximum number of errors to return
     * @returns Array of recent errors
     */
    getRecentErrors(type?: AgentErrorType, count?: number): AgentError[] {
        let errors = [...this.errorLog];
        
        if (type) {
            errors = errors.filter(e => e.type === type);
        }
        
        if (count) {
            errors = errors.slice(-count);
        }
        
        return errors;
    }

    /**
     * Get error count by type
     * 
     * @returns Object with error counts by type
     */
    getErrorCountsByType(): Record<AgentErrorType, number> {
        const counts: Record<AgentErrorType, number> = {
            execution: 0,
            state: 0,
            memory: 0,
            llm: 0,
            kernel: 0
        };
        
        for (const error of this.errorLog) {
            counts[error.type]++;
        }
        
        return counts;
    }

    /**
     * Clear the error log
     */
    clearErrorLog(): void {
        this.errorLog = [];
        this.retryCounts.clear();
    }

    /**
     * Get the current retry count for an error key
     * 
     * @param key - Error key
     * @returns Current retry count
     */
    getRetryCount(key: string): number {
        return this.retryCounts.get(key) || 0;
    }

    /**
     * Increment retry count for an error key
     * 
     * @param key - Error key
     * @returns New retry count
     */
    incrementRetryCount(key: string): number {
        const count = (this.retryCounts.get(key) || 0) + 1;
        this.retryCounts.set(key, count);
        return count;
    }

    /**
     * Check if maximum retries exceeded
     * 
     * @param key - Error key
     * @returns True if max retries exceeded
     */
    isMaxRetriesExceeded(key: string): boolean {
        return this.getRetryCount(key) >= this.config.maxRetries;
    }

    /**
     * Get configuration
     * 
     * @returns Current configuration
     */
    getConfig(): AgentErrorHandlerConfig {
        return { ...this.config };
    }

    /**
     * Update configuration
     * 
     * @param config - New configuration values
     */
    updateConfig(config: Partial<AgentErrorHandlerConfig>): void {
        this.config = { ...this.config, ...config };
    }
}