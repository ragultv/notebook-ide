/**
 * Agent Integrator - Connects agent components to the existing apps infrastructure
 * 
 * This module provides integration between the agent components (StateManager,
 * ChatMemory, IntrospectionMemory, KernelInterface) and the existing controller-node
 * and desktop-ui applications.
 * 
 * Requirements: C.4, 5.3, 10.1, 10.2, 10.3
 */

import { EventEmitter } from 'events';
import {
    AgentState,
    UIState,
    ChatMessage,
    IntrospectionJSON,
    ExecutionResult,
    VariableInfo,
    AgentMode,
    KernelInterfaceConfig,
    AgentResponse,
} from './types/agent.types';

import { StateManager } from './state/StateManager';
import { ChatMemory } from './memory/ChatMemory';
import { IntrospectionMemory, IntrospectionMemoryConfig } from './memory/IntrospectionMemory';
import { KernelInterface } from './kernel/KernelInterface';
import { KernelAdapter, IKernelBridge } from './kernel/KernelAdapter';
import { ChatMemoryConfig } from './types/agent.types';
/**
 * Integration configuration
 */
export interface AgentIntegratorConfig {
    /** Notebook ID */
    notebookId: string;
    /** Initial agent mode */
    mode?: AgentMode;
    /** Maximum context tokens */
    maxContextTokens?: number;
    /** Summary threshold */
    summaryThreshold?: number;
    /** Polling interval */
    pollingInterval?: number;
    /** Maximum experiments */
    maxExperiments?: number;
    /** Maximum activity entries */
    maxActivityEntries?: number;
}

/**
 * WebSocket message types for integration
 */
export type WSMessageType =
    | 'execute'
    | 'interrupt'
    | 'restart'
    | 'get_variables'
    | 'mode_change'
    | 'message'
    | 'state_request'
    | 'introspection_request';

/**
 * WebSocket message interface
 */
export interface WSMessage {
    type: WSMessageType;
    notebookId: string;
    payload?: Record<string, unknown>;
}

/**
 * Agent Integrator - Main integration point for agent components
 * 
 * This class coordinates all agent components and provides integration
 * with the existing apps infrastructure via WebSocket and events.
 */
export class AgentIntegrator extends EventEmitter {
    private config: Required<AgentIntegratorConfig>;
    private stateManager: StateManager;
    private chatMemory: ChatMemory;
    private introspectionMemory: IntrospectionMemory;
    private kernelInterface: KernelInterface;
    private kernelAdapter: KernelAdapter | null = null;
    private isInitialized = false;
    private isRunning = false;

    /**
     * Create a new AgentIntegrator
     * 
     * @param config - Integration configuration
     */
    constructor(config: AgentIntegratorConfig) {
        super();

        this.config = {
            notebookId: config.notebookId,
            mode: config.mode || 'ASK',
            maxContextTokens: config.maxContextTokens || 8192,
            summaryThreshold: config.summaryThreshold || 20,
            pollingInterval: config.pollingInterval || 500,
            maxExperiments: config.maxExperiments || 10,
            maxActivityEntries: config.maxActivityEntries || 100,
        };

        // Initialize StateManager
        this.stateManager = new StateManager(this.config.notebookId, {
            pollingInterval: this.config.pollingInterval,
            maxRecentErrors: 10,
            maxExperiments: this.config.maxExperiments,
        });

        // Initialize ChatMemory
        const chatConfig: ChatMemoryConfig = {
            maxMessages: 100,
            maxTokens: Math.floor(this.config.maxContextTokens * 0.5),
            summaryThreshold: this.config.summaryThreshold,
        };
        this.chatMemory = new ChatMemory(chatConfig);

        // Initialize IntrospectionMemory
        const introspectionConfig: IntrospectionMemoryConfig = {
            notebookId: this.config.notebookId,
            maxExperiments: this.config.maxExperiments,
            maxActivityEntries: this.config.maxActivityEntries,
            refreshInterval: this.config.pollingInterval,
        };
        this.introspectionMemory = new IntrospectionMemory(introspectionConfig);

        // Initialize KernelInterface
        const kernelConfig: KernelInterfaceConfig = {
            notebookId: this.config.notebookId,
            executionTimeout: 30000,
            maxRetries: 3,
        };
        this.kernelInterface = new KernelInterface(kernelConfig);

        // Set up state subscriptions
        this.setupStateSubscriptions();
    }

