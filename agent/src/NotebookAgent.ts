import { AgentMode, AgentResponse, NotebookAgentConfig, IntrospectionJSON, StreamingCallbacks, StreamingConfig } from './types/agent.types';
import { StateManager } from './state/StateManager';
import { ChatMemory } from './memory/ChatMemory';
import { IntrospectionMemory } from './memory/IntrospectionMemory';
import { KernelInterface } from './kernel/KernelInterface';
import { handleAskMode, handleAgentMode, handleAgenticMode, handlePlanMode } from './modes';

/**
 * LLM Client interface for integration with external LLM services
 */
export interface LLMClient {
  generate(systemPrompt: string, userMessage: string): Promise<{ content: string; code?: string[] }>;
  generateStream?(systemPrompt: string, userMessage: string, callbacks: StreamingCallbacks): Promise<void>;
}

/**
 * Streaming LLM Client wrapper that adds streaming to non-streaming clients
 */
export function createStreamingClient(baseClient: LLMClient, config?: StreamingConfig): LLMClient {
  const streamingConfig: StreamingConfig = {
    streamChunks: true,
    streamOperations: true,
    showThinking: true,
    chunkDelay: 20,
    operationDelay: 100,
    ...config,
  };

  return {
    generate: baseClient.generate,
    generateStream: async (systemPrompt: string, userMessage: string, callbacks: StreamingCallbacks) => {
      if (baseClient.generateStream) {
        await baseClient.generateStream(systemPrompt, userMessage, callbacks);
        return;
      }

      // Fallback: simulate streaming from non-streaming client
      if (callbacks.onThinking) callbacks.onThinking(true);

      const result = await baseClient.generate(systemPrompt, userMessage);

      if (callbacks.onThinking) callbacks.onThinking(false);

      // Stream content chunks
      if (streamingConfig.streamChunks && result.content) {
        const words = result.content.split(/(?<=\s)/);
        for (const word of words) {
          if (word && callbacks.onChunk) {
            callbacks.onChunk(word, false);
          }
          if (streamingConfig.chunkDelay) {
            await new Promise(r => setTimeout(r, streamingConfig.chunkDelay));
          }
        }
      }

      // Stream operations
      if (streamingConfig.streamOperations && result.code && result.code.length > 0) {
        for (const code of result.code) {
          try {
            const parsed = JSON.parse(code);
            if (parsed && typeof parsed.type === 'string' && parsed.params) {
              if (callbacks.onOperation) {
                callbacks.onOperation(parsed);
              }
              if (streamingConfig.operationDelay) {
                await new Promise(r => setTimeout(r, streamingConfig.operationDelay));
              }
            }
          } catch {
            // Skip malformed items
          }
        }
      }

      if (callbacks.onDone) {
        callbacks.onDone({
          type: 'answer',
          content: result.content,
          code: result.code,
        });
      }
    },
  };
}

/**
 * NotebookAgent - Main agent class that processes user messages and manages notebook interactions
 * 
 * The agent operates in four modes:
 * - ASK: Direct question answering with full context, NO code execution
 * - AGENT: Cell operations only (create/edit/update/delete cells), NO code execution
 * - AGENTIC: Full autonomous loop with code execution and error recovery
 * - PLAN: Generate high-level plans with code snippets, NO execution
 */
export class NotebookAgent {
  private config: NotebookAgentConfig;
  private kernelInterface: KernelInterface;
  private stateManager: StateManager;
  private chatMemory: ChatMemory;
  private introspectionMemory: IntrospectionMemory;
  private currentMode: AgentMode;
  private isRunning: boolean;
  private isInitialized: boolean;
  private llmClient: LLMClient | null;

