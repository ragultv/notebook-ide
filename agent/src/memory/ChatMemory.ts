/**
 * ChatMemory - Conversation memory with rolling summaries
 * 
 * Stores chat messages with metadata and generates rolling summaries
 * for long-running conversations.
 * 
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
 */

import {
    ChatMessage,
    ConversationSummary,
    RollingSummary,
    ChatMemoryConfig,
} from '../types/agent.types';

/**
 * Token counter interface for estimating token usage
 */
interface TokenCounter {
    estimate(text: string): number;
}

/**
 * Default token counter using simple word-based estimation
 */
class SimpleTokenCounter implements TokenCounter {
    estimate(text: string): number {
        // Rough estimate: ~4 characters per token on average
        return Math.ceil(text.length / 4);
    }
}

/**
 * ChatMemory class for managing conversation history
 * 
 * Provides message storage with metadata and rolling summary generation
 * to maintain context across long-running conversations.
 */
export class ChatMemory {
    private messages: ChatMessage[];
    private summary: ConversationSummary | null;
    private config: ChatMemoryConfig;
    private tokenCounter: TokenCounter;
    private budgetEnforcementEnabled: boolean;
    private lastBudgetCheck: number;

    /**
     * Create a new ChatMemory instance
     * 
     * @param config - Chat memory configuration
     * @param tokenCounter - Optional token counter (defaults to SimpleTokenCounter)
     */
    constructor(config: ChatMemoryConfig, tokenCounter?: TokenCounter);
    
    constructor(
        config: ChatMemoryConfig,
        tokenCounter: TokenCounter = new SimpleTokenCounter()
    ) {
        this.config = config;
        this.messages = [];
        this.summary = null;
        this.tokenCounter = tokenCounter;
        this.budgetEnforcementEnabled = true;
        this.lastBudgetCheck = 0;
    }

    /**
     * Add a message to the conversation history
     * 
     * Stores the message with role, content, timestamp, and token count.
     * Automatically generates a summary when message threshold is exceeded.
     * Automatically enforces memory budget if budget enforcement is enabled.
     * 
     * @param message - Message to add (without id, timestamp, tokenCount)
     * @returns The added message with generated metadata
     * 
     * Requirements: 3.1, S.3, 3.5
     */
    async addMessage(
        message: Omit<ChatMessage, 'id' | 'timestamp' | 'tokenCount'>
    ): Promise<ChatMessage> {
        const tokenCount = this.tokenCounter.estimate(message.content);
        
        const fullMessage: ChatMessage = {
            ...message,
            id: this.generateMessageId(),
            timestamp: Date.now(),
            tokenCount,
        };

        this.messages.push(fullMessage);

        // Check if we should generate a summary
        if (this.messages.length >= this.config.summaryThreshold) {
            await this.generateSummary();
        }

        // Enforce memory budget if enabled
        if (this.budgetEnforcementEnabled) {
            await this.enforceBudget();
        }

        return fullMessage;
    }

    /**
     * Get all messages in the conversation
     * 
     * @returns Array of all stored messages
     */
    getMessages(): ChatMessage[] {
        return [...this.messages];
    }

    /**
     * Get recent messages within token limit
     * 
     * @param maxTokens - Maximum tokens for returned messages
     * @returns Array of recent messages within token limit
     */
    async getRecentMessages(maxTokens?: number): Promise<ChatMessage[]> {
        if (!maxTokens || maxTokens >= this.config.maxTokens) {
            return this.getMessages();
        }

        let tokenCount = 0;
        const recentMessages: ChatMessage[] = [];

        // Get messages from most recent to oldest
        for (let i = this.messages.length - 1; i >= 0; i--) {
            const message = this.messages[i];
            if (tokenCount + message.tokenCount <= maxTokens) {
                recentMessages.unshift(message);
                tokenCount += message.tokenCount;
            } else {
                break;
            }
        }

        return recentMessages;
    }

    /**
     * Get context for LLM requests
     * 
     * Returns recent messages within token limit plus the rolling summary.
     * This is the primary method for building context for LLM requests.
     * 
     * @param maxTokens - Maximum tokens for messages (default: config.maxTokens)
     * @returns Object containing recent messages and rolling summary
     * 
     * Requirements: 3.4
     */
    async getContext(maxTokens?: number): Promise<{
        messages: ChatMessage[];
        rollingSummary: RollingSummary | null;
        totalTokens: number;
    }> {
        const tokenLimit = maxTokens ?? this.config.maxTokens;
        
        // Get recent messages within token limit
        const messages = await this.getRecentMessages(tokenLimit);
        
        // Get rolling summary
        const rollingSummary = await this.getRollingSummary();
        
        // Calculate total tokens used
        const messageTokens = messages.reduce((sum, msg) => sum + msg.tokenCount, 0);
        const summaryTokens = rollingSummary 
            ? this.tokenCounter.estimate(rollingSummary.content) 
            : 0;
        
        return {
            messages,
            rollingSummary,
            totalTokens: messageTokens + summaryTokens,
        };
    }

