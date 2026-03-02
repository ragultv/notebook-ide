/**
 * TokenOptimizer - Context optimization for LLM token budget management
 * 
 * Responsibilities:
 * - Reserve tokens for LLM response
 * - Allocate tokens between messages and introspection data
 * - Proportional truncation when limits are exceeded
 * - Preserve recent messages and rolling summary
 */

import type {
    ChatMessage,
    IntrospectionJSON,
    ConversationSummary,
    IntrospectedVariable,
    IntrospectedExperiment,
    ActivityEntry
} from './types/agent.types';

/**
 * Configuration for token optimization
 */
export interface TokenOptimizerConfig {
    /** Maximum total tokens for context */
    maxContextTokens: number;
    /** Reserved tokens for LLM response (default: 1000) */
    reservedResponseTokens?: number;
    /** Percentage of available tokens for introspection (default: 0.3 = 30%) */
    introspectionRatio?: number;
    /** Minimum messages to preserve (default: 5) */
    minRecentMessages?: number;
    /** Overhead estimate for JSON formatting (default: 50) */
    overheadEstimate?: number;
}

/**
 * Result of context optimization
 */
export interface OptimizedContext {
    /** Optimized messages for context */
    messages: ChatMessage[];
    /** Optimized introspection data */
    introspection: IntrospectionJSON;
    /** Rolling summary text */
    summary: string;
    /** Total tokens used in optimized context */
    totalTokens: number;
    /** Tokens available for response */
    availableForResponse: number;
    /** Breakdown of token usage */
    tokenBreakdown: TokenBreakdown;
}

/**
 * Token usage breakdown
 */
export interface TokenBreakdown {
    messages: number;
    introspection: number;
    summary: number;
    overhead: number;
    response: number;
    total: number;
}

/**
 * TokenOptimizer class for managing context within token limits
 */
export class TokenOptimizer {
    private readonly config: Required<TokenOptimizerConfig>;
    private readonly reservedResponseTokens: number;
    private readonly introspectionRatio: number;
    private readonly minRecentMessages: number;
    private readonly overheadEstimate: number;

    constructor(config: TokenOptimizerConfig) {
        this.config = {
            maxContextTokens: config.maxContextTokens,
            reservedResponseTokens: config.reservedResponseTokens ?? 1000,
            introspectionRatio: config.introspectionRatio ?? 0.3,
            minRecentMessages: config.minRecentMessages ?? 5,
            overheadEstimate: config.overheadEstimate ?? 50
        };
        this.reservedResponseTokens = this.config.reservedResponseTokens;
        this.introspectionRatio = this.config.introspectionRatio;
        this.minRecentMessages = this.config.minRecentMessages;
        this.overheadEstimate = this.config.overheadEstimate;
    }

    /**
     * Optimize context for LLM by allocating tokens and truncating as needed
     * 
     * @param messages - Chat messages to include in context
     * @param introspection - Introspection JSON data
     * @param summary - Rolling summary of conversation
     * @returns Optimized context within token limits
     */
    async optimizeForContext(
        messages: ChatMessage[],
        introspection: IntrospectionJSON,
        summary: ConversationSummary
    ): Promise<OptimizedContext> {
        // Calculate available tokens for context
        const availableForContext = this.config.maxContextTokens - this.reservedResponseTokens;
        
        // Estimate token counts
        const messageTokens = this.estimateMessagesTokenCount(messages);
        const introspectionTokens = this.estimateIntrospectionTokenCount(introspection);
        const summaryTokens = this.estimateSummaryTokenCount(summary);
        
        // Calculate overhead
        const overhead = this.overheadEstimate;
        
        // Calculate total needed
        const totalNeeded = messageTokens + introspectionTokens + summaryTokens + overhead;
        
        // If within limits, return as-is
        if (totalNeeded <= availableForContext) {
            return this.buildOptimizedContext(
                messages,
                introspection,
                this.formatSummary(summary),
                messageTokens,
                introspectionTokens,
                summaryTokens,
                overhead
            );
        }
        
        // Need to truncate - calculate allocation
        const availableForContent = availableForContext - overhead - summaryTokens;
        
        // Allocate tokens proportionally between messages and introspection
        const totalContentTokens = messageTokens + introspectionTokens;
        const introspectionBudget = Math.floor(availableForContent * this.introspectionRatio);
        const messageBudget = availableForContent - introspectionBudget;
        
        // Truncate proportionally
        const truncatedMessages = this.truncateMessages(messages, messageBudget);
        const truncatedIntrospection = this.truncateIntrospection(introspection, introspectionBudget);
        
        // Recalculate actual token counts after truncation
        const truncatedMessageTokens = this.estimateMessagesTokenCount(truncatedMessages);
        const truncatedIntrospectionTokens = this.estimateIntrospectionTokenCount(truncatedIntrospection);
        
        return this.buildOptimizedContext(
            truncatedMessages,
            truncatedIntrospection,
            this.formatSummary(summary),
            truncatedMessageTokens,
            truncatedIntrospectionTokens,
            summaryTokens,
            overhead
        );
    }