  constructor(config: Partial<NotebookAgentConfig> = {}) {
    this.config = {
      notebookId: config.notebookId || 'default-notebook',
      mode: config.mode || 'ASK', // Default to ASK mode per requirement 1.5
      summaryThreshold: config.summaryThreshold || 20,
      introspectionInterval: config.introspectionInterval || 5000,
      maxContextTokens: config.maxContextTokens || 8000,
      maxSummaryLength: config.maxSummaryLength || 500,
      ...config,
    };

    this.currentMode = this.config.mode;
    this.isRunning = false;
    this.isInitialized = false;
    this.llmClient = null;

    // Initialize components
    this.kernelInterface = new KernelInterface({ notebookId: this.config.notebookId });
    this.stateManager = new StateManager(this.config.notebookId, {
      pollingInterval: this.config.introspectionInterval,
    });
    this.chatMemory = new ChatMemory({
      maxMessages: 100,
      maxTokens: this.config.maxContextTokens,
      summaryThreshold: this.config.summaryThreshold,
    });
    this.introspectionMemory = new IntrospectionMemory({
      notebookId: this.config.notebookId,
      maxExperiments: 50,
      maxActivityEntries: 100,
      refreshInterval: this.config.introspectionInterval,
    });
  }

  /**
   * Set the LLM client for generating responses
   * @param client - LLM client instance
   */
  setLLMClient(client: LLMClient): void {
    this.llmClient = client;
  }

  /**
   * Initialize the agent and its components
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.warn('NotebookAgent is already initialized');
      return;
    }

    try {
      // Connect to kernel
      await this.kernelInterface.connect(this.config.notebookId);

      // Set initial mode in state manager
      await this.stateManager.setMode(this.currentMode);

      // Subscribe to state changes for introspection updates
      this.stateManager.subscribe((changes) => {
        if (changes.agent || changes.ui) {
          this.refreshIntrospection();
        }
      });

      this.isInitialized = true;
      console.log(`NotebookAgent initialized for notebook: ${this.config.notebookId}`);
    } catch (error) {
      console.error('Failed to initialize NotebookAgent:', error);
      throw error;
    }
  }

  /**
   * Start the agent and begin processing messages
   */
  async start(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('NotebookAgent must be initialized before starting');
    }

    if (this.isRunning) {
      console.warn('NotebookAgent is already running');
      return;
    }