    /**
     * Get context for system prompt
     * 
     * Builds a complete context object including messages and summary
     * optimized for LLM system prompts. Reserves tokens for response.
     * 
     * @param reservedTokens - Tokens reserved for response (default: 1000)
     * @returns Optimized context for system prompt
     * 
     * Requirements: 10.1, 10.4, 10.5
     */
    async getContextForSystemPrompt(reservedTokens: number = 1000): Promise<{
        messages: ChatMessage[];
        rollingSummary: RollingSummary | null;
        availableTokens: number;
    }> {
        const availableTokens = this.config.maxTokens - reservedTokens;
        
        // Get context with available token budget
        const context = await this.getContext(availableTokens);
        
        return {
            messages: context.messages,
            rollingSummary: context.rollingSummary,
            availableTokens: availableTokens - context.totalTokens,
        };
    }

    /**
     * Truncate messages to fit within token limit
     * 
     * Removes older messages from the beginning of the conversation
     * while preserving the summary. This ensures the most recent
     * context is always retained.
     * 
     * @param maxTokens - Maximum tokens allowed
     * @returns Truncated message array
     * 
     * Requirements: 3.5, 10.4, 10.5
     */
    async truncateToLimit(maxTokens: number): Promise<ChatMessage[]> {
        if (maxTokens >= this.config.maxTokens) {
            return this.getMessages();
        }

        let currentTokens = 0;
        const messagesToKeep: ChatMessage[] = [];

        // Start from the most recent messages and work backwards
        for (let i = this.messages.length - 1; i >= 0; i--) {
            const message = this.messages[i];
            if (currentTokens + message.tokenCount <= maxTokens) {
                messagesToKeep.unshift(message);
                currentTokens += message.tokenCount;
            } else {
                // Stop once we exceed the limit
                break;
            }
        }

        // Update internal state with truncated messages
        this.messages = messagesToKeep;

        return this.getMessages();
    }

    /**
     * Get the current conversation summary
     * 
     * @returns Current summary or null if not generated
     */
    getSummary(): ConversationSummary | null {
        return this.summary;
    }

    /**
     * Get rolling summary for system prompt
     * 
     * @returns Formatted rolling summary
     */
    async getRollingSummary(): Promise<RollingSummary | null> {
        if (!this.summary) {
            return null;
        }

        const content = this.formatRollingSummary(this.summary);

        return {
            content,
            generatedAt: this.summary.lastUpdated,
            messageCount: this.messages.length,
        };
    }

    /**
     * Generate a rolling summary of the conversation
     * 
     * Extracts key topics, decisions, and open questions from
     * recent messages.
     * 
     * @returns Generated conversation summary
     * 
     * Requirements: 3.2, 3.3
     */
    async generateSummary(): Promise<ConversationSummary> {
        const recentMessages = this.messages.slice(-this.config.summaryThreshold);
        const allContent = recentMessages.map(m => m.content).join('\n');

        const summary: ConversationSummary = {
            summary: this.createSummaryText(recentMessages),
            keyTopics: this.extractTopics(allContent),
            decisions: this.extractDecisions(allContent),
            openQuestions: this.extractOpenQuestions(recentMessages),
            lastUpdated: Date.now(),
        };

        this.summary = summary;
        return summary;
    }

    /**
     * Estimate token count for text
     * 
     * @param text - Text to estimate
     * @returns Estimated token count
     */
    estimateTokenCount(text: string): number {
        return this.tokenCounter.estimate(text);
    }

    /**
     * Get total token count of all messages
     * 
     * @returns Total token count
     */
    getTotalTokenCount(): number {
        return this.messages.reduce((sum, msg) => sum + msg.tokenCount, 0);
    }

    /**
     * Get number of stored messages
     * 
     * @returns Message count
     */
    getMessageCount(): number {
        return this.messages.length;
    }

    /**
     * Clear all messages and summary
     */
    clear(): void {
        this.messages = [];
        this.summary = null;
    }

    // ========================================================================
    // Memory Budget Enforcement (Requirements: S.3, 3.5)
    // ========================================================================

