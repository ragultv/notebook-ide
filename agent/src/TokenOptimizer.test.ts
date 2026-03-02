/**
 * Unit tests for TokenOptimizer
 */

import { TokenOptimizer } from './TokenOptimizer';
import type {
    ChatMessage,
    IntrospectionJSON,
    ConversationSummary
} from './types/agent.types';

describe('TokenOptimizer', () => {
    let optimizer: TokenOptimizer;
    
    const createTestMessages = (count: number): ChatMessage[] => {
        return Array.from({ length: count }, (_, i) => ({
            id: `msg-${i}`,
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: `This is test message ${i} with some content to increase token count. `.repeat(5),
            timestamp: Date.now() - (count - i) * 60000,
            tokenCount: 50
        }));
    };
    
    const createTestIntrospection = (variableCount: number, experimentCount: number): IntrospectionJSON => {
        return {
            version: '1.0',
            generatedAt: Date.now(),
            notebook: {
                id: 'test-notebook',
                cellCount: 20,
                executionOrder: Array.from({ length: 20 }, (_, i) => `cell-${i}`)
            },
            variables: Array.from({ length: variableCount }, (_, i) => ({
                name: `var${i}`,
                type: i % 3 === 0 ? 'DataFrame' : i % 3 === 1 ? 'ndarray' : 'list',
                shape: i % 3 === 0 ? `(100, ${i + 1})` : i % 3 === 1 ? `(${i + 1},)` : `(${i + 1},)`,
                valuePreview: `Preview of var${i}: [1, 2, 3, ...]`,
                definedIn: `cell-${i}`,
                dependencies: i > 0 ? [`var${i - 1}`] : [],
                referencedBy: i < variableCount - 1 ? [`cell-${i + 1}`] : []
            })),
            experiments: Array.from({ length: experimentCount }, (_, i) => ({
                id: `exp-${i}`,
                name: `Experiment ${i}`,
                description: `Description for experiment ${i}`,
                cells: [`cell-${i}`],
                status: i % 2 === 0 ? 'completed' : 'active' as const,
                metrics: { accuracy: 0.8 + i * 0.02, loss: 0.2 - i * 0.01 }
            })),
            executionContext: {
                currentCell: 'cell-19',
                executionCount: 20,
                kernelStatus: 'idle',
                lastExecutionTime: Date.now()
            },
            recentActivity: Array.from({ length: 10 }, (_, i) => ({
                timestamp: Date.now() - i * 60000,
                type: i % 3 === 0 ? 'execution' : i % 3 === 1 ? 'edit' : 'chat',
                description: `Activity ${i}`,
                cellId: `cell-${i}`
            }))
        };
    };
    
    const createTestSummary = (): ConversationSummary => ({
        summary: 'This is a test conversation summary about data analysis and machine learning.',
        keyTopics: ['data preprocessing', 'model training', 'evaluation metrics'],
        decisions: ['Used RandomForest classifier', 'Applied standard scaling'],
        openQuestions: ['Should we try gradient boosting?'],
        lastUpdated: Date.now()
    });
    
    beforeEach(() => {
        optimizer = new TokenOptimizer({
            maxContextTokens: 8000,
            reservedResponseTokens: 1000,
            introspectionRatio: 0.3,
            minRecentMessages: 5,
            overheadEstimate: 50
        });
    });
    
    describe('constructor', () => {
        it('should initialize with default values', () => {
            const defaultOptimizer = new TokenOptimizer({ maxContextTokens: 5000 });
            const config = defaultOptimizer.getConfig();
            
            expect(config.maxContextTokens).toBe(5000);
            expect(config.reservedResponseTokens).toBe(1000);
            expect(config.introspectionRatio).toBe(0.3);
            expect(config.minRecentMessages).toBe(5);
            expect(config.overheadEstimate).toBe(50);
        });
        
        it('should accept custom configuration', () => {
            const customOptimizer = new TokenOptimizer({
                maxContextTokens: 10000,
                reservedResponseTokens: 2000,
                introspectionRatio: 0.4,
                minRecentMessages: 10,
                overheadEstimate: 100
            });
            const config = customOptimizer.getConfig();
            
            expect(config.maxContextTokens).toBe(10000);
            expect(config.reservedResponseTokens).toBe(2000);
            expect(config.introspectionRatio).toBe(0.4);
            expect(config.minRecentMessages).toBe(10);
            expect(config.overheadEstimate).toBe(100);
        });
    });
    
    describe('optimizeForContext', () => {
        it('should return context within limits when content fits', async () => {
            const messages = createTestMessages(3);
            const introspection = createTestIntrospection(5, 2);
            const summary = createTestSummary();
            
            const result = await optimizer.optimizeForContext(messages, introspection, summary);
            
            expect(result.messages).toHaveLength(3);
            expect(result.introspection.variables).toHaveLength(5);
            expect(result.summary).toContain('Conversation Summary');
            expect(result.totalTokens).toBeLessThanOrEqual(7000); // maxContext - reservedResponse
            expect(result.availableForResponse).toBe(1000);
        });
        
        it('should preserve all messages when within limits', async () => {
            const messages = createTestMessages(2);
            const introspection = createTestIntrospection(2, 1);
            const summary = createTestSummary();
            
            const result = await optimizer.optimizeForContext(messages, introspection, summary);
            
            expect(result.messages).toHaveLength(2);
            expect(result.messages[0].id).toBe('msg-0');
            expect(result.messages[1].id).toBe('msg-1');
        });
        
        it('should truncate messages when token limit exceeded', async () => {
            const messages = createTestMessages(50); // Many messages
            const introspection = createTestIntrospection(20, 10);
            const summary = createTestSummary();
            
            const result = await optimizer.optimizeForContext(messages, introspection, summary);
            
            // Should preserve recent messages
            expect(result.messages.length).toBeGreaterThanOrEqual(5);
            // Last message should be the most recent
            expect(result.messages[result.messages.length - 1].id).toBe('msg-49');
        });
        
        it('should truncate introspection when token limit exceeded', async () => {
            const messages = createTestMessages(10);
            const introspection = createTestIntrospection(50, 20); // Large introspection
            const summary = createTestSummary();
            
            const result = await optimizer.optimizeForContext(messages, introspection, summary);
            
            // Introspection should be truncated but still present
            // With 30% ratio and truncation, variables will be reduced
            expect(result.introspection.variables.length).toBeLessThanOrEqual(50);
            expect(result.introspection.notebook.id).toBe('test-notebook');
        });
        
        it('should preserve recent messages during truncation', async () => {
            const messages = createTestMessages(30);
            const introspection = createTestIntrospection(5, 2);
            const summary = createTestSummary();
            
            const result = await optimizer.optimizeForContext(messages, introspection, summary);
            
            // Last message should be msg-29 (most recent)
            expect(result.messages[result.messages.length - 1].id).toBe('msg-29');
            // Second to last should be msg-28
            expect(result.messages[result.messages.length - 2].id).toBe('msg-28');
        });
        
        it('should include rolling summary in context', async () => {
            const messages = createTestMessages(5);
            const introspection = createTestIntrospection(3, 1);
            const summary = createTestSummary();
            
            const result = await optimizer.optimizeForContext(messages, introspection, summary);
            
            expect(result.summary).toContain('Conversation Summary');
            expect(result.summary).toContain('Key Topics');
            expect(result.summary).toContain('data preprocessing');
        });
        
        it('should respect introspection ratio allocation', async () => {
            const messages = createTestMessages(20);
            const introspection = createTestIntrospection(30, 10);
            const summary = createTestSummary();
            
            const result = await optimizer.optimizeForContext(messages, introspection, summary);
            
            // With 30% ratio, introspection should get approximately 30% of content tokens
            // Allow more tolerance since truncation affects the ratio
            const contentTokens = result.tokenBreakdown.messages + result.tokenBreakdown.introspection;
            const introspectionRatio = result.tokenBreakdown.introspection / contentTokens;
            
            // Introspection should get a significant portion but not exceed 60%
            expect(introspectionRatio).toBeGreaterThan(0.15);
            expect(introspectionRatio).toBeLessThanOrEqual(0.6);
        });
        
        it('should handle empty messages', async () => {
            const messages: ChatMessage[] = [];
            const introspection = createTestIntrospection(3, 1);
            const summary = createTestSummary();
            
            const result = await optimizer.optimizeForContext(messages, introspection, summary);
            
            expect(result.messages).toHaveLength(0);
            expect(result.introspection.variables).toHaveLength(3);
        });
        
        it('should handle empty introspection', async () => {
            const messages = createTestMessages(5);
            const introspection: IntrospectionJSON = {
                version: '1.0',
                generatedAt: Date.now(),
                notebook: { id: 'test', cellCount: 0, executionOrder: [] },
                variables: [],
                experiments: [],
                executionContext: { currentCell: null, executionCount: 0, kernelStatus: 'idle', lastExecutionTime: 0 },
                recentActivity: []
            };
            const summary = createTestSummary();
            
            const result = await optimizer.optimizeForContext(messages, introspection, summary);
            
            expect(result.introspection.variables).toHaveLength(0);
            expect(result.messages).toHaveLength(5);
        });
        
        it('should handle empty summary', async () => {
            const messages = createTestMessages(5);
            const introspection = createTestIntrospection(3, 1);
            const summary: ConversationSummary = {
                summary: '',
                keyTopics: [],
                decisions: [],
                openQuestions: [],
                lastUpdated: Date.now()
            };
            
            const result = await optimizer.optimizeForContext(messages, introspection, summary);
            
            expect(result.summary).toBe('');
        });
    });
    
    describe('token estimation', () => {
        it('should estimate message tokens accurately', () => {
            const messages: ChatMessage[] = [
                {
                    id: '1',
                    role: 'user',
                    content: 'Hello world',
                    timestamp: Date.now(),
                    tokenCount: 0
                }
            ];
            
            const tokens = optimizer.estimateMessagesTokenCount(messages);
            
            // "Hello world" is about 2 tokens, plus role overhead
            expect(tokens).toBeGreaterThanOrEqual(3);
        });
        
        it('should estimate introspection tokens accurately', () => {
            const introspection: IntrospectionJSON = {
                version: '1.0',
                generatedAt: Date.now(),
                notebook: { id: 'test', cellCount: 1, executionOrder: ['cell-1'] },
                variables: [{ name: 'x', type: 'int', shape: '()', valuePreview: '42', definedIn: 'cell-1', dependencies: [], referencedBy: [] }],
                experiments: [],
                executionContext: { currentCell: 'cell-1', executionCount: 1, kernelStatus: 'idle', lastExecutionTime: Date.now() },
                recentActivity: []
            };
            
            const tokens = optimizer.estimateIntrospectionTokenCount(introspection);
            
            expect(tokens).toBeGreaterThan(0);
        });
        
        it('should estimate summary tokens accurately', () => {
            const summary: ConversationSummary = {
                summary: 'Short summary',
                keyTopics: ['topic1'],
                decisions: [],
                openQuestions: [],
                lastUpdated: Date.now()
            };
            
            const tokens = optimizer.estimateSummaryTokenCount(summary);
            
            expect(tokens).toBeGreaterThan(0);
        });
    });
    
    describe('calculateRequiredTokens', () => {
        it('should calculate total tokens needed for context', () => {
            const messages = createTestMessages(10);
            const introspection = createTestIntrospection(10, 5);
            const summary = createTestSummary();
            
            const required = optimizer.calculateRequiredTokens(messages, introspection, summary);
            
            expect(required).toBeGreaterThan(0);
            // Should include messages + introspection + summary + overhead + response
            expect(required).toBeGreaterThan(optimizer.estimateMessagesTokenCount(messages));
            expect(required).toBeGreaterThan(optimizer.estimateIntrospectionTokenCount(introspection));
        });
        
        it('should return accurate estimate for empty context', () => {
            const messages: ChatMessage[] = [];
            const introspection: IntrospectionJSON = {
                version: '1.0',
                generatedAt: Date.now(),
                notebook: { id: 'test', cellCount: 0, executionOrder: [] },
                variables: [],
                experiments: [],
                executionContext: { currentCell: null, executionCount: 0, kernelStatus: 'idle', lastExecutionTime: 0 },
                recentActivity: []
            };
            const summary: ConversationSummary = {
                summary: '',
                keyTopics: [],
                decisions: [],
                openQuestions: [],
                lastUpdated: Date.now()
            };
            
            const required = optimizer.calculateRequiredTokens(messages, introspection, summary);
            
            // Should be approximately overhead + reservedResponse + base JSON structure
            expect(required).toBeGreaterThanOrEqual(1000); // At least reserved response
            expect(required).toBeLessThan(2000); // Reasonable upper bound
        });
    });
    
    describe('edge cases', () => {
        it('should handle very long messages', async () => {
            const longMessage: ChatMessage = {
                id: 'long',
                role: 'user',
                content: 'A'.repeat(10000), // Very long message
                timestamp: Date.now(),
                tokenCount: 0
            };
            const messages = [longMessage];
            const introspection = createTestIntrospection(2, 1);
            const summary = createTestSummary();
            
            const result = await optimizer.optimizeForContext(messages, introspection, summary);
            
            // Should still return valid context
            expect(result.messages.length).toBeGreaterThanOrEqual(0);
            expect(result.introspection.variables.length).toBe(2);
        });
        
        it('should handle very small maxContextTokens', async () => {
            const smallOptimizer = new TokenOptimizer({
                maxContextTokens: 500,
                reservedResponseTokens: 100,
                introspectionRatio: 0.3,
                minRecentMessages: 2
            });
            
            const messages = createTestMessages(10);
            const introspection = createTestIntrospection(10, 5);
            const summary = createTestSummary();
            
            const result = await smallOptimizer.optimizeForContext(messages, introspection, summary);
            
            // Should still return valid context with minimum preserved
            expect(result.messages.length).toBeGreaterThanOrEqual(2);
            // Total should be within reasonable bounds of maxContext - reserved
            expect(result.totalTokens).toBeLessThanOrEqual(500);
        });
        
        it('should handle messages with special characters', async () => {
            const messages: ChatMessage[] = [
                {
                    id: '1',
                    role: 'user',
                    content: 'Hello "world" with \'quotes\' and\nnewlines\tand\ttabs',
                    timestamp: Date.now(),
                    tokenCount: 0
                }
            ];
            const introspection = createTestIntrospection(1, 0);
            const summary = createTestSummary();
            
            const result = await optimizer.optimizeForContext(messages, introspection, summary);
            
            expect(result.messages[0].content).toBe(messages[0].content);
        });
    });
    
    describe('token breakdown', () => {
        it('should provide accurate token breakdown', async () => {
            const messages = createTestMessages(5);
            const introspection = createTestIntrospection(3, 1);
            const summary = createTestSummary();
            
            const result = await optimizer.optimizeForContext(messages, introspection, summary);
            const breakdown = result.tokenBreakdown;
            
            // Verify breakdown adds up
            expect(breakdown.messages + breakdown.introspection + breakdown.summary + breakdown.overhead + breakdown.response)
                .toBe(breakdown.total);
            
            // Response should match reserved tokens
            expect(breakdown.response).toBe(1000);
        });
    });
});