    this.isRunning = true;
    console.log('NotebookAgent started');
  }

  /**
   * Stop the agent and cleanup resources
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      console.warn('NotebookAgent is not running');
      return;
    }

    this.isRunning = false;
    await this.kernelInterface.disconnect();
    console.log('NotebookAgent stopped');
  }

  /**
   * Switch the agent mode
   * @param mode - The new mode to switch to
   */
  async setMode(mode: AgentMode): Promise<void> {
    if (this.currentMode === mode) {
      return; // No change needed
    }

    this.currentMode = mode;
    await this.stateManager.setMode(mode);
    console.log(`Agent mode changed to: ${mode}`);
  }

  /**
   * Get the current agent mode
   */
  getMode(): AgentMode {
    return this.currentMode;
  }

  /**
   * Main entry point for processing user messages
   * Routes to the appropriate mode handler based on current mode
   * @param userMessage - The user's message to process
   * @returns Promise<AgentResponse> - The agent's response
   */
  async processMessage(userMessage: string): Promise<AgentResponse> {
    if (!this.isRunning) {
      throw new Error('NotebookAgent is not running. Call start() first.');
    }

    // Add user message to chat memory
    await this.chatMemory.addMessage({
      role: 'user',
      content: userMessage,
    });

    // Route to appropriate mode handler
    let response: AgentResponse;

    switch (this.currentMode) {
      case 'ASK':
        response = await handleAskMode(
          userMessage,
          this.stateManager,
          this.chatMemory,
          this.introspectionMemory,
          this.llmClient || undefined
        );
        break;

      case 'AGENT':
        response = await handleAgentMode(
          userMessage,
          this.stateManager,
          this.chatMemory,
          this.introspectionMemory,
          this.llmClient || undefined
        );
        break;

      case 'AGENTIC':
        response = await handleAgenticMode(
          userMessage,
          this.stateManager,
          this.chatMemory,
          this.introspectionMemory,
          this.kernelInterface,
          this.llmClient || undefined
        );
        break;

      case 'PLAN':
        response = await handlePlanMode(
          userMessage,
          this.stateManager,
          this.chatMemory,
          this.introspectionMemory,
          this.llmClient || undefined
        );
        break;

      default:
        throw new Error(`Unknown agent mode: ${this.currentMode}`);
    }

    // Add assistant response to chat memory
    await this.chatMemory.addMessage({
      role: 'assistant',
      content: response.content,
    });

    return response;
  }

  /**
   * Get introspection data for the current notebook state
   */
  async getIntrospectionData(): Promise<IntrospectionJSON> {
    return this.introspectionMemory.getJSON();
  }

  /**
   * Refresh introspection data from the kernel
   */
  async refreshIntrospection(): Promise<void> {
    try {
      const variables = await this.kernelInterface.getVariables();
      const history = await this.kernelInterface.getExecutionHistory();
      await this.introspectionMemory.refresh(
        variables,
        history.map(h => h.cellId),
        history.length
      );

      // Update state manager with new variables
      for (const variable of variables) {
        await this.stateManager.addVariable(variable, 'introspection');
      }
    } catch (error) {
      console.error('Failed to refresh introspection:', error);
    }
  }

  /**
   * Get the current state of the agent
   */
  getState(): {
    mode: AgentMode;
    isRunning: boolean;
    isInitialized: boolean;
    notebookId: string;
  } {
    return {
      mode: this.currentMode,
      isRunning: this.isRunning,
      isInitialized: this.isInitialized,
      notebookId: this.config.notebookId,
    };
  }

  /**
   * Get references to internal components (for testing and advanced use cases)
   */
  getComponents(): {
    kernelInterface: KernelInterface;
    stateManager: StateManager;
    chatMemory: ChatMemory;
    introspectionMemory: IntrospectionMemory;
  } {
    return {
      kernelInterface: this.kernelInterface,
      stateManager: this.stateManager,
      chatMemory: this.chatMemory,
      introspectionMemory: this.introspectionMemory,
    };
  }

  /**
   * Process message with streaming support
   * @param userMessage - The user's message to process
   * @param callbacks - Streaming callbacks for real-time updates
   * @param config - Streaming configuration
   */
  async processMessageStream(
    userMessage: string,
    callbacks: StreamingCallbacks,
    config?: StreamingConfig
  ): Promise<void> {
    if (!this.isRunning) {
      callbacks.onError?.('NotebookAgent is not running. Call start() first.');
      return;
    }

    // Add user message to chat memory
    await this.chatMemory.addMessage({
      role: 'user',
      content: userMessage,
    });

    // Notify thinking started
    callbacks.onThinking?.(true);

    try {
      let response: AgentResponse;

      switch (this.currentMode) {
        case 'ASK':
          response = await handleAskMode(
            userMessage,
            this.stateManager,
            this.chatMemory,
            this.introspectionMemory,
            this.llmClient || undefined
          );
          break;

        case 'AGENT':
          response = await handleAgentMode(
            userMessage,
            this.stateManager,
            this.chatMemory,
            this.introspectionMemory,
            this.llmClient || undefined
          );
          break;

        case 'AGENTIC':
          response = await handleAgenticMode(
            userMessage,
            this.stateManager,
            this.chatMemory,
            this.introspectionMemory,
            this.kernelInterface,
            this.llmClient || undefined
          );
          break;

        case 'PLAN':
          response = await handlePlanMode(
            userMessage,
            this.stateManager,
            this.chatMemory,
            this.introspectionMemory,
            this.llmClient || undefined
          );
          break;

        default:
          throw new Error(`Unknown agent mode: ${this.currentMode}`);
      }

      callbacks.onThinking?.(false);

      // Stream operations if present
      const operations = (response.metadata as any)?.operations ?? [];
      if (operations.length > 0 && this.currentMode === 'PLAN') {
        callbacks.onPlanReady?.(operations);
      }

      // Add assistant response to chat memory
      await this.chatMemory.addMessage({
        role: 'assistant',
        content: response.content,
      });

      callbacks.onDone?.(response);

    } catch (error) {
      callbacks.onThinking?.(false);
      callbacks.onError?.(error instanceof Error ? error.message : 'Unknown error');
    }
  }
}

export default NotebookAgent;