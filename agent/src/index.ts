/**
 * No-RAG Notebook Agent
 * 
 * A notebook-based AI agent that operates without traditional RAG infrastructure.
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5,
 *               4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5,
 *               7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 9.4, 9.5,
 *               10.1, 10.2, 10.3, 10.4, 10.5, C.4
 */

// Core Types
export * from './types/agent.types';

// Main Agent Class
export { NotebookAgent } from './NotebookAgent';

// State Management
export { StateManager } from './state/StateManager';
export * from './state/state.types';

// Memory Management
export { ChatMemory } from './memory/ChatMemory';
export { IntrospectionMemory } from './memory/IntrospectionMemory';

// Kernel Operations
export { KernelInterface } from './kernel/KernelInterface';
import { KernelAdapter, IKernelBridge } from './kernel/KernelAdapter';
export { KernelAdapter, IKernelBridge };

// Agent Integration
import { AgentIntegrator, createAgentIntegrator } from './AgentIntegrator';
export { AgentIntegrator, createAgentIntegrator };

// WebSocket Server
export { WebSocketServer, AgentWebSocketMessageType } from './WebSocketServer';
export type { WebSocketMessage, WebSocketServerConfig } from './WebSocketServer';

// Re-export types for convenience
export type {
    AgentState,
    UIState,
    AgentMode,
    ChatMessage,
    ConversationSummary,
    IntrospectionJSON,
    ExecutionResult,
    VariableInfo,
    Experiment,
    CellState,
} from './types/agent.types';

/**
 * Quick start function to create an agent with default configuration
 * 
 * @param notebookId - Notebook identifier
 * @param kernelBridge - Optional kernel bridge for integration
 * @returns AgentIntegrator instance
 */
export async function createAgent(
    notebookId: string,
    kernelBridge?: IKernelBridge
) {
    const agent = new AgentIntegrator({ notebookId });
    await agent.initialize(kernelBridge);
    return agent;
}