    /**
     * Enable or disable automatic budget enforcement
     * 
     * @param enabled - Whether to enforce budget limits automatically
     */
    setBudgetEnforcement(enabled: boolean): void {
        this.budgetEnforcementEnabled = enabled;
    }

    /**
     * Check if budget enforcement is enabled
     * 
     * @returns Whether budget enforcement is enabled
     */
    isBudgetEnforcementEnabled(): boolean {
        return this.budgetEnforcementEnabled;
    }

    /**
     * Get current memory budget status
     * 
     * @returns Object containing current usage and limits
     */
    getBudgetStatus(): {
        messageCount: number;
        maxMessages: number;
        tokenCount: number;
        maxTokens: number;
        withinBudget: boolean;
    } {
        const messageCount = this.messages.length;
        const tokenCount = this.getTotalTokenCount();

        return {
            messageCount,
            maxMessages: this.config.maxMessages,
            tokenCount,
            maxTokens: this.config.maxTokens,
            withinBudget: messageCount <= this.config.maxMessages && tokenCount <= this.config.maxTokens,
        };
    }

    /**
     * Enforce memory budget by pruning messages if limits are exceeded
     * 
     * Prunes older messages while preserving the rolling summary.
     * This is called automatically after adding messages when budget enforcement is enabled.
     * 
     * @returns Number of messages pruned
     * 
     * Requirements: S.3, 3.5
     */
    async enforceBudget(): Promise<number> {
        const status = this.getBudgetStatus();
        
        if (status.withinBudget) {
            return 0;
        }

        let prunedCount = 0;
        let currentTokens = this.getTotalTokenCount();
        let currentMessages = this.messages.length;

        // Calculate how many messages to keep based on token limit
        // We need to keep messages until we're within both limits
        const messagesToKeep: ChatMessage[] = [];
        
        // Start from most recent messages and work backwards
        for (let i = this.messages.length - 1; i >= 0; i--) {
            const message = this.messages[i];
            
            // Check if keeping this message would exceed limits
            const wouldExceedMessages = messagesToKeep.length >= this.config.maxMessages;
            const wouldExceedTokens = currentTokens > this.config.maxTokens;
            
            if (!wouldExceedMessages && !wouldExceedTokens) {
                messagesToKeep.unshift(message);
            } else {
                prunedCount++;
            }
            
            currentTokens -= message.tokenCount;
        }

        // Update internal state with pruned messages
        this.messages = messagesToKeep;

        // Regenerate summary if we pruned messages that were part of it
        if (this.summary && this.messages.length < this.config.summaryThreshold) {
            // Summary may be stale, but we keep it for context
            // It will be regenerated when more messages are added
        }

        this.lastBudgetCheck = Date.now();

        return prunedCount;
    }

    /**
     * Prune messages to fit within budget limits
     * 
     * This is the main method for memory budget enforcement.
     * It removes older messages while preserving the most recent context
     * and the rolling summary.
     * 
     * @param options - Pruning options
     * @returns Pruned messages
     * 
     * Requirements: S.3, 3.5
     */
    async pruneMessages(options?: {
        preserveSystemMessages?: boolean;
        minMessagesToKeep?: number;
    }): Promise<ChatMessage[]> {
        const { preserveSystemMessages = true, minMessagesToKeep = 0 } = options || {};
        
        // Separate system messages from others
        const systemMessages: ChatMessage[] = [];
        const nonSystemMessages: ChatMessage[] = [];
        
        for (const message of this.messages) {
            if (preserveSystemMessages && message.role === 'system') {
                systemMessages.push(message);
            } else {
                nonSystemMessages.push(message);
            }
        }

        // Calculate how many messages we can keep
        const maxNonSystemMessages = this.config.maxMessages - systemMessages.length - minMessagesToKeep;
        const messagesToKeep: ChatMessage[] = [];
        let currentTokens = 0;

        // Start from most recent and work backwards
        for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
            const message = nonSystemMessages[i];
            
            // Check if we should keep this message
            const withinMessageLimit = messagesToKeep.length < maxNonSystemMessages;
            const withinTokenLimit = currentTokens + message.tokenCount <= this.config.maxTokens;
            
            if (withinMessageLimit && withinTokenLimit) {
                messagesToKeep.unshift(message);
                currentTokens += message.tokenCount;
            }
        }

        // Combine system messages (from beginning) with kept messages
        const prunedMessages = [...systemMessages, ...messagesToKeep];
        this.messages = prunedMessages;

