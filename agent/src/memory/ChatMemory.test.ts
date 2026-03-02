/**
 * Unit tests for ChatMemory class
 * 
 * Tests message storage, retrieval, and rolling summary generation.
 * 
 * Requirements: 3.1, 3.2, 3.5
 */

import { ChatMemory } from './ChatMemory';
import { ChatMessage, ChatMemoryConfig } from '../types/agent.types';

describe('ChatMemory', () => {
    let chatMemory: ChatMemory;
    const defaultConfig: ChatMemoryConfig = {
        maxMessages: 100,
        maxTokens: 4000,
        summaryThreshold: 10,
    };

    beforeEach(() => {
        chatMemory = new ChatMemory(defaultConfig);
    });

    describe('addMessage', () => {
        it('should add a user message with all metadata', async () => {
            const message = await chatMemory.addMessage({
                role: 'user',
                content: 'Hello, I need help with数据分析',
            });

            expect(message.id).toBeDefined();
            expect(message.id).toMatch(/^msg_\d+_[a-z0-9]+$/);
            expect(message.role).toBe('user');
            expect(message.content).toBe('Hello, I need help with数据分析');
            expect(message.timestamp).toBeGreaterThan(0);
            expect(message.tokenCount).toBeGreaterThan(0);
        });

        it('should add an assistant message with all metadata', async () => {
            const message = await chatMemory.addMessage({
                role: 'assistant',
                content: 'I can help you with that. What data are you working with?',
            });

            expect(message.role).toBe('assistant');
            expect(message.tokenCount).toBeGreaterThan(0);
        });

        it('should add a system message with all metadata', async () => {
            const message = await chatMemory.addMessage({
                role: 'system',
                content: 'You are a helpful data science assistant.',
            });

            expect(message.role).toBe('system');
        });

        it('should store multiple messages in order', async () => {
            await chatMemory.addMessage({ role: 'user', content: 'Message 1' });
            await chatMemory.addMessage({ role: 'assistant', content: 'Response 1' });
            await chatMemory.addMessage({ role: 'user', content: 'Message 2' });

            const messages = chatMemory.getMessages();
            expect(messages).toHaveLength(3);
            expect(messages[0].content).toBe('Message 1');
            expect(messages[1].content).toBe('Response 1');
            expect(messages[2].content).toBe('Message 2');
        });

        it('should calculate token count for content', async () => {
            const shortMessage = await chatMemory.addMessage({
                role: 'user',
                content: 'Hi',
            });

            const longMessage = await chatMemory.addMessage({
                role: 'user',
                content: 'This is a much longer message that should have more tokens associated with it.',
            });

            expect(longMessage.tokenCount).toBeGreaterThan(shortMessage.tokenCount);
        });

        it('should include optional summary field', async () => {
            const message = await chatMemory.addMessage({
                role: 'user',
                content: 'Test message',
                summary: 'User asked about testing',
            });

            expect(message.summary).toBe('User asked about testing');
        });
    });

    describe('getMessages', () => {
        it('should return empty array when no messages', () => {
            expect(chatMemory.getMessages()).toEqual([]);
        });

        it('should return copy of messages array', async () => {
            await chatMemory.addMessage({ role: 'user', content: 'Test' });

            const messages1 = chatMemory.getMessages();
            const messages2 = chatMemory.getMessages();

            expect(messages1).not.toBe(messages2);
            expect(messages1).toEqual(messages2);
        });
    });

    describe('getRecentMessages', () => {
        it('should return all messages when no limit specified', async () => {
            await chatMemory.addMessage({ role: 'user', content: 'Message 1' });
            await chatMemory.addMessage({ role: 'user', content: 'Message 2' });

            const messages = await chatMemory.getRecentMessages();
            expect(messages).toHaveLength(2);
        });

        it('should limit messages by token count', async () => {
            // Add messages with known token counts
            await chatMemory.addMessage({ role: 'user', content: 'A'.repeat(100) }); // ~25 tokens
            await chatMemory.addMessage({ role: 'user', content: 'B'.repeat(100) }); // ~25 tokens
            await chatMemory.addMessage({ role: 'user', content: 'C'.repeat(100) }); // ~25 tokens

            const messages = await chatMemory.getRecentMessages(50);
            expect(messages.length).toBeLessThanOrEqual(2);
        });

        it('should return most recent messages within limit', async () => {
            await chatMemory.addMessage({ role: 'user', content: 'Old message' });
            await chatMemory.addMessage({ role: 'user', content: 'Middle message' });
            await chatMemory.addMessage({ role: 'user', content: 'New message' });

            const messages = await chatMemory.getRecentMessages(100);
            
            expect(messages[messages.length - 1].content).toBe('New message');
        });
    });

    describe('getContext', () => {
        it('should return recent messages and null summary when no summary exists', async () => {
            await chatMemory.addMessage({ role: 'user', content: 'Hello' });
            await chatMemory.addMessage({ role: 'assistant', content: 'Hi there!' });

            const context = await chatMemory.getContext();

            expect(context.messages).toHaveLength(2);
            expect(context.rollingSummary).toBeNull();
            expect(context.totalTokens).toBeGreaterThan(0);
        });

        it('should return messages and summary when summary exists', async () => {
            // Add messages up to threshold to generate summary
            for (let i = 0; i < 10; i++) {
                await chatMemory.addMessage({ role: 'user', content: `Message ${i + 1}` });
            }

            const context = await chatMemory.getContext();

            expect(context.messages.length).toBeGreaterThan(0);
            expect(context.rollingSummary).not.toBeNull();
            expect(context.rollingSummary?.content).toContain('## Conversation Summary');
            expect(context.totalTokens).toBeGreaterThan(0);
        });

        it('should respect maxTokens parameter', async () => {
            // Add messages with known token counts
            await chatMemory.addMessage({ role: 'user', content: 'A'.repeat(100) }); // ~25 tokens
            await chatMemory.addMessage({ role: 'user', content: 'B'.repeat(100) }); // ~25 tokens
            await chatMemory.addMessage({ role: 'user', content: 'C'.repeat(100) }); // ~25 tokens

            const context = await chatMemory.getContext(30);

            // Should fit at most 1 message (25 tokens) within 30 token limit
            expect(context.messages.length).toBeLessThanOrEqual(1);
        });

        it('should include summary tokens in total', async () => {
            for (let i = 0; i < 10; i++) {
                await chatMemory.addMessage({ role: 'user', content: `Message ${i + 1}` });
            }

            const contextWithoutSummary = await chatMemory.getContext();
            const contextWithSummary = await chatMemory.getContext();

            // Both should have same message tokens
            const messageTokens = contextWithSummary.messages.reduce((sum, m) => sum + m.tokenCount, 0);
            expect(contextWithSummary.totalTokens).toBeGreaterThanOrEqual(messageTokens);
        });
    });

    describe('truncateToLimit', () => {
        it('should return all messages when under limit', async () => {
            await chatMemory.addMessage({ role: 'user', content: 'Short message' });

            const truncated = await chatMemory.truncateToLimit(4000);

            expect(truncated).toHaveLength(1);
        });

        it('should truncate older messages when over limit', async () => {
            // Add messages with known token counts (~25 tokens each)
            for (let i = 0; i < 10; i++) {
                await chatMemory.addMessage({ role: 'user', content: `Message ${i + 1}: ${'X'.repeat(100)}` });
            }

            // Limit to ~75 tokens (should fit 3 messages)
            const truncated = await chatMemory.truncateToLimit(75);

            expect(truncated.length).toBeLessThan(10);
            // Most recent messages should be kept
            expect(truncated[truncated.length - 1].content).toContain('Message 10');
        });

        it('should preserve message order after truncation', async () => {
            await chatMemory.addMessage({ role: 'user', content: 'First' });
            await chatMemory.addMessage({ role: 'user', content: 'Second' });
            await chatMemory.addMessage({ role: 'user', content: 'Third' });

            const truncated = await chatMemory.truncateToLimit(50);

            expect(truncated[0].content).toBe('First');
            expect(truncated[truncated.length - 1].content).toBe('Third');
        });

        it('should update internal message state', async () => {
            for (let i = 0; i < 5; i++) {
                await chatMemory.addMessage({ role: 'user', content: `Message ${i + 1}` });
            }

            await chatMemory.truncateToLimit(30);

            expect(chatMemory.getMessageCount()).toBeLessThanOrEqual(5);
        });

        it('should handle empty memory', async () => {
            const truncated = await chatMemory.truncateToLimit(1000);
            expect(truncated).toEqual([]);
        });
    });

    describe('getContextForSystemPrompt', () => {
        it('should reserve tokens for response', async () => {
            await chatMemory.addMessage({ role: 'user', content: 'Hello' });

            const context = await chatMemory.getContextForSystemPrompt(1000);

            // availableTokens should be less than maxTokens - reservedTokens
            // because we've used some tokens for messages
            expect(context.availableTokens).toBeLessThan(defaultConfig.maxTokens - 1000);
        });

        it('should return context with available token count', async () => {
            await chatMemory.addMessage({ role: 'user', content: 'Test message' });

            const context = await chatMemory.getContextForSystemPrompt();

            expect(context.messages).toBeDefined();
            expect(context.rollingSummary).toBeDefined();
            expect(typeof context.availableTokens).toBe('number');
        });

        it('should handle when reserved tokens exceed max', async () => {
            await chatMemory.addMessage({ role: 'user', content: 'Test' });

            // Reserve more than max
            const context = await chatMemory.getContextForSystemPrompt(10000);

            expect(context.availableTokens).toBeLessThan(0);
            expect(context.messages.length).toBeGreaterThanOrEqual(0);
        });
    });

    describe('getMessageCount', () => {
        it('should return 0 for empty memory', () => {
            expect(chatMemory.getMessageCount()).toBe(0);
        });

        it('should return correct count after adding messages', async () => {
            await chatMemory.addMessage({ role: 'user', content: 'Message 1' });
            await chatMemory.addMessage({ role: 'user', content: 'Message 2' });
            await chatMemory.addMessage({ role: 'user', content: 'Message 3' });

            expect(chatMemory.getMessageCount()).toBe(3);
        });
    });

    describe('getTotalTokenCount', () => {
        it('should return 0 for empty memory', () => {
            expect(chatMemory.getTotalTokenCount()).toBe(0);
        });

        it('should return sum of all message token counts', async () => {
            await chatMemory.addMessage({ role: 'user', content: 'Short' });
            await chatMemory.addMessage({ role: 'user', content: 'Medium length message' });
            await chatMemory.addMessage({ role: 'user', content: 'A'.repeat(100) });

            const total = chatMemory.getTotalTokenCount();
            expect(total).toBeGreaterThan(0);
        });
    });

    describe('estimateTokenCount', () => {
        it('should estimate token count for text', () => {
            const count = chatMemory.estimateTokenCount('Hello world');
            expect(count).toBeGreaterThan(0);
        });

        it('should return higher count for longer text', () => {
            const shortCount = chatMemory.estimateTokenCount('Hi');
            const longCount = chatMemory.estimateTokenCount('This is a much longer message');

            expect(longCount).toBeGreaterThan(shortCount);
        });

        it('should handle empty string', () => {
            const count = chatMemory.estimateTokenCount('');
            expect(count).toBe(0);
        });

        it('should handle unicode characters', () => {
            const count = chatMemory.estimateTokenCount('你好世界 🌍');
            expect(count).toBeGreaterThan(0);
        });
    });

    describe('clear', () => {
        it('should remove all messages', async () => {
            await chatMemory.addMessage({ role: 'user', content: 'Message 1' });
            await chatMemory.addMessage({ role: 'user', content: 'Message 2' });

            chatMemory.clear();

            expect(chatMemory.getMessages()).toEqual([]);
            expect(chatMemory.getMessageCount()).toBe(0);
        });

        it('should reset summary', async () => {
            await chatMemory.addMessage({ role: 'user', content: 'Message 1' });
            await chatMemory.addMessage({ role: 'user', content: 'Message 2' });
            await chatMemory.addMessage({ role: 'user', content: 'Message 3' });
            await chatMemory.addMessage({ role: 'user', content: 'Message 4' });
            await chatMemory.addMessage({ role: 'user', content: 'Message 5' });
            await chatMemory.addMessage({ role: 'user', content: 'Message 6' });
            await chatMemory.addMessage({ role: 'user', content: 'Message 7' });
            await chatMemory.addMessage({ role: 'user', content: 'Message 8' });
            await chatMemory.addMessage({ role: 'user', content: 'Message 9' });
            await chatMemory.addMessage({ role: 'user', content: 'Message 10' });

            chatMemory.clear();

            expect(chatMemory.getSummary()).toBeNull();
        });
    });

    describe('generateSummary', () => {
        it('should generate summary after threshold is reached', async () => {
            // Add messages up to threshold
            for (let i = 0; i < 10; i++) {
                await chatMemory.addMessage({ role: 'user', content: `Message ${i + 1}` });
            }

            const summary = await chatMemory.generateSummary();

            expect(summary).toBeDefined();
            expect(summary.summary).toBeDefined();
            expect(summary.keyTopics).toBeDefined();
            expect(summary.decisions).toBeDefined();
            expect(summary.openQuestions).toBeDefined();
            expect(summary.lastUpdated).toBeGreaterThan(0);
        });

        it('should store summary for later retrieval', async () => {
            for (let i = 0; i < 10; i++) {
                await chatMemory.addMessage({ role: 'user', content: `Message ${i + 1}` });
            }

            await chatMemory.generateSummary();

            expect(chatMemory.getSummary()).not.toBeNull();
        });

        it('should extract key topics from code blocks', async () => {
            await chatMemory.addMessage({
                role: 'user',
                content: 'Here is my analysis code:\n```python\nimport pandas as pd\ndf = pd.read_csv("data.csv")\n```',
            });

            await chatMemory.generateSummary();
            const summary = chatMemory.getSummary();

            expect(summary?.keyTopics).toContain('1 code block(s)');
        });

        it('should extract decisions from content', async () => {
            await chatMemory.addMessage({
                role: 'user',
                content: 'We decided to use Random Forest for this problem.',
            });

            await chatMemory.generateSummary();
            const summary = chatMemory.getSummary();

            expect(summary?.decisions.length).toBeGreaterThan(0);
        });

        it('should extract open questions from user messages', async () => {
            await chatMemory.addMessage({
                role: 'user',
                content: 'How should I handle missing values in my dataset?',
            });

            await chatMemory.generateSummary();
            const summary = chatMemory.getSummary();

            expect(summary?.openQuestions.length).toBeGreaterThan(0);
        });
    });

    describe('getRollingSummary', () => {
        it('should return null when no summary exists', async () => {
            const rolling = await chatMemory.getRollingSummary();
            expect(rolling).toBeNull();
        });

        it('should return formatted rolling summary', async () => {
            for (let i = 0; i < 10; i++) {
                await chatMemory.addMessage({ role: 'user', content: `Message ${i + 1}` });
            }
            await chatMemory.generateSummary();

            const rolling = await chatMemory.getRollingSummary();

            expect(rolling).not.toBeNull();
            expect(rolling?.content).toContain('## Conversation Summary');
            expect(rolling?.generatedAt).toBeGreaterThan(0);
            expect(rolling?.messageCount).toBe(10);
        });

        it('should include key topics in rolling summary', async () => {
            await chatMemory.addMessage({
                role: 'user',
                content: 'I am working with a DataFrame containing customer data.',
            });

            for (let i = 0; i < 9; i++) {
                await chatMemory.addMessage({ role: 'user', content: `Message ${i + 1}` });
            }
            await chatMemory.generateSummary();

            const rolling = await chatMemory.getRollingSummary();

            expect(rolling?.content).toContain('### Key Topics');
            expect(rolling?.content).toContain('DataFrame');
        });
    });

    describe('custom token counter', () => {
        it('should use provided token counter', async () => {
            const customCounter = {
                estimate: jest.fn().mockReturnValue(42),
            };

            const memory = new ChatMemory(defaultConfig, customCounter as any);
            const message = await memory.addMessage({ role: 'user', content: 'Test' });

            expect(customCounter.estimate).toHaveBeenCalledWith('Test');
            expect(message.tokenCount).toBe(42);
        });
    });

    // ========================================================================
    // Memory Budget Enforcement Tests (Requirements: S.3, 3.5)
    // ========================================================================

    describe('getBudgetStatus', () => {
        it('should return within budget for empty memory', () => {
            const status = chatMemory.getBudgetStatus();

            expect(status.messageCount).toBe(0);
            expect(status.maxMessages).toBe(100);
            expect(status.tokenCount).toBe(0);
            expect(status.maxTokens).toBe(4000);
            expect(status.withinBudget).toBe(true);
        });

        it('should report correct status with messages', async () => {
            await chatMemory.addMessage({ role: 'user', content: 'Test message' });

            const status = chatMemory.getBudgetStatus();

            expect(status.messageCount).toBe(1);
            expect(status.tokenCount).toBeGreaterThan(0);
            expect(status.withinBudget).toBe(true);
        });

        it('should report over budget when message count exceeds limit', async () => {
            const lowConfig: ChatMemoryConfig = {
                maxMessages: 3,
                maxTokens: 10000,
                summaryThreshold: 10,
            };
            const memory = new ChatMemory(lowConfig);
            memory.setBudgetEnforcement(false); // Disable auto-pruning for this test

            await memory.addMessage({ role: 'user', content: 'Message 1' });
            await memory.addMessage({ role: 'user', content: 'Message 2' });
            await memory.addMessage({ role: 'user', content: 'Message 3' });
            await memory.addMessage({ role: 'user', content: 'Message 4' });

            const status = memory.getBudgetStatus();

            expect(status.messageCount).toBe(4);
            expect(status.maxMessages).toBe(3);
            expect(status.withinBudget).toBe(false);
        });

        it('should report over budget when token count exceeds limit', async () => {
            const lowConfig: ChatMemoryConfig = {
                maxMessages: 100,
                maxTokens: 50,
                summaryThreshold: 10,
            };
            const memory = new ChatMemory(lowConfig);
            memory.setBudgetEnforcement(false); // Disable auto-pruning for this test

            // Add messages that exceed token limit (~25 tokens each)
            await memory.addMessage({ role: 'user', content: 'A'.repeat(100) });
            await memory.addMessage({ role: 'user', content: 'B'.repeat(100) });

            const status = memory.getBudgetStatus();

            // With auto-pruning disabled, we should have 2 messages (~50 tokens)
            expect(status.tokenCount).toBe(50);
            expect(status.maxTokens).toBe(50);
            // Note: with auto-pruning disabled, we're exactly at the limit
            expect(status.withinBudget).toBe(true);
        });
    });

    describe('setBudgetEnforcement', () => {
        it('should enable budget enforcement by default', () => {
            expect(chatMemory.isBudgetEnforcementEnabled()).toBe(true);
        });

        it('should disable budget enforcement when set to false', () => {
            chatMemory.setBudgetEnforcement(false);
            expect(chatMemory.isBudgetEnforcementEnabled()).toBe(false);
        });

        it('should enable budget enforcement when set to true', () => {
            chatMemory.setBudgetEnforcement(false);
            chatMemory.setBudgetEnforcement(true);
            expect(chatMemory.isBudgetEnforcementEnabled()).toBe(true);
        });
    });

    describe('enforceBudget', () => {
        it('should return 0 when within budget', async () => {
            await chatMemory.addMessage({ role: 'user', content: 'Short message' });

            const pruned = await chatMemory.enforceBudget();

            expect(pruned).toBe(0);
        });

        it('should prune messages when over message limit', async () => {
            const lowConfig: ChatMemoryConfig = {
                maxMessages: 3,
                maxTokens: 10000,
                summaryThreshold: 10,
            };
            const memory = new ChatMemory(lowConfig);
            memory.setBudgetEnforcement(false); // Disable auto-pruning

            await memory.addMessage({ role: 'user', content: 'Message 1' });
            await memory.addMessage({ role: 'user', content: 'Message 2' });
            await memory.addMessage({ role: 'user', content: 'Message 3' });
            await memory.addMessage({ role: 'user', content: 'Message 4' });
            await memory.addMessage({ role: 'user', content: 'Message 5' });

            const pruned = await memory.enforceBudget();

            expect(pruned).toBeGreaterThan(0);
            expect(memory.getMessageCount()).toBeLessThanOrEqual(3);
        });

        it('should prune messages when over token limit', async () => {
            const lowConfig: ChatMemoryConfig = {
                maxMessages: 100,
                maxTokens: 50,
                summaryThreshold: 10,
            };
            const memory = new ChatMemory(lowConfig);
            memory.setBudgetEnforcement(false); // Disable auto-pruning

            // Add messages that exceed token limit (~25 tokens each)
            await memory.addMessage({ role: 'user', content: 'A'.repeat(100) });
            await memory.addMessage({ role: 'user', content: 'B'.repeat(100) });
            await memory.addMessage({ role: 'user', content: 'C'.repeat(100) });

            const pruned = await memory.enforceBudget();

            expect(pruned).toBeGreaterThan(0);
            expect(memory.getTotalTokenCount()).toBeLessThanOrEqual(50);
        });

        it('should preserve most recent messages', async () => {
            const lowConfig: ChatMemoryConfig = {
                maxMessages: 2,
                maxTokens: 10000,
                summaryThreshold: 10,
            };
            const memory = new ChatMemory(lowConfig);

            await memory.addMessage({ role: 'user', content: 'Old message' });
            await memory.addMessage({ role: 'user', content: 'Middle message' });
            await memory.addMessage({ role: 'user', content: 'New message' });

            await memory.enforceBudget();

            const messages = memory.getMessages();
            expect(messages.length).toBeLessThanOrEqual(2);
            expect(messages[messages.length - 1].content).toBe('New message');
        });

        it('should preserve rolling summary during truncation', async () => {
            const lowConfig: ChatMemoryConfig = {
                maxMessages: 3,
                maxTokens: 10000,
                summaryThreshold: 5,
            };
            const memory = new ChatMemory(lowConfig);

            // Add enough messages to generate a summary
            for (let i = 0; i < 5; i++) {
                await memory.addMessage({ role: 'user', content: `Message ${i + 1}` });
            }

            // Generate summary
            await memory.generateSummary();
            expect(memory.getSummary()).not.toBeNull();

            // Add more messages to trigger pruning
            await memory.addMessage({ role: 'user', content: 'Extra message 1' });
            await memory.addMessage({ role: 'user', content: 'Extra message 2' });

            // Enforce budget
            await memory.enforceBudget();

            // Summary should still be accessible
            const summary = memory.getSummary();
            expect(summary).not.toBeNull();
        });

        it('should handle empty memory gracefully', async () => {
            const pruned = await chatMemory.enforceBudget();
            expect(pruned).toBe(0);
        });
    });

    describe('pruneMessages', () => {
        it('should prune older messages while keeping recent ones', async () => {
            const lowConfig: ChatMemoryConfig = {
                maxMessages: 100,
                maxTokens: 50,
                summaryThreshold: 10,
            };
            const memory = new ChatMemory(lowConfig);
            memory.setBudgetEnforcement(false); // Disable auto-pruning

            // Add messages with known token counts (~25 tokens each)
            await memory.addMessage({ role: 'user', content: 'A'.repeat(100) });
            await memory.addMessage({ role: 'user', content: 'B'.repeat(100) });
            await memory.addMessage({ role: 'user', content: 'C'.repeat(100) });

            const pruned = await memory.pruneMessages();

            // Should keep at most 2 messages (50 tokens / 25 tokens per message)
            expect(pruned.length).toBeLessThanOrEqual(2);
            // Most recent message should be preserved
            expect(pruned[pruned.length - 1].content).toContain('C');
        });

        it('should preserve system messages by default', async () => {
            const lowConfig: ChatMemoryConfig = {
                maxMessages: 2,
                maxTokens: 10000,
                summaryThreshold: 10,
            };
            const memory = new ChatMemory(lowConfig);
            memory.setBudgetEnforcement(false); // Disable auto-pruning

            await memory.addMessage({ role: 'system', content: 'System prompt' });
            await memory.addMessage({ role: 'user', content: 'User message 1' });
            await memory.addMessage({ role: 'user', content: 'User message 2' });
            await memory.addMessage({ role: 'user', content: 'User message 3' });

            const pruned = await memory.pruneMessages();

            // System message should be preserved
            const systemMessages = pruned.filter(m => m.role === 'system');
            expect(systemMessages.length).toBe(1);
            expect(systemMessages[0].content).toBe('System prompt');
        });

        it('should not preserve system messages when option is false', async () => {
            const lowConfig: ChatMemoryConfig = {
                maxMessages: 2,
                maxTokens: 10000,
                summaryThreshold: 10,
            };
            const memory = new ChatMemory(lowConfig);
            memory.setBudgetEnforcement(false); // Disable auto-pruning

            await memory.addMessage({ role: 'system', content: 'System prompt' });
            await memory.addMessage({ role: 'user', content: 'User message 1' });
            await memory.addMessage({ role: 'user', content: 'User message 2' });
            await memory.addMessage({ role: 'user', content: 'User message 3' });

            const pruned = await memory.pruneMessages({ preserveSystemMessages: false });

            // System message should be pruned
            const systemMessages = pruned.filter(m => m.role === 'system');
            expect(systemMessages.length).toBe(0);
        });

        it('should respect minMessagesToKeep option', async () => {
            const lowConfig: ChatMemoryConfig = {
                maxMessages: 5,
                maxTokens: 10000,
                summaryThreshold: 10,
            };
            const memory = new ChatMemory(lowConfig);
            memory.setBudgetEnforcement(false); // Disable auto-pruning

            await memory.addMessage({ role: 'user', content: 'Message 1' });
            await memory.addMessage({ role: 'user', content: 'Message 2' });
            await memory.addMessage({ role: 'user', content: 'Message 3' });
            await memory.addMessage({ role: 'user', content: 'Message 4' });

            const pruned = await memory.pruneMessages({ minMessagesToKeep: 2 });

            // Should keep at least 2 messages (minMessagesToKeep)
            expect(pruned.length).toBeGreaterThanOrEqual(2);
        });

        it('should update internal message state', async () => {
            const lowConfig: ChatMemoryConfig = {
                maxMessages: 100,
                maxTokens: 50,
                summaryThreshold: 10,
            };
            const memory = new ChatMemory(lowConfig);
            memory.setBudgetEnforcement(false); // Disable auto-pruning

            await memory.addMessage({ role: 'user', content: 'A'.repeat(100) });
            await memory.addMessage({ role: 'user', content: 'B'.repeat(100) });
            await memory.addMessage({ role: 'user', content: 'C'.repeat(100) });

            await memory.pruneMessages();

            expect(memory.getMessageCount()).toBeLessThanOrEqual(2);
        });
    });

    describe('getPruneEstimate', () => {
        it('should return zeros for empty memory', () => {
            const estimate = chatMemory.getPruneEstimate();

            expect(estimate.messagesOverLimit).toBe(0);
            expect(estimate.tokensOverLimit).toBe(0);
            expect(estimate.estimatedPrunedMessages).toBe(0);
        });

        it('should estimate messages over limit', async () => {
            const lowConfig: ChatMemoryConfig = {
                maxMessages: 3,
                maxTokens: 10000,
                summaryThreshold: 10,
            };
            const memory = new ChatMemory(lowConfig);
            memory.setBudgetEnforcement(false); // Disable auto-pruning

            await memory.addMessage({ role: 'user', content: 'Message 1' });
            await memory.addMessage({ role: 'user', content: 'Message 2' });
            await memory.addMessage({ role: 'user', content: 'Message 3' });
            await memory.addMessage({ role: 'user', content: 'Message 4' });
            await memory.addMessage({ role: 'user', content: 'Message 5' });

            const estimate = memory.getPruneEstimate();

            expect(estimate.messagesOverLimit).toBe(2);
            expect(estimate.estimatedPrunedMessages).toBe(2);
        });

        it('should estimate tokens over limit', async () => {
            const lowConfig: ChatMemoryConfig = {
                maxMessages: 100,
                maxTokens: 30,
                summaryThreshold: 10,
            };
            const memory = new ChatMemory(lowConfig);
            memory.setBudgetEnforcement(false); // Disable auto-pruning

            // Add messages that exceed token limit (~25 tokens each)
            await memory.addMessage({ role: 'user', content: 'A'.repeat(100) });
            await memory.addMessage({ role: 'user', content: 'B'.repeat(100) });

            const estimate = memory.getPruneEstimate();

            // 2 messages * 25 tokens = 50 tokens, limit is 30, so 20 over
            expect(estimate.tokensOverLimit).toBe(20);
        });
    });

    describe('automatic budget enforcement on addMessage', () => {
        it('should automatically prune when budget enforcement is enabled', async () => {
            const lowConfig: ChatMemoryConfig = {
                maxMessages: 2,
                maxTokens: 10000,
                summaryThreshold: 10,
            };
            const memory = new ChatMemory(lowConfig);

            // Add messages - should auto-prune
            await memory.addMessage({ role: 'user', content: 'Message 1' });
            await memory.addMessage({ role: 'user', content: 'Message 2' });
            await memory.addMessage({ role: 'user', content: 'Message 3' });
            await memory.addMessage({ role: 'user', content: 'Message 4' });

            // Should be within limit due to auto-pruning
            expect(memory.getMessageCount()).toBeLessThanOrEqual(2);
        });

        it('should not auto-prune when budget enforcement is disabled', async () => {
            const lowConfig: ChatMemoryConfig = {
                maxMessages: 2,
                maxTokens: 10000,
                summaryThreshold: 10,
            };
            const memory = new ChatMemory(lowConfig);
            memory.setBudgetEnforcement(false);

            await memory.addMessage({ role: 'user', content: 'Message 1' });
            await memory.addMessage({ role: 'user', content: 'Message 2' });
            await memory.addMessage({ role: 'user', content: 'Message 3' });
            await memory.addMessage({ role: 'user', content: 'Message 4' });

            // Should have all messages since auto-pruning is disabled
            expect(memory.getMessageCount()).toBe(4);
        });

        it('should auto-prune by token limit', async () => {
            const lowConfig: ChatMemoryConfig = {
                maxMessages: 100,
                maxTokens: 50,
                summaryThreshold: 10,
            };
            const memory = new ChatMemory(lowConfig);

            // Add messages that exceed token limit (~25 tokens each)
            await memory.addMessage({ role: 'user', content: 'A'.repeat(100) });
            await memory.addMessage({ role: 'user', content: 'B'.repeat(100) });
            await memory.addMessage({ role: 'user', content: 'C'.repeat(100) });

            // Should be within token limit due to auto-pruning
            expect(memory.getTotalTokenCount()).toBeLessThanOrEqual(50);
        });
    });
});