    /**
     * Estimate token count for messages
     */
    estimateMessagesTokenCount(messages: ChatMessage[]): number {
        // Rough estimate: 4 characters per token on average
        let totalChars = 0;
        for (const msg of messages) {
            // Include role prefix and content
            totalChars += msg.role.length + 1; // role + colon
            totalChars += msg.content.length;
            // Add overhead for structure
            totalChars += 20;
        }
        return Math.ceil(totalChars / 4);
    }

    /**
     * Estimate token count for introspection JSON
     */
    estimateIntrospectionTokenCount(introspection: IntrospectionJSON): number {
        const jsonString = JSON.stringify(introspection);
        // JSON tends to have more tokens per character due to structure
        return Math.ceil(jsonString.length / 3.5);
    }

    /**
     * Estimate token count for summary
     */
    estimateSummaryTokenCount(summary: ConversationSummary): number {
        const formatted = this.formatSummary(summary);
        return Math.ceil(formatted.length / 4);
    }

    /**
     * Truncate messages to fit within token budget while preserving recent messages
     */
    private truncateMessages(messages: ChatMessage[], maxTokens: number): ChatMessage[] {
        if (messages.length <= this.minRecentMessages) {
            return messages;
        }

        // First, try to truncate from the beginning (older messages)
        let currentTokens = this.estimateMessagesTokenCount(messages);
        
        if (currentTokens <= maxTokens) {
            return messages;
        }

        // Binary search for optimal truncation point
        let left = 0;
        let right = messages.length - this.minRecentMessages;
        let result: ChatMessage[] = [];

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const truncated = messages.slice(mid);
            const tokens = this.estimateMessagesTokenCount(truncated);
            
            if (tokens <= maxTokens) {
                result = truncated;
                right = mid - 1;
            } else {
                left = mid + 1;
            }
        }

        // If binary search didn't find a good result, use the last valid one
        if (result.length === 0) {
            // Fallback: keep minimum recent messages
            result = messages.slice(-this.minRecentMessages);
        }