        return this.getMessages();
    }

    /**
     * Get the number of messages that would be pruned at current state
     * 
     * @returns Object with prune information
     */
    getPruneEstimate(): {
        messagesOverLimit: number;
        tokensOverLimit: number;
        estimatedPrunedMessages: number;
    } {
        const messageCount = this.messages.length;
        const tokenCount = this.getTotalTokenCount();

        return {
            messagesOverLimit: Math.max(0, messageCount - this.config.maxMessages),
            tokensOverLimit: Math.max(0, tokenCount - this.config.maxTokens),
            estimatedPrunedMessages: Math.max(
                Math.max(0, messageCount - this.config.maxMessages),
                this.estimateMessagesToPruneByToken()
            ),
        };
    }

    /**
     * Estimate how many messages need to be pruned to fit within token limit
     * 
     * @returns Estimated number of messages to prune
     */
    private estimateMessagesToPruneByToken(): number {
        let tokenCount = 0;
        let messagesToKeep = 0;

        // Count from most recent
        for (let i = this.messages.length - 1; i >= 0; i--) {
            if (tokenCount + this.messages[i].tokenCount <= this.config.maxTokens) {
                tokenCount += this.messages[i].tokenCount;
                messagesToKeep++;
            }
        }

        return Math.max(0, this.messages.length - messagesToKeep);
    }

    /**
     * Generate a unique message ID
     */
    private generateMessageId(): string {
        return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    /**
     * Create summary text from recent messages
     */
    private createSummaryText(messages: ChatMessage[]): string {
        if (messages.length === 0) {
            return 'No messages in conversation.';
        }

        const userMessages = messages.filter(m => m.role === 'user');
        const assistantMessages = messages.filter(m => m.role === 'assistant');

        return `Conversation with ${userMessages.length} user messages and ` +
            `${assistantMessages.length} assistant responses.`;
    }

    /**
     * Extract key topics from content
     */
    private extractTopics(content: string): string[] {
        const topics: string[] = [];
        
        // Look for code blocks as topics
        const codeBlockRegex = /```[\s\S]*?```/g;
        const codeBlocks = content.match(codeBlockRegex);
        if (codeBlocks && codeBlocks.length > 0) {
            topics.push(`${codeBlocks.length} code block(s)`);
        }

        // Look for data-related keywords
        const dataKeywords = ['data', 'dataset', 'DataFrame', 'array', 'model', 'analysis'];
        for (const keyword of dataKeywords) {
            if (content.toLowerCase().includes(keyword.toLowerCase())) {
                if (!topics.includes(keyword)) {
                    topics.push(keyword);
                }
            }
        }

        return topics.slice(0, 10); // Limit to 10 topics
    }

    /**
     * Extract decisions from content
     */
    private extractDecisions(content: string): string[] {
        const decisions: string[] = [];
        
        // Look for decision markers
        const decisionPatterns = [
            /decision[:\s]+([^\n.]+)/gi,
            /decided[:\s]+([^\n.]+)/gi,
            /chose to[:\s]+([^\n.]+)/gi,
        ];

        for (const pattern of decisionPatterns) {
            const matches = content.matchAll(pattern);
            for (const match of matches) {
                if (match[1]) {
                    decisions.push(match[1].trim());
                }
            }
        }

        return decisions.slice(0, 5); // Limit to 5 decisions
    }

    /**
     * Extract open questions from recent messages
     */
    private extractOpenQuestions(messages: ChatMessage[]): string[] {
        const questions: string[] = [];
        
        // Look for question marks in user messages
        for (const message of messages) {
            if (message.role === 'user') {
                // Split by question marks and process each question
                const parts = message.content.split('?');
                for (let i = 0; i < parts.length - 1; i++) {
                    const question = parts[i].trim() + '?';
                    if (question.length > 10 && question.length < 200) {
                        questions.push(question);
                    }
                }
            }
        }

        return questions.slice(0, 5); // Limit to 5 open questions
    }

    /**
     * Format rolling summary as markdown
     */
    private formatRollingSummary(summary: ConversationSummary): string {
        const lines = [
            '## Conversation Summary',
            '',
            summary.summary,
            '',
        ];

        if (summary.keyTopics.length > 0) {
            lines.push('### Key Topics');
            for (const topic of summary.keyTopics) {
                lines.push(`- ${topic}`);
            }
            lines.push('');
        }

        if (summary.decisions.length > 0) {
            lines.push('### Decisions Made');
            for (const decision of summary.decisions) {
                lines.push(`- ${decision}`);
            }
            lines.push('');
        }

        if (summary.openQuestions.length > 0) {
            lines.push('### Open Questions');
            for (const question of summary.openQuestions) {
                lines.push(`- ${question}`);
            }
        }

        return lines.join('\n');
    }
}