    /**
     * Initialize the agent integrator
     * 
     * @param kernelBridge - Optional kernel bridge for integration
     */
    async initialize(kernelBridge?: IKernelBridge): Promise<void> {
        if (this.isInitialized) return;

        // Connect to kernel if bridge provided
        if (kernelBridge) {
            this.kernelAdapter = new KernelAdapter(kernelBridge, {
                notebookId: this.config.notebookId,
            });
            await this.kernelAdapter.connect();
        } else {
            await this.kernelInterface.connect();
        }

        // Initialize state
        await this.stateManager.updateAgentState({
            v: '1.0',
            ts: Date.now(),
            nb: this.config.notebookId,
            m: this.config.mode,
            vars: [],
            exec: [],
            exps: [],
            errs: [],
            active: [],
        });

        this.isInitialized = true;
        this.emit('initialized');
    }

    /**
     * Start the agent integrator
     */
    async start(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }
        if (this.isRunning) return;

        this.isRunning = true;
        this.stateManager.startPolling();
        this.emit('started');
    }

    /**
     * Stop the agent integrator
     */
    async stop(): Promise<void> {
        if (!this.isRunning) return;

        this.isRunning = false;
        this.stateManager.stopPolling();
        await this.kernelInterface.disconnect();
        this.emit('stopped');
    }

    /**
     * Set the agent mode
     * 
     * @param mode - New agent mode
     */
    async setMode(mode: AgentMode): Promise<void> {
        await this.stateManager.updateAgentState({ m: mode });
        this.emit('mode_changed', mode);
    }

    /**
     * Get current agent mode
     * 
     * @returns Current agent mode
     */
    getMode(): AgentMode {
        return this.stateManager.getAgentState().m;
    }

    /**
     * Process a user message
     * 
     * @param message - User message
     * @returns Agent response
     */
    async processMessage(message: string): Promise<AgentResponse> {
        // Add user message to chat memory
        const chatMessage: ChatMessage = {
            id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            role: 'user',
            content: message,
            timestamp: Date.now(),
            tokenCount: this.chatMemory.estimateTokenCount(message),
        };
        await this.chatMemory.addMessage(chatMessage);

        // Get current context
        const context = await this.chatMemory.getContext();
        const introspection = await this.introspectionMemory.getJSON();
        const agentState = this.stateManager.getAgentState();

        // Build system prompt with context
        const systemPrompt = this.buildSystemPrompt(agentState, introspection);

        // TODO: Call LLM with context (integration point for AI service)
        // For now, return a placeholder response
        const response: AgentResponse = {
            type: 'answer',
            content: `I received your message: "${message}". This is a placeholder response from the agent.`,
        };

        // Add assistant message to chat memory
        const assistantMessage: ChatMessage = {
            id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            role: 'assistant',
            content: response.content,
            timestamp: Date.now(),
            tokenCount: this.chatMemory.estimateTokenCount(response.content),
        };
        await this.chatMemory.addMessage(assistantMessage);

        return response;
    }

    /**
     * Execute code in the kernel
     * 
     * @param code - Code to execute
     * @param options - Execution options
     * @returns Execution result
     */
    async executeCode(code: string, options?: { timeout?: number }): Promise<ExecutionResult> {
        return this.kernelInterface.execute(code, {
            timeout: options?.timeout,
            captureVariables: true,
            captureHistory: true,
        });
    }

    /**
     * Get current introspection data
     * 
     * @returns Introspection JSON
     */
    async getIntrospection(): Promise<IntrospectionJSON> {
        const variables = await this.kernelInterface.getVariables();
        const history = await this.kernelInterface.getExecutionHistory();

        await this.introspectionMemory.refresh(
            variables,
            history.map(h => h.cellId),
            history.length
        );

        return this.introspectionMemory.getJSON();
    }

    /**
     * Get current agent state
     * 
     * @returns Agent state
     */
    getAgentState(): AgentState {
        return this.stateManager.getAgentState();
    }

    /**
     * Get current UI state
     * 
     * @returns UI state
     */
    getUIState(): UIState {
        return this.stateManager.getUIState();
    }

    /**
     * Get chat context
     * 
     * @returns Chat messages
     */
    async getChatContext(): Promise<ChatMessage[]> {
        const context = await this.chatMemory.getContext();
        return context.messages;
    }

    /**
     * Get rolling summary
     * 
     * @returns Rolling summary
     */
    async getRollingSummary(): Promise<string | null> {
        const summary = await this.chatMemory.getRollingSummary();
        return summary ? summary.content : null;
    }

    /**
     * Start an experiment
     * 
     * @param name - Experiment name
     * @param description - Experiment description
     * @param cellIds - Associated cell IDs
     * @returns Experiment ID
     */
    async startExperiment(
        name: string,
        description: string,
        cellIds: string[]
    ): Promise<string> {
        return this.introspectionMemory.startExperiment(name, description, cellIds);
    }

    /**
     * End an experiment
     * 
     * @param experimentId - Experiment ID
     * @param status - Final status
     */
    async endExperiment(
        experimentId: string,
        status: 'completed' | 'failed'
    ): Promise<void> {
        await this.introspectionMemory.endExperiment(experimentId, status);
    }

    /**
     * Log a metric
     * 
     * @param experimentId - Experiment ID
     * @param key - Metric key
     * @param value - Metric value
     */
    async logMetric(
        experimentId: string,
        key: string,
        value: number
    ): Promise<void> {
        await this.introspectionMemory.logMetric(experimentId, key, value);
    }

    /**
     * Get all experiments
     * 
     * @returns Array of experiments
     */
    getExperiments() {
        return this.introspectionMemory.getExperiments();
    }

    /**
     * Get all variables
     * 
     * @returns Array of variables
     */
    async getVariables(): Promise<VariableInfo[]> {
        return this.kernelInterface.getVariables();
    }

    /**
     * Interrupt kernel execution
     */
    async interrupt(): Promise<void> {
        await this.kernelInterface.interrupt();
    }

    /**
     * Restart kernel
     */
    async restart(): Promise<void> {
        await this.kernelInterface.restart();
    }

    /**
     * Subscribe to state changes
     * 
     * @param callback - Callback function
     */
    subscribe(callback: (state: { agent?: AgentState; ui?: UIState }) => void): () => void {
        return this.stateManager.subscribe(callback);
    }

    /**
     * Handle WebSocket message
     * 
     * @param message - WebSocket message
     * @returns Response if applicable
     */
    async handleWSMessage(message: WSMessage): Promise<any> {
        switch (message.type) {
            case 'execute':
                return this.executeCode(message.payload?.code as string);

            case 'interrupt':
                await this.interrupt();
                return { success: true };

            case 'restart':
                await this.restart();
                return { success: true };

            case 'get_variables':
                return this.getVariables();

            case 'mode_change':
                await this.setMode(message.payload?.mode as AgentMode);
                return { success: true, mode: this.getMode() };

            case 'message':
                return this.processMessage(message.payload?.text as string);

            case 'state_request':
                return {
                    agent: this.getAgentState(),
                    ui: this.getUIState(),
                };

            case 'introspection_request':
                return this.getIntrospection();

            default:
                return { error: `Unknown message type: ${message.type}` };
        }
    }

    /**
     * Set up state subscriptions
     */
    private setupStateSubscriptions(): void {
        // Subscribe to state changes and update introspection
        this.stateManager.subscribe(async ({ agent, ui }) => {
            if (!agent || !ui) return;

            // Update execution context
            this.introspectionMemory.updateExecutionContext({
                kernelStatus: ui.kernelStatus,
                executionCount: ui.executionHistory.length,
            });

            // Log activity for mode changes
            if (agent.m !== this.config.mode) {
                this.introspectionMemory.logActivity(
                    'chat',
                    `Mode changed to ${agent.m}`
                );
                this.config.mode = agent.m;
            }
        });
    }

    /**
     * Build system prompt with context
     * 
     * @param agentState - Current agent state
     * @param introspection - Current introspection data
     * @returns Formatted system prompt
     */
    private buildSystemPrompt(agentState: AgentState, introspection: IntrospectionJSON): string {
        const stateJson = JSON.stringify({
            v: agentState.v,
            ts: agentState.ts,
            nb: agentState.nb,
            m: agentState.m,
            vars: agentState.vars,
            exec: agentState.exec,
            exps: agentState.exps,
            errs: agentState.errs,
            active: agentState.active,
        });

        const introspectionJson = JSON.stringify(introspection);

        return `You are a notebook AI assistant. You have access to the notebook state and can execute code.

## Current Notebook State
${stateJson}

## Introspection Data
${introspectionJson}

## Guidelines
- Use the notebook state to understand the current context
- Execute code when needed to help the user
- Track experiments and their metrics
- Provide helpful responses based on the notebook state

Current time: ${new Date().toISOString()}`;
    }
}

/**
 * Create an agent integrator from existing app services
 * 
 * @param kernelManager - KernelManager from controller-node
 * @param config - Integration configuration
 * @returns AgentIntegrator instance
 */
export function createAgentIntegrator(
    kernelManager: any,
    config: AgentIntegratorConfig
): AgentIntegrator {
    const integrator = new AgentIntegrator(config);

    // Connect to kernel via adapter
    integrator.initialize(kernelManager).catch(console.error);

    return integrator;
}