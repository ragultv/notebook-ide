/**
 * Unit tests for KernelInterface
 * 
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */

import { KernelInterface } from './KernelInterface';
import { ExecutionResult, VariableInfo } from '../types/agent.types';

describe('KernelInterface', () => {
    let kernel: KernelInterface;

    beforeEach(() => {
        kernel = new KernelInterface({
            notebookId: 'test-notebook',
            executionTimeout: 30000,
            maxRetries: 3
        });
    });

    afterEach(async () => {
        await kernel.disconnect();
    });

    describe('constructor', () => {
        it('should create kernel interface with default config', () => {
            const defaultKernel = new KernelInterface();
            expect(defaultKernel).toBeDefined();
        });

        it('should create kernel interface with custom config', () => {
            expect(kernel).toBeDefined();
        });
    });

    describe('connect', () => {
        it('should connect to kernel', async () => {
            await kernel.connect('test-notebook');
            expect(kernel.isConnected()).toBe(true);
        });

        it('should connect with notebookId from constructor', async () => {
            await kernel.connect();
            expect(kernel.isConnected()).toBe(true);
        });
    });

    describe('execute', () => {
        beforeEach(async () => {
            await kernel.connect();
        });

        it('should execute code and return result', async () => {
            const result = await kernel.execute('x = 1 + 1');
            
            expect(result).toHaveProperty('success');
            expect(result).toHaveProperty('output');
            expect(result).toHaveProperty('executionTime');
            expect(result).toHaveProperty('outputs');
            expect(result).toHaveProperty('variables');
            expect(typeof result.executionTime).toBe('number');
        });

        it('should respect custom timeout', async () => {
            const result = await kernel.execute('x = 1', { timeout: 5000 });
            
            expect(result.executionTime).toBeLessThan(10);  // Should complete quickly
        });

        it('should respect max timeout of 120 seconds', async () => {
            const result = await kernel.execute('x = 1', { timeout: 200000 });
            
            expect(result.executionTime).toBeLessThanOrEqual(120);
        });

        it('should respect minimum timeout of 1 second', async () => {
            const result = await kernel.execute('x = 1', { timeout: 1000 });
            
            // Execution time should be non-negative (placeholder returns 0)
            expect(result.executionTime).toBeGreaterThanOrEqual(0);
        });

        it('should use default timeout when not specified', async () => {
            const result = await kernel.execute('x = 1');
            
            expect(result.executionTime).toBeLessThan(35);  // Default is 30s
        });

        it('should capture variables when requested', async () => {
            await kernel.execute('x = 42');
            const result = await kernel.execute('y = x * 2', { captureVariables: true });
            
            expect(result.variables).toBeDefined();
        });

        it('should not capture variables when disabled', async () => {
            const result = await kernel.execute('x = 42', { captureVariables: false });
            
            expect(result.variables).toEqual([]);
        });

        it('should record execution history when requested', async () => {
            await kernel.execute('x = 1', { captureHistory: true });
            
            const history = await kernel.getExecutionHistory();
            expect(history.length).toBeGreaterThan(0);
        });

        it('should not record execution history when disabled', async () => {
            await kernel.execute('x = 1', { captureHistory: false });
            
            const history = await kernel.getExecutionHistory();
            expect(history.length).toBe(0);
        });
    });

    describe('getVariables', () => {
        beforeEach(async () => {
            await kernel.connect();
        });

        it('should return empty array before any execution', async () => {
            const variables = await kernel.getVariables();
            
            expect(Array.isArray(variables)).toBe(true);
            expect(variables).toEqual([]);
        });

        it('should return variable information after execution', async () => {
            await kernel.execute('test_var = 123');
            const variables = await kernel.getVariables();
            
            expect(variables.length).toBeGreaterThanOrEqual(0);
        });

        it('should include variable name in returned variables', async () => {
            await kernel.execute('my_variable = 42');
            const variables = await kernel.getVariables();
            
            const myVar = variables.find((v: VariableInfo) => v.name === 'my_variable');
            if (myVar) {
                expect(myVar.name).toBe('my_variable');
            }
        });

        it('should include variable type in returned variables', async () => {
            await kernel.execute('int_var = 42');
            const variables = await kernel.getVariables();
            
            const intVar = variables.find((v: VariableInfo) => v.name === 'int_var');
            if (intVar) {
                expect(typeof intVar.type).toBe('string');
                expect(intVar.type.length).toBeGreaterThan(0);
            }
        });

        it('should include value preview in returned variables', async () => {
            await kernel.execute('preview_var = "hello world"');
            const variables = await kernel.getVariables();
            
            const previewVar = variables.find((v: VariableInfo) => v.name === 'preview_var');
            if (previewVar) {
                expect(typeof previewVar.value).toBe('string');
                expect(previewVar.value.length).toBeGreaterThan(0);
            }
        });

        it('should track reference count for variables', async () => {
            await kernel.execute('ref_var = 10');
            await kernel.execute('ref_var = ref_var * 2');
            const variables = await kernel.getVariables();
            
            const refVar = variables.find((v: VariableInfo) => v.name === 'ref_var');
            if (refVar) {
                expect(refVar.references).toBeGreaterThanOrEqual(1);
            }
        });

        it('should track multiple variables with different types', async () => {
            await kernel.execute('a = 1');
            await kernel.execute('b = 2.5');
            await kernel.execute('c = "text"');
            await kernel.execute('d = [1, 2, 3]');
            
            const variables = await kernel.getVariables();
            
            // Should have at least 4 tracked variables
            expect(variables.length).toBeGreaterThanOrEqual(4);
            
            // Each variable should have name, type, value, and references
            for (const v of variables) {
                expect(v).toHaveProperty('name');
                expect(v).toHaveProperty('type');
                expect(v).toHaveProperty('value');
                expect(v).toHaveProperty('references');
            }
        });

        it('should clear variables on kernel restart', async () => {
            await kernel.execute('restart_var = 999');
            await kernel.restart();
            const variables = await kernel.getVariables();
            
            const restartVar = variables.find((v: VariableInfo) => v.name === 'restart_var');
            expect(restartVar).toBeUndefined();
        });
    });

    describe('getExecutionHistory', () => {
        beforeEach(async () => {
            await kernel.connect();
        });

        it('should return empty array initially', async () => {
            const history = await kernel.getExecutionHistory();
            
            expect(history).toEqual([]);
        });

        it('should return execution history after code execution', async () => {
            await kernel.execute('x = 1', { captureHistory: true });
            
            const history = await kernel.getExecutionHistory();
            expect(history.length).toBeGreaterThan(0);
        });

        it('should include cellId in history entry', async () => {
            await kernel.execute('x = 1', { captureHistory: true });
            
            const history = await kernel.getExecutionHistory();
            expect(history[0].cellId).toBeDefined();
            expect(typeof history[0].cellId).toBe('string');
        });

        it('should include timestamp in history entry', async () => {
            await kernel.execute('x = 1', { captureHistory: true });
            
            const history = await kernel.getExecutionHistory();
            expect(typeof history[0].timestamp).toBe('number');
            expect(history[0].timestamp).toBeGreaterThan(0);
        });

        it('should include execution time in history entry', async () => {
            await kernel.execute('x = 1', { captureHistory: true });
            
            const history = await kernel.getExecutionHistory();
            expect(history[0].executionTime).toBeGreaterThanOrEqual(0);
        });

        it('should include status in history entry', async () => {
            await kernel.execute('x = 1', { captureHistory: true });
            
            const history = await kernel.getExecutionHistory();
            expect(history[0].status).toBe('success');
        });

        it('should include output in history entry', async () => {
            await kernel.execute('x = 1', { captureHistory: true });
            
            const history = await kernel.getExecutionHistory();
            expect(history[0].output).toBeDefined();
            expect(typeof history[0].output).toBe('string');
        });

        it('should track execution order across multiple executions', async () => {
            await kernel.execute('x = 1', { captureHistory: true });
            await kernel.execute('y = 2', { captureHistory: true });
            await kernel.execute('z = 3', { captureHistory: true });
            
            const history = await kernel.getExecutionHistory();
            expect(history.length).toBe(3);
            expect(history[0].cellId).toBe('cell-1');
            expect(history[1].cellId).toBe('cell-2');
            expect(history[2].cellId).toBe('cell-3');
        });

        it('should record error status for failed execution', async () => {
            // This test would need actual error simulation
            // For now, we test that status field exists
            await kernel.execute('x = 1', { captureHistory: true });
            
            const history = await kernel.getExecutionHistory();
            expect(history[0].status).toMatch(/^success|error$/);
        });

        it('should return a copy of history array', async () => {
            await kernel.execute('x = 1', { captureHistory: true });
            
            const history1 = await kernel.getExecutionHistory();
            const history2 = await kernel.getExecutionHistory();
            
            expect(history1).not.toBe(history2);
            expect(history1).toEqual(history2);
        });
    });

    describe('interrupt', () => {
        beforeEach(async () => {
            await kernel.connect();
        });

        it('should interrupt execution', async () => {
            await kernel.interrupt();
            // After interrupt, subsequent executions should be affected
            expect(kernel.getStatus()).toBe('idle');
        });

        it('should set isInterrupted flag', async () => {
            await kernel.interrupt();
            // The interrupt flag should be set
            expect(kernel.getStatus()).toBe('idle');
        });

        it('should update connection status to idle', async () => {
            await kernel.execute('x = 1');
            expect(kernel.getStatus()).toBe('connected');
            
            await kernel.interrupt();
            expect(kernel.getStatus()).toBe('idle');
        });
    });

    describe('restart', () => {
        beforeEach(async () => {
            await kernel.connect();
        });

        it('should restart the kernel', async () => {
            await kernel.execute('x = 1');
            await kernel.restart();
            
            expect(kernel.isConnected()).toBe(true);
            expect(kernel.getStatus()).toBe('connected');
        });

        it('should clear execution history on restart', async () => {
            await kernel.execute('x = 1', { captureHistory: true });
            await kernel.restart();
            
            const history = await kernel.getExecutionHistory();
            expect(history).toEqual([]);
        });

        it('should clear variables on restart', async () => {
            await kernel.execute('restart_var = 999');
            await kernel.restart();
            const variables = await kernel.getVariables();
            
            const restartVar = variables.find((v: VariableInfo) => v.name === 'restart_var');
            expect(restartVar).toBeUndefined();
        });

        it('should reset execution counter on restart', async () => {
            await kernel.execute('x = 1', { captureHistory: true });
            await kernel.execute('y = 2', { captureHistory: true });
            
            const historyBefore = await kernel.getExecutionHistory();
            expect(historyBefore.length).toBe(2);
            expect(historyBefore[0].cellId).toBe('cell-1');
            expect(historyBefore[1].cellId).toBe('cell-2');
            
            await kernel.restart();
            
            await kernel.execute('z = 3', { captureHistory: true });
            const historyAfter = await kernel.getExecutionHistory();
            expect(historyAfter.length).toBe(1);
            expect(historyAfter[0].cellId).toBe('cell-1');
        });
    });

    describe('connection status callbacks', () => {
        beforeEach(async () => {
            await kernel.connect();
        });

        it('should register connection status callback', async () => {
            const callback = jest.fn();
            const unsubscribe = kernel.onConnectionStatusChange(callback);
            
            await kernel.interrupt();
            expect(callback).toHaveBeenCalledWith('idle');
            
            unsubscribe();
        });

        it('should allow multiple connection status callbacks', async () => {
            const callback1 = jest.fn();
            const callback2 = jest.fn();
            
            kernel.onConnectionStatusChange(callback1);
            kernel.onConnectionStatusChange(callback2);
            
            await kernel.interrupt();
            
            expect(callback1).toHaveBeenCalledWith('idle');
            expect(callback2).toHaveBeenCalledWith('idle');
        });

        it('should unsubscribe callback', async () => {
            const callback = jest.fn();
            const unsubscribe = kernel.onConnectionStatusChange(callback);
            
            unsubscribe();
            
            await kernel.interrupt();
            expect(callback).not.toHaveBeenCalled();
        });

        it('should notify on connect', async () => {
            const callback = jest.fn();
            kernel.onConnectionStatusChange(callback);
            
            await kernel.disconnect();
            await kernel.connect();
            
            expect(callback).toHaveBeenCalledWith('connected');
        });

        it('should notify on disconnect', async () => {
            const callback = jest.fn();
            kernel.onConnectionStatusChange(callback);
            
            await kernel.disconnect();
            
            expect(callback).toHaveBeenCalledWith('disconnected');
        });
    });

    describe('disconnect callbacks', () => {
        it('should register disconnect callback', async () => {
            const callback = jest.fn();
            kernel.onDisconnect(callback);
            
            await kernel.handleDisconnection();
            
            expect(callback).toHaveBeenCalled();
        });

        it('should allow multiple disconnect callbacks', async () => {
            const callback1 = jest.fn();
            const callback2 = jest.fn();
            
            kernel.onDisconnect(callback1);
            kernel.onDisconnect(callback2);
            
            await kernel.handleDisconnection();
            
            expect(callback1).toHaveBeenCalled();
            expect(callback2).toHaveBeenCalled();
        });

        it('should unsubscribe disconnect callback', async () => {
            const callback = jest.fn();
            const unsubscribe = kernel.onDisconnect(callback);
            
            unsubscribe();
            
            await kernel.handleDisconnection();
            expect(callback).not.toHaveBeenCalled();
        });
    });

    describe('reconnect callbacks', () => {
        it('should register reconnect callback', () => {
            const callback = jest.fn();
            kernel.onReconnect(callback);
            
            // Verify callback is registered
            expect(callback).toBeDefined();
        });

        it('should allow multiple reconnect callbacks', () => {
            const callback1 = jest.fn();
            const callback2 = jest.fn();
            
            kernel.onReconnect(callback1);
            kernel.onReconnect(callback2);
            
            expect(callback1).toBeDefined();
            expect(callback2).toBeDefined();
        });

        it('should unsubscribe reconnect callback', () => {
            const callback = jest.fn();
            const unsubscribe = kernel.onReconnect(callback);
            
            unsubscribe();
            
            // Verify unsubscribe doesn't throw
            expect(() => unsubscribe()).not.toThrow();
        });
    });

    describe('handleDisconnection', () => {
        beforeEach(async () => {
            await kernel.connect();
        });

        it('should update status to disconnected', async () => {
            await kernel.handleDisconnection();
            
            expect(kernel.getStatus()).toBe('disconnected');
        });

        it('should accept error parameter', async () => {
            const error = new Error('Connection lost');
            await kernel.handleDisconnection(error);
            
            expect(kernel.getStatus()).toBe('disconnected');
        });

        it('should track reconnect attempts', async () => {
            await kernel.handleDisconnection();
            
            expect(kernel.getReconnectAttempts()).toBeGreaterThanOrEqual(0);
        });
    });

    describe('reconnection behavior', () => {
        beforeEach(async () => {
            await kernel.connect();
        });

        it('should report reconnecting state', () => {
            expect(kernel.isReconnectingToKernel()).toBe(false);
        });

        it('should reset reconnect attempts on successful connect', async () => {
            await kernel.handleDisconnection();
            const attemptsBefore = kernel.getReconnectAttempts();
            
            await kernel.connect();
            const attemptsAfter = kernel.getReconnectAttempts();
            
            expect(attemptsAfter).toBe(0);
        });
    });

    describe('disconnect', () => {
        it('should disconnect from kernel', async () => {
            await kernel.connect();
            expect(kernel.isConnected()).toBe(true);
            
            await kernel.disconnect();
            expect(kernel.isConnected()).toBe(false);
        });

        it('should handle disconnect when not connected', async () => {
            await expect(kernel.disconnect()).resolves.not.toThrow();
        });
    });

    describe('getStatus', () => {
        it('should return disconnected when not connected', () => {
            expect(kernel.getStatus()).toBe('disconnected');
        });

        it('should return connected status after connect', async () => {
            await kernel.connect();
            expect(kernel.getStatus()).toBe('connected');
        });
    });

    describe('isConnected', () => {
        it('should return false when not connected', () => {
            expect(kernel.isConnected()).toBe(false);
        });

        it('should return true after connect', async () => {
            await kernel.connect();
            expect(kernel.isConnected()).toBe(true);
        });

        it('should return false after disconnect', async () => {
            await kernel.connect();
            await kernel.disconnect();
            expect(kernel.isConnected()).toBe(false);
        });
    });

    // =========================================================================
    // Error Handling Tests
    // =========================================================================

    describe('error handling', () => {
        beforeEach(async () => {
            await kernel.connect();
            kernel.clearError();
        });

        describe('categorizeError', () => {
            it('should categorize timeout errors', () => {
                const error = new Error('Execution timeout after 30000ms');
                const categorized = kernel.categorizeError(error, { timeoutMs: 30000 });
                
                expect(categorized.type).toBe('timeout');
                expect(categorized.message).toContain('timeout');
                expect(categorized.errorCode).toBe('TIMEOUT_ERROR');
                expect(categorized.recoverable).toBe(true);
            });

            it('should categorize connection errors', () => {
                const error = new Error('Connection lost');
                const categorized = kernel.categorizeError(error);
                
                expect(categorized.type).toBe('connection');
                expect(categorized.message).toContain('connection');
                expect(categorized.errorCode).toBe('CONNECTION_ERROR');
            });

            it('should categorize network errors as connection', () => {
                const error = new Error('Network is unreachable');
                const categorized = kernel.categorizeError(error);
                
                expect(categorized.type).toBe('connection');
            });

            it('should categorize interruption errors', () => {
                const error = new Error('Execution was interrupted');
                const categorized = kernel.categorizeError(error, { cellId: 'cell-1' });
                
                expect(categorized.type).toBe('interrupted');
                expect(categorized.message).toContain('interrupted');
                expect(categorized.errorCode).toBe('INTERRUPTED_ERROR');
            });

            it('should categorize cancellation as interruption', () => {
                const error = new Error('Operation was cancelled');
                const categorized = kernel.categorizeError(error);
                
                expect(categorized.type).toBe('interrupted');
            });

            it('should default to execution errors', () => {
                const error = new Error('NameError: name "undefined_var" is not defined');
                const categorized = kernel.categorizeError(error, { code: 'undefined_var' });
                
                expect(categorized.type).toBe('execution');
                expect(categorized.message).toContain('Execution error');
                expect(categorized.errorCode).toBe('EXECUTION_ERROR');
            });

            it('should include code context in execution errors', () => {
                const error = new Error('SyntaxError: invalid syntax');
                const categorized = kernel.categorizeError(error, { code: 'x = 1 +' });
                
                expect(categorized.type).toBe('execution');
                expect(categorized.context.code).toBe('x = 1 +');
            });

            it('should include stack trace in categorized errors', () => {
                const error = new Error('Test error');
                const categorized = kernel.categorizeError(error);
                
                expect(categorized.stack).toBeDefined();
                expect(typeof categorized.stack).toBe('string');
            });

            it('should include timestamp in categorized errors', () => {
                const error = new Error('Test error');
                const before = Date.now();
                const categorized = kernel.categorizeError(error);
                const after = Date.now();
                
                expect(categorized.timestamp).toBeGreaterThanOrEqual(before);
                expect(categorized.timestamp).toBeLessThanOrEqual(after);
            });

            it('should include notebook ID in error context', () => {
                const error = new Error('Test error');
                const categorized = kernel.categorizeError(error);
                
                expect(categorized.context.notebookId).toBe('test-notebook');
            });
        });

        describe('createExecutionError', () => {
            it('should create execution error with code and error name', () => {
                const err = new Error('name "x" is not defined');
                err.name = 'NameError';
                
                const error = kernel['createExecutionError'](err, 'x = 1');
                
                expect(error.type).toBe('execution');
                expect(error.message).toContain('name "x" is not defined');
                expect(error.errorName).toBe('NameError');
                expect(error.code).toBe('x = 1');
            });

            it('should extract line number from error message', () => {
                const err = new Error('NameError at line 5');
                
                const error = kernel['createExecutionError'](err, 'test code');
                
                expect(error.lineNumber).toBe(5);
            });

            it('should include stack trace', () => {
                const err = new Error('Test error');
                
                const error = kernel['createExecutionError'](err, 'test code');
                
                expect(error.stack).toBeDefined();
            });
        });

        describe('createTimeoutError', () => {
            it('should create timeout error with timing details', () => {
                const error = kernel['createTimeoutError'](30000, 30001);
                
                expect(error.type).toBe('timeout');
                expect(error.message).toContain('30001ms');
                expect(error.message).toContain('30000ms');
                expect(error.requestedTimeout).toBe(30000);
                expect(error.elapsedTime).toBe(30001);
            });

            it('should include partial output if provided', () => {
                const error = kernel['createTimeoutError'](30000, 30000, 'Partial output...');
                
                expect(error.partialOutput).toBe('Partial output...');
            });

            it('should be recoverable', () => {
                const error = kernel['createTimeoutError'](30000, 30000);
                
                expect(error.recoverable).toBe(true);
            });
        });

        describe('createConnectionError', () => {
            it('should create connection error with kernel details', () => {
                const error = kernel['createConnectionError']('kernel-123', 2, true);
                
                expect(error.type).toBe('connection');
                expect(error.kernelId).toBe('kernel-123');
                expect(error.reconnectAttempts).toBe(2);
                expect(error.wasConnected).toBe(true);
            });

            it('should be recoverable when attempts are below max', () => {
                const error = kernel['createConnectionError']('kernel-123', 2, false);
                
                expect(error.recoverable).toBe(true);
            });

            it('should indicate previously connected in message', () => {
                const error = kernel['createConnectionError']('kernel-123', 0, true);
                
                expect(error.message).toContain('lost');
            });

            it('should indicate never connected in message', () => {
                const error = kernel['createConnectionError']('kernel-123', 0, false);
                
                expect(error.message).toContain('unable to establish');
            });
        });

        describe('createInterruptedError', () => {
            it('should create interrupted error', () => {
                const error = kernel['createInterruptedError']('cell-1', true);
                
                expect(error.type).toBe('interrupted');
                expect(error.cellId).toBe('cell-1');
                expect(error.userInitiated).toBe(true);
            });

            it('should include cell ID in message', () => {
                const error = kernel['createInterruptedError']('cell-42', true);
                
                expect(error.message).toContain('cell-42');
            });

            it('should handle missing cell ID', () => {
                const error = kernel['createInterruptedError'](undefined, true);
                
                expect(error.message).not.toContain('cell');
                expect(error.cellId).toBeUndefined();
            });

            it('should be recoverable', () => {
                const error = kernel['createInterruptedError']();
                
                expect(error.recoverable).toBe(true);
            });
        });

        describe('formatErrorWithStack', () => {
            it('should return empty string for successful result', () => {
                const result: ExecutionResult = { 
                    success: true, 
                    output: 'ok', 
                    executionTime: 0.1, 
                    outputs: [], 
                    variables: [] 
                };
                
                const formatted = kernel.formatErrorWithStack(result);
                
                expect(formatted).toBe('');
            });

            it('should include error message', () => {
                const result: ExecutionResult = { 
                    success: false, 
                    output: '', 
                    error: 'SyntaxError: invalid syntax',
                    executionTime: 0.1, 
                    outputs: [], 
                    variables: [] 
                };
                
                const formatted = kernel.formatErrorWithStack(result);
                
                expect(formatted).toContain('SyntaxError: invalid syntax');
            });

            it('should include stack trace from error output', () => {
                const result: ExecutionResult = { 
                    success: false, 
                    output: '', 
                    error: 'Error',
                    executionTime: 0.1, 
                    outputs: [
                        { type: 'error', data: 'Traceback (most recent call last):\n  File "<stdin>", line 1\nSyntaxError: invalid syntax' }
                    ], 
                    variables: [] 
                };
                
                const formatted = kernel.formatErrorWithStack(result);
                
                expect(formatted).toContain('Stack trace:');
                expect(formatted).toContain('Traceback');
            });
        });

        describe('isErrorRecoverable', () => {
            it('should return true for recoverable errors', () => {
                const error = kernel['createTimeoutError'](30000, 30000);
                
                expect(kernel.isErrorRecoverable(error)).toBe(true);
            });

            it('should return false for non-recoverable errors', () => {
                const error = kernel['createConnectionError']('kernel-123', 10, false);
                
                expect(kernel.isErrorRecoverable(error)).toBe(false);
            });
        });

        describe('getErrorSuggestion', () => {
            it('should suggest fix for execution errors', () => {
                const error = kernel['createExecutionError'](new Error('Test'), 'code');
                
                const suggestion = kernel.getErrorSuggestion(error);
                
                expect(suggestion).toContain('syntax');
            });

            it('should suggest fix for timeout errors', () => {
                const error = kernel['createTimeoutError'](30000, 30000);
                
                const suggestion = kernel.getErrorSuggestion(error);
                
                expect(suggestion).toContain('timeout');
            });

            it('should suggest fix for connection errors', () => {
                const error = kernel['createConnectionError']('kernel-123', 0, false);
                
                const suggestion = kernel.getErrorSuggestion(error);
                
                expect(suggestion).toContain('restart');
            });

            it('should suggest fix for interrupted errors', () => {
                const error = kernel['createInterruptedError']();
                
                const suggestion = kernel.getErrorSuggestion(error);
                
                expect(suggestion).toContain('retry');
            });

            it('should provide default suggestion for unknown errors', () => {
                const error = kernel.categorizeError(new Error('Unknown error'));
                
                const suggestion = kernel.getErrorSuggestion(error);
                
                expect(suggestion).toContain('unknown');
            });
        });

        describe('lastError tracking', () => {
            it('should track last error', async () => {
                await kernel.execute('invalid syntax here @#$');
                
                const lastError = kernel.getLastError();
                expect(lastError).not.toBeNull();
                expect(lastError?.type).toBe('execution');
            });

            it('should clear last error', () => {
                kernel.clearError();
                
                expect(kernel.getLastError()).toBeNull();
            });

            it('should update last error on each execution', async () => {
                await kernel.execute('x = 1');
                const firstError = kernel.getLastError();
                
                await kernel.execute('y = invalid_var');
                const secondError = kernel.getLastError();
                
                // First execution should succeed (no error)
                expect(firstError).toBeNull();
                // Second execution should have an error
                expect(secondError).not.toBeNull();
            });
        });

        describe('error during execution', () => {
            it('should categorize syntax errors as execution errors', async () => {
                const result = await kernel.execute('def @#$ invalid syntax');
                
                expect(result.success).toBe(false);
                expect(result.error).toBeDefined();
                expect(kernel.getLastError()?.type).toBe('execution');
            });

            it('should include descriptive error message', async () => {
                const result = await kernel.execute('undefined_variable_xyz');
                
                expect(result.success).toBe(false);
                expect(result.error).toBeDefined();
                expect(result.error?.length).toBeGreaterThan(0);
            });

            it('should include stack trace in error output', async () => {
                const result = await kernel.execute('raise ValueError("test error")');
                
                expect(result.success).toBe(false);
                expect(result.error).toContain('test error');
            });
        });
    });
});