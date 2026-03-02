/**
 * Adapter to integrate the new no-RAG NotebookAgent with the existing controller-node.
 * This replaces the RAG-based approach with the new agent's introspection-based memory.
 *
 * The adapter:
 *  1. Maintains one NotebookAgent per session (notebookId).
 *  2. Injects an LLMClient that delegates to AIService (providers + prompts) — no RAG.
 *  3. Exposes a `processMessage` that prepends notebook/cell context to the user prompt
 *     so the agent's chat memory always sees the full picture.
 */
import { NotebookAgent, LLMClient } from 'no-rag-notebook-agent/NotebookAgent';
import type { AgentMode, AgentResponse } from 'no-rag-notebook-agent';
import { PROVIDERS, DEFAULT_PROVIDER, DEFAULT_MODEL } from './providers.js';
import { getSystemPrompt, AIMode } from './prompts.js';
import { appendMessage, getOrCreateSession } from './MemoryStore.js';
import { config } from '../../config.js';

export interface NotebookAgentAdapterConfig {
    defaultMode?: AgentMode;
    maxContextTokens?: number;
    provider?: string;
    model?: string;
}

// ---------------------------------------------------------------------------
// ControllerNodeLLMClient
// ---------------------------------------------------------------------------

/**
 * LLM Client that delegates to the controller-node's AIService using the
 * existing providers and mode-specific system prompts.
 *
 * This is the bridge between the no-RAG NotebookAgent and the real LLM.
 */
class ControllerNodeLLMClient implements LLMClient {
    private provider: string;
    private model: string;

    constructor(provider: string = DEFAULT_PROVIDER, model: string = DEFAULT_MODEL) {
        this.provider = provider;
        this.model = model;
    }

    /**
     * Detect which AI mode to use based on the system prompt the agent built.
     * The mode determines which prompt template is selected in prompts.ts.
     */
    private detectAIMode(systemPrompt: string): AIMode {
        const upper = systemPrompt.toUpperCase();
        if (upper.includes('ASK MODE')) return 'ask';
        if (upper.includes('PLAN MODE')) return 'plan';
        return 'agent';
    }

    async generate(
        systemPrompt: string,
        userMessage: string,
    ): Promise<{ content: string; code?: string[] }> {
        // Dynamic import to avoid circular dependency at import time
        const { AIService } = await import('./AIService.js');
        const aiService = new AIService();

        const aiMode = this.detectAIMode(systemPrompt);

        // Inject a synthetic session so AIService can use MemoryStore if needed.
        // We pass null so AIService creates/reuses a session for this provider+model combo.
        const response = await aiService.generate(
            userMessage,
            /* context */ undefined,
            this.provider,
            this.model,
            /* sessionId */ null,
            /* mode */ undefined,
            /* systemPromptOverride */ systemPrompt,
        );

        return {
            content: response.text,
            // Map extracted operations back to code strings so the agent can inspect them
            code: response.operations?.map((op) => JSON.stringify(op)) ?? [],
        };
    }
}

// ---------------------------------------------------------------------------
// NotebookAgentAdapter
// ---------------------------------------------------------------------------

export class NotebookAgentAdapter {
    private agents: Map<string, NotebookAgent> = new Map();
    private defaultMode: AgentMode;
    private provider: string;
    private model: string;

    constructor(adapterConfig: NotebookAgentAdapterConfig = {}) {
        this.defaultMode = adapterConfig.defaultMode ?? 'ASK';
        this.provider = adapterConfig.provider ?? DEFAULT_PROVIDER;
        this.model = adapterConfig.model ?? DEFAULT_MODEL;
    }

    // Track in-flight init promises so concurrent requests share a single init
    private pendingInits: Map<string, Promise<NotebookAgent>> = new Map();

    /**
     * Get or lazily create + initialize an agent for a given session / notebook.
     * Awaits initialize() + start() so the agent is always ready before first use.
     */
    private async getOrCreateAgent(sessionId: string): Promise<NotebookAgent> {
        // Already fully initialized
        if (this.agents.has(sessionId)) {
            return this.agents.get(sessionId)!;
        }

        // Another concurrent request is already initializing this session — share it
        if (this.pendingInits.has(sessionId)) {
            return this.pendingInits.get(sessionId)!;
        }

        const initPromise = (async () => {
            const agent = new NotebookAgent({
                notebookId: sessionId,
                mode: this.defaultMode,
                maxContextTokens: config.continuation?.maxPasses ? config.continuation.maxPasses * 1500 : 8000,
            });

            agent.setLLMClient(new ControllerNodeLLMClient(this.provider, this.model));

            await agent.initialize();
            await agent.start();

            this.agents.set(sessionId, agent);
            this.pendingInits.delete(sessionId);
            return agent;
        })();

        this.pendingInits.set(sessionId, initPromise);
        return initPromise;
    }

    /**
     * Process a user message using the no-RAG agent.
     *
     * The notebook context (name + cells) is prepended to the user prompt so the
     * agent's internal chat memory always has the full picture without any RAG retrieval.
     */
    async processMessage(
        sessionId: string,
        prompt: string,
        context?: {
            notebookName?: string;
            cells?: Array<{ type: string; content: string }>;
        },
        mode?: AgentMode,
    ): Promise<AgentResponse> {
        const agent = await this.getOrCreateAgent(sessionId);

        // Switch mode if the caller requests a different one
        if (mode && agent.getMode() !== mode) {
            await agent.setMode(mode);
        }

        // Build a context prefix so the agent sees the full notebook in its chat memory
        const contextLines: string[] = [];
        if (context?.notebookName) {
            contextLines.push(`Active notebook: "${context.notebookName}"`);
        }
        if (context?.cells && context.cells.length > 0) {
            contextLines.push('Current cells:');
            context.cells.forEach((cell, idx) => {
                const preview = cell.content.length > 400
                    ? cell.content.slice(0, 400) + '...(truncated)'
                    : cell.content;
                contextLines.push(`Cell ${idx + 1} (${cell.type}):\n${preview}`);
            });
        }

        const enrichedPrompt = contextLines.length > 0
            ? `${contextLines.join('\n')}\n\nUSER: ${prompt}`
            : prompt;

        // Delegate to the NotebookAgent — it handles mode routing, chat memory & LLM calls
        const response = await agent.processMessage(enrichedPrompt);

        // Keep MemoryStore in sync for session persistence (not for RAG)
        const actualSessionId = getOrCreateSession(sessionId, context?.notebookName);
        appendMessage(actualSessionId, 'user', prompt);
        appendMessage(actualSessionId, 'assistant', response.content);

        return response;
    }

    /**
     * Switch the agent mode for a session.
     */
    async setMode(sessionId: string, mode: AgentMode): Promise<void> {
        const agent = await this.getOrCreateAgent(sessionId);
        await agent.setMode(mode);
    }

    /**
     * Get current agent state for a session.
     */
    getAgentState(sessionId: string) {
        return this.agents.get(sessionId)?.getState() ?? { mode: this.defaultMode, isRunning: false, isInitialized: false, notebookId: sessionId };
    }

    /**
     * Clean up an agent when a session ends.
     */
    async removeAgent(sessionId: string): Promise<void> {
        const agent = this.agents.get(sessionId);
        if (agent) {
            await agent.stop();
            this.agents.delete(sessionId);
        }
    }
}

// Singleton used by AIService and AI routes
export const notebookAgentAdapter = new NotebookAgentAdapter();