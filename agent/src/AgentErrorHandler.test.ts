/**
 * Tests for AgentErrorHandler
 * 
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { AgentErrorHandler } from './AgentErrorHandler';
import { AgentErrorType, ErrorContext } from './types/agent.types';
import { KernelInterface } from './kernel/KernelInterface';

// Create a minimal mock for KernelInterface
const createMockKernelInterface = (): Partial<KernelInterface> => ({
    async restart(): Promise<void> {},
    async disconnect(): Promise<void> {},
    getStatus(): any { return 'idle'; },
    isConnected(): boolean { return true; }
});

describe('AgentErrorHandler', () => {
    let handler: AgentErrorHandler;
    let mockKernel: Partial<KernelInterface>;

    beforeEach(() => {
        handler = new AgentErrorHandler();
        mockKernel = createMockKernelInterface();
    });

    describe('categorize()', () => {
        it('should categorize kernel errors', () => {
            const context: ErrorContext = {
                mode: 'ASK',
                notebookId: 'test-notebook'
            };

            const error = new Error('Kernel connection lost');
            const agentError = handler.categorize(error, context);

            expect(agentError.type).toBe('kernel');
            expect(agentError.recoverable).toBe(true);
            expect(agentError.context.mode).toBe('ASK');
            expect(agentError.context.notebookId).toBe('test-notebook');
            expect(agentError.timestamp).toBeDefined();
        });

        it('should categorize syntax errors as execution errors', () => {
            const context: ErrorContext = {
                mode: 'AGENT',
                notebookId: 'test-notebook',
                cellId: 'cell-1'
            };

            const error = new Error('SyntaxError: invalid syntax');
            const agentError = handler.categorize(error, context);

            expect(agentError.type).toBe('execution');
            expect(agentError.context.cellId).toBe('cell-1');
        });

        it('should categorize name errors as execution errors', () => {
            const context: ErrorContext = {
                mode: 'ASK',
                notebookId: 'test-notebook'
            };

            const error = new Error('NameError: name is not defined');
            const agentError = handler.categorize(error, context);

            expect(agentError.type).toBe('execution');
        });

        it('should categorize type errors as execution errors', () => {
            const context: ErrorContext = {
                mode: 'PLAN',
                notebookId: 'test-notebook'
            };

            const error = new Error('TypeError: unsupported operand type');
            const agentError = handler.categorize(error, context);

            expect(agentError.type).toBe('execution');
        });

        it('should categorize memory errors', () => {
            const context: ErrorContext = {
                mode: 'AGENTIC',
                notebookId: 'test-notebook'
            };

            const error = new Error('MemoryError: out of memory');
            const agentError = handler.categorize(error, context);

            expect(agentError.type).toBe('memory');
        });

        it('should categorize recursion errors as memory errors', () => {
            const context: ErrorContext = {
                mode: 'ASK',
                notebookId: 'test-notebook'
            };

            const error = new Error('Maximum call stack depth exceeded');
            const agentError = handler.categorize(error, context);

            expect(agentError.type).toBe('memory');
        });

        it('should categorize LLM API errors', () => {
            const context: ErrorContext = {
                mode: 'ASK',
                notebookId: 'test-notebook'
            };

            const error = new Error('OpenAI API error: rate limit exceeded');
            const agentError = handler.categorize(error, context);

            expect(agentError.type).toBe('llm');
        });

        it('should categorize context length errors as LLM errors', () => {
            const context: ErrorContext = {
                mode: 'ASK',
                notebookId: 'test-notebook'
            };

            const error = new Error('Context length exceeded');
            const agentError = handler.categorize(error, context);

            expect(agentError.type).toBe('llm');
        });

        it('should categorize state management errors', () => {
            const context: ErrorContext = {
                mode: 'AGENT',
                notebookId: 'test-notebook'
            };

            const error = new Error('Mutex lock timeout');
            const agentError = handler.categorize(error, context);

            expect(agentError.type).toBe('state');
        });

        it('should include stack trace in categorized error', () => {
            const context: ErrorContext = {
                mode: 'ASK',
                notebookId: 'test-notebook'
            };

            const error = new Error('Test error');
            const agentError = handler.categorize(error, context);

            expect(agentError.stack).toBeDefined();
        });
    });

    describe('handleKernelError()', () => {
        it('should restart kernel when kernel error occurs', async () => {
            const handlerWithKernel = new AgentErrorHandler(mockKernel as KernelInterface);
            
            const error: any = {
                type: 'kernel',
                message: 'Kernel connection lost',
                recoverable: true,
                context: {},
                timestamp: Date.now()
            };

            const context: ErrorContext = {
                mode: 'ASK',
                notebookId: 'test-notebook'
            };

            const resolution = await handlerWithKernel.handleKernelError(error, context);

            expect(resolution.action).toBe('restart');
            expect(resolution.success).toBe(true);
            expect(resolution.suggestion).toContain('restarted');
        });

        it('should fail when no kernel interface is available', async () => {
            const error: any = {
                type: 'kernel',
                message: 'Kernel connection lost',
                recoverable: true,
                context: {},
                timestamp: Date.now()
            };

            const context: ErrorContext = {
                mode: 'ASK',
                notebookId: 'test-notebook'
            };

            const resolution = await handler.handleKernelError(error, context);

            expect(resolution.action).toBe('fail');
            expect(resolution.success).toBe(false);
            expect(resolution.suggestion).toContain('manually');
        });

        it('should fail when kernel restart is disabled', async () => {
            const handlerWithConfig = new AgentErrorHandler(mockKernel as KernelInterface, { enableKernelRestart: false });
            
            const error: any = {
                type: 'kernel',
                message: 'Kernel connection lost',
                recoverable: true,
                context: {},
                timestamp: Date.now()
            };

            const context: ErrorContext = {
                mode: 'ASK',
                notebookId: 'test-notebook'
            };

            const resolution = await handlerWithConfig.handleKernelError(error, context);

            expect(resolution.action).toBe('fail');
            expect(resolution.success).toBe(false);
        });
    });

    describe('handleExecutionError()', () => {
        it('should provide fix suggestion for execution errors', async () => {
            const error: any = {
                type: 'execution',
                message: 'NameError: name is not defined',
                recoverable: true,
                context: {},
                timestamp: Date.now()
            };

            const context: ErrorContext = {
                mode: 'ASK',
                notebookId: 'test-notebook'
            };

            const resolution = await handler.handleExecutionError(error, context);

            expect(resolution.action).toBe('suggest_fix');
            expect(resolution.success).toBe(true);
            expect(resolution.suggestion).toBeDefined();
            expect(resolution.suggestion).toContain('variable');
        });

        it('should provide syntax error suggestion', async () => {
            const error: any = {
                type: 'execution',
                message: 'SyntaxError: invalid syntax',
                recoverable: true,
                context: {},
                timestamp: Date.now()
            };

            const context: ErrorContext = {
                mode: 'AGENT',
                notebookId: 'test-notebook'
            };

            const resolution = await handler.handleExecutionError(error, context);

            expect(resolution.action).toBe('suggest_fix');
            expect(resolution.suggestion).toContain('syntax');
        });

        it('should provide type error suggestion', async () => {
            const error: any = {
                type: 'execution',
                message: 'TypeError: unsupported operand type',
                recoverable: true,
                context: {},
                timestamp: Date.now()
            };

            const context: ErrorContext = {
                mode: 'PLAN',
                notebookId: 'test-notebook'
            };

            const resolution = await handler.handleExecutionError(error, context);

            expect(resolution.action).toBe('suggest_fix');
            expect(resolution.suggestion).toContain('types');
        });
    });

    describe('suggestFix()', () => {
        it('should suggest fix for syntax errors', () => {
            const error: any = {
                type: 'execution',
                message: 'SyntaxError: invalid syntax',
                recoverable: true,
                context: {},
                timestamp: Date.now()
            };

            const suggestion = handler.suggestFix(error);

            expect(suggestion).toContain('syntax');
        });

        it('should suggest fix for name errors', () => {
            const error: any = {
                type: 'execution',
                message: 'NameError: x is not defined',
                recoverable: true,
                context: {},
                timestamp: Date.now()
            };

            const suggestion = handler.suggestFix(error);

            expect(suggestion).toContain('variable');
        });

        it('should suggest fix for import errors', () => {
            const error: any = {
                type: 'execution',
                message: 'ModuleNotFoundError: No module named numpy',
                recoverable: true,
                context: {},
                timestamp: Date.now()
            };

            const suggestion = handler.suggestFix(error);

            expect(suggestion).toContain('module');
        });

        it('should provide default suggestion for unknown errors', () => {
            const error: any = {
                type: 'execution',
                message: 'Some custom error',
                recoverable: true,
                context: {},
                timestamp: Date.now()
            };

            const suggestion = handler.suggestFix(error);

            expect(suggestion).toContain('Some custom error');
        });
    });

    describe('error logging', () => {
        it('should log errors with timestamps', async () => {
            const context: ErrorContext = {
                mode: 'ASK',
                notebookId: 'test-notebook'
            };

            const error = new Error('Test error');
            await handler.handle(error, context);

            const errorLog = handler.getErrorLog();
            expect(errorLog.length).toBe(1);
            expect(errorLog[0].timestamp).toBeDefined();
        });

        it('should maintain error log order', async () => {
            const context: ErrorContext = {
                mode: 'ASK',
                notebookId: 'test-notebook'
            };

            await handler.handle(new Error('Error 1'), context);
            await handler.handle(new Error('Error 2'), context);
            await handler.handle(new Error('Error 3'), context);

            const errorLog = handler.getErrorLog();
            expect(errorLog.length).toBe(3);
            expect(errorLog[0].message).toBe('Error 1');
            expect(errorLog[1].message).toBe('Error 2');
            expect(errorLog[2].message).toBe('Error 3');
        });

        it('should get recent errors by type', async () => {
            const context: ErrorContext = {
                mode: 'ASK',
                notebookId: 'test-notebook'
            };

            await handler.handle(new Error('Execution error 1'), context);
            await handler.handle(new Error('Kernel error'), context);
            await handler.handle(new Error('Execution error 2'), context);

            const recentErrors = handler.getRecentErrors('execution');
            expect(recentErrors.length).toBe(2);
            expect(recentErrors[0].message).toBe('Execution error 1');
            expect(recentErrors[1].message).toBe('Execution error 2');
        });

        it('should get error counts by type', async () => {
            const context: ErrorContext = {
                mode: 'ASK',
                notebookId: 'test-notebook'
            };

            await handler.handle(new Error('Execution error 1'), context);
            await handler.handle(new Error('Kernel error'), context);
            await handler.handle(new Error('Execution error 2'), context);

            const counts = handler.getErrorCountsByType();
            expect(counts.execution).toBe(2);
            expect(counts.kernel).toBe(1);
            expect(counts.memory).toBe(0);
        });

        it('should clear error log', async () => {
            const context: ErrorContext = {
                mode: 'ASK',
                notebookId: 'test-notebook'
            };

            await handler.handle(new Error('Error 1'), context);
            await handler.handle(new Error('Error 2'), context);

            handler.clearErrorLog();

            const errorLog = handler.getErrorLog();
            expect(errorLog.length).toBe(0);
        });
    });

    describe('error budget management', () => {
        it('should prune older errors when threshold exceeded', async () => {
            // Create handler with small max errors
            const smallHandler = new AgentErrorHandler(undefined, { maxErrors: 3 });
            
            const context: ErrorContext = {
                mode: 'ASK',
                notebookId: 'test-notebook'
            };

            // Add 5 errors
            for (let i = 1; i <= 5; i++) {
                await smallHandler.handle(new Error(`Error ${i}`), context);
            }

            const errorLog = smallHandler.getErrorLog();
            expect(errorLog.length).toBe(3);
            expect(errorLog[0].message).toBe('Error 3');
            expect(errorLog[2].message).toBe('Error 5');
        });

        it('should respect custom max errors configuration', () => {
            const handlerWithConfig = new AgentErrorHandler(undefined, { maxErrors: 10 });
            const config = handlerWithConfig.getConfig();
            
            expect(config.maxErrors).toBe(10);
        });
    });

    describe('retry management', () => {
        it('should track retry counts', () => {
            expect(handler.getRetryCount('test-key')).toBe(0);
            
            handler.incrementRetryCount('test-key');
            expect(handler.getRetryCount('test-key')).toBe(1);
            
            handler.incrementRetryCount('test-key');
            expect(handler.getRetryCount('test-key')).toBe(2);
        });

        it('should detect max retries exceeded', () => {
            const handlerWithRetries = new AgentErrorHandler(undefined, { maxRetries: 2 });
            
            // After 1 retry, still under limit
            handlerWithRetries.incrementRetryCount('test-key');
            expect(handlerWithRetries.isMaxRetriesExceeded('test-key')).toBe(false);
            
            // After 2 retries, at limit (count >= maxRetries means exceeded)
            handlerWithRetries.incrementRetryCount('test-key');
            expect(handlerWithRetries.isMaxRetriesExceeded('test-key')).toBe(true);
        });
    });

    describe('handle() main method', () => {
        it('should handle errors and return resolution', async () => {
            const context: ErrorContext = {
                mode: 'ASK',
                notebookId: 'test-notebook'
            };

            const error = new Error('NameError: x is not defined');
            const resolution = await handler.handle(error, context);

            expect(resolution.action).toBe('suggest_fix');
            expect(resolution.success).toBe(true);
            expect(resolution.suggestion).toBeDefined();
        });

        it('should log error when handling', async () => {
            const context: ErrorContext = {
                mode: 'ASK',
                notebookId: 'test-notebook'
            };

            const error = new Error('Test error');
            await handler.handle(error, context);

            expect(handler.getErrorLog().length).toBe(1);
        });

        it('should prune errors after handling', async () => {
            const smallHandler = new AgentErrorHandler(undefined, { maxErrors: 2 });
            
            const context: ErrorContext = {
                mode: 'ASK',
                notebookId: 'test-notebook'
            };

            await smallHandler.handle(new Error('Error 1'), context);
            await smallHandler.handle(new Error('Error 2'), context);
            await smallHandler.handle(new Error('Error 3'), context);

            expect(smallHandler.getErrorLog().length).toBe(2);
        });
    });

    describe('setKernelInterface()', () => {
        it('should allow setting kernel interface after construction', () => {
            const handlerWithoutKernel = new AgentErrorHandler();
            handlerWithoutKernel.setKernelInterface(mockKernel as KernelInterface);
            
            // Should be able to handle kernel errors now
            const context: ErrorContext = {
                mode: 'ASK',
                notebookId: 'test-notebook'
            };

            const error = new Error('Kernel connection lost');
            return handlerWithoutKernel.handle(error, context).then(resolution => {
                expect(resolution.action).toBe('restart');
            });
        });
    });

    describe('updateConfig()', () => {
        it('should update configuration', () => {
            handler.updateConfig({ maxErrors: 100, maxRetries: 5 });
            
            const config = handler.getConfig();
            expect(config.maxErrors).toBe(100);
            expect(config.maxRetries).toBe(5);
        });

        it('should merge partial configuration updates', () => {
            handler.updateConfig({ maxErrors: 50 });
            
            const config = handler.getConfig();
            expect(config.maxErrors).toBe(50);
            expect(config.maxRetries).toBe(DEFAULT_MAX_RETRIES);
        });
    });
});

// Helper constant for test
const DEFAULT_MAX_RETRIES = 3;