        return result;
    }

    /**
     * Truncate introspection data to fit within token budget
     */
    private truncateIntrospection(introspection: IntrospectionJSON, maxTokens: number): IntrospectionJSON {
        const currentTokens = this.estimateIntrospectionTokenCount(introspection);
        
        if (currentTokens <= maxTokens) {
            return introspection;
        }

        // Create a truncated copy
        const truncated: IntrospectionJSON = {
            version: introspection.version,
            generatedAt: introspection.generatedAt,
            notebook: {
                id: introspection.notebook.id,
                cellCount: introspection.notebook.cellCount,
                executionOrder: introspection.notebook.executionOrder.slice(-20) // Keep last 20 cells
            },
            variables: [],
            experiments: [],
            executionContext: introspection.executionContext,
            recentActivity: []
        };

        // Calculate available tokens for variables
        const baseTokens = this.estimateIntrospectionTokenCount({
            ...truncated,
            variables: [],
            experiments: [],
            recentActivity: []
        });
        const availableForVariables = Math.max(0, maxTokens - baseTokens);
        
        // Allocate tokens proportionally between variables, experiments, and activity
        const variableRatio = 0.6;
        const experimentRatio = 0.25;
        const activityRatio = 0.15;
        
        const variableBudget = Math.floor(availableForVariables * variableRatio);
        const experimentBudget = Math.floor(availableForVariables * experimentRatio);
        const activityBudget = Math.floor(availableForVariables * activityRatio);

        // Truncate variables by importance (referencedBy count, then by order)
        const sortedVariables = [...introspection.variables].sort((a, b) => {
            // Prefer variables with more references
            const aRefCount = (a.referencedBy?.length || 0);
            const bRefCount = (b.referencedBy?.length || 0);
            if (bRefCount !== aRefCount) return bRefCount - aRefCount;
            // Then by order in execution
            return 0;
        });

        let varTokens = 0;
        for (const variable of sortedVariables) {
            const varTokenCount = this.estimateVariableTokenCount(variable);
            if (varTokens + varTokenCount <= variableBudget) {
                truncated.variables.push(variable);
                varTokens += varTokenCount;
            } else {
                break;
            }
        }

        // Truncate experiments (keep most recent)
        // Sort by status (completed first) then by name to prioritize important experiments
        const sortedExperiments = [...introspection.experiments].sort((a, b) => {
            // Prioritize completed experiments
            if (a.status === 'completed' && b.status !== 'completed') return -1;
            if (a.status !== 'completed' && b.status === 'completed') return 1;
            // Then by name (alphabetical)
            return a.name.localeCompare(b.name);
        });
        
        let expTokens = 0;
        for (const experiment of sortedExperiments) {
            const expTokenCount = this.estimateExperimentTokenCount(experiment);
            if (expTokens + expTokenCount <= experimentBudget) {
                truncated.experiments.push(experiment);
                expTokens += expTokenCount;
            } else {
                break;
            }
        }

        // Truncate recent activity (keep most recent)
        const sortedActivity = [...introspection.recentActivity].sort(
            (a, b) => b.timestamp - a.timestamp
        );
        
        let actTokens = 0;
        for (const activity of sortedActivity) {
            const actTokenCount = this.estimateActivityTokenCount(activity);
            if (actTokens + actTokenCount <= activityBudget) {
                truncated.recentActivity.push(activity);
                actTokens += actTokenCount;
            } else {
                break;
            }
        }

        return truncated;
    }

    /**
     * Estimate token count for a single variable
     */
    private estimateVariableTokenCount(variable: IntrospectedVariable): number {
        const compact = {
            n: variable.name,
            t: variable.type,
            s: variable.shape,
            v: variable.valuePreview,
            r: variable.referencedBy?.length || 0
        };
        return Math.ceil(JSON.stringify(compact).length / 3.5);
    }

    /**
     * Estimate token count for a single experiment
     */
    private estimateExperimentTokenCount(experiment: IntrospectedExperiment): number {
        const compact = {
            id: experiment.id,
            n: experiment.name,
            s: experiment.status,
            m: Object.keys(experiment.metrics || {}).length
        };
        return Math.ceil(JSON.stringify(compact).length / 3.5);
    }

    /**
     * Estimate token count for a single activity entry
     */
    private estimateActivityTokenCount(activity: ActivityEntry): number {
        const compact = {
            t: activity.type,
            d: activity.description,
            c: activity.cellId
        };
        return Math.ceil(JSON.stringify(compact).length / 3.5);
    }

    /**
     * Format conversation summary for context
     */
    private formatSummary(summary: ConversationSummary): string {
        const parts: string[] = [];
        
        if (summary.summary) {
            parts.push(`## Conversation Summary\n${summary.summary}`);
        }
        
        if (summary.keyTopics.length > 0) {
            parts.push(`### Key Topics\n${summary.keyTopics.map(t => `- ${t}`).join('\n')}`);
        }
        
        if (summary.decisions.length > 0) {
            parts.push(`### Decisions Made\n${summary.decisions.map(d => `- ${d}`).join('\n')}`);
        }
        
        if (summary.openQuestions.length > 0) {
            parts.push(`### Open Questions\n${summary.openQuestions.map(q => `- ${q}`).join('\n')}`);
        }
        
        return parts.join('\n\n');
    }

    /**
     * Build the optimized context result
     */
    private buildOptimizedContext(
        messages: ChatMessage[],
        introspection: IntrospectionJSON,
        summary: string,
        messageTokens: number,
        introspectionTokens: number,
        summaryTokens: number,
        overhead: number
    ): OptimizedContext {
        const responseTokens = this.reservedResponseTokens;
        const total = messageTokens + introspectionTokens + summaryTokens + overhead;
        
        return {
            messages,
            introspection,
            summary,
            totalTokens: total,
            availableForResponse: responseTokens,
            tokenBreakdown: {
                messages: messageTokens,
                introspection: introspectionTokens,
                summary: summaryTokens,
                overhead,
                response: responseTokens,
                total: total + responseTokens
            }
        };
    }

    /**
     * Get current configuration
     */
    getConfig(): Readonly<Required<TokenOptimizerConfig>> {
        return { ...this.config };
    }

    /**
     * Calculate how many tokens would be needed for a given context
     */
    calculateRequiredTokens(
        messages: ChatMessage[],
        introspection: IntrospectionJSON,
        summary: ConversationSummary
    ): number {
        const messageTokens = this.estimateMessagesTokenCount(messages);
        const introspectionTokens = this.estimateIntrospectionTokenCount(introspection);
        const summaryTokens = this.estimateSummaryTokenCount(summary);
        const overhead = this.overheadEstimate;
        
        return messageTokens + introspectionTokens + summaryTokens + overhead + this.reservedResponseTokens;
    }
}