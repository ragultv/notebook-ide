import { AgentResponse, AgentMode } from '../types/agent.types';
import { StateManager } from '../state/StateManager';
import { ChatMemory } from '../memory/ChatMemory';
import { IntrospectionMemory } from '../memory/IntrospectionMemory';
import { LLMClient } from '../NotebookAgent';

/**
 * ASK Mode Handler - Direct question answering with full context, NO code execution
 * 
 * This mode provides direct responses to user questions using full introspection data.
 * Code snippets MAY be included in responses for reference, but code is NOT executed.
 */

/**
 * Handle ASK mode - Direct question answering
 * @param message - The user's message/question
 * @param stateManager - State manager for accessing notebook state
 * @param chatMemory - Chat memory for conversation context
 * @param introspectionMemory - Introspection memory for variable tracking
 * @param llmClient - LLM client for generating responses
 * @returns Promise<AgentResponse> - Text response only, NO code execution
 */
export async function handleAskMode(
  message: string,
  stateManager: StateManager,
  chatMemory: ChatMemory,
  introspectionMemory: IntrospectionMemory,
  llmClient?: LLMClient
): Promise<AgentResponse> {
  try {
    // Build context with full introspection data
    const context = await buildContext(stateManager, chatMemory, introspectionMemory);

    // Generate response using LLM with context
    const response = await generateResponse(message, context, llmClient);

    return {
      type: 'answer',
      content: response.content,
      code: response.code, // Code snippets may be included for reference
    };
  } catch (error) {
    console.error('Error in ASK mode:', error);
    return {
      type: 'answer',
      content: `Failed to process your question: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Build context for ASK mode with full introspection data
 */
async function buildContext(
  stateManager: StateManager,
  chatMemory: ChatMemory,
  introspectionMemory: IntrospectionMemory
): Promise<AskContext> {
  // Get agent state for system prompt
  const agentState = stateManager.toSystemPrompt();

  // Get chat context (recent messages + rolling summary)
  const chatContext = await chatMemory.getContextForSystemPrompt(3000);

  // Get introspection data
  const introspection = await introspectionMemory.getJSON();

  // Get UI state for rich variable information
  const uiState = stateManager.getUIState();

  return {
    agentState,
    chatContext: {
      messages: chatContext.messages.map(m => ({ role: m.role, content: m.content })),
      summary: chatContext.rollingSummary ? chatContext.rollingSummary.content : null,
    },
    introspection,
    uiState,
    timestamp: Date.now(),
  };
}

/**
 * Generate response using LLM
 */
async function generateResponse(
  message: string,
  context: AskContext,
  llmClient?: LLMClient
): Promise<{ content: string; code?: string[] }> {
  // Build system prompt with full context
  const systemPrompt = buildSystemPrompt(context);

  // If LLM client is provided, use it
  if (llmClient) {
    return await llmClient.generate(systemPrompt, message);
  }

  // Otherwise, call placeholder LLM API
  return await callLLM(systemPrompt, message);
}

/**
 * Build system prompt for ASK mode
 */
function buildSystemPrompt(context: AskContext): string {
  return `You are OPREL AI, an expert AI assistant and code generator for the OPREL IDE notebook environment.
Your goal is to help users build data science and machine learning workflows efficiently.

You are currently in **ASK MODE**.

## Current Notebook State
${context.agentState}

## Conversation Context
${context.chatContext.summary ? `### Rolling Summary
${context.chatContext.summary}` : ''}

### Recent Messages
${context.chatContext.messages.map(m => `${m.role}: ${m.content}`).join('\n')}

## Introspection Data
${JSON.stringify(context.introspection, null, 2)}

## Instructions
- Your job is to have a natural conversation, answer questions, and help the user think based on the notebook state.
- Do **NOT** output any JSON operations, do **NOT** modify notebooks, and do **NOT** include an \`\`\`operations\`\`\` block.
- Instead, explain what you would do, suggest concrete steps, and ask 1–2 short clarifying questions when the request is ambiguous.
- Prefer examples and explanations over actions.
- Provide text responses only. You MAY include code snippets in your response for reference or explanation.
- Speak directly to the user ("I suggest...", "Here is how you can do it...").

Current time: ${new Date(context.timestamp).toISOString()}`;
}

/**
 * Call LLM API (placeholder implementation)
 */
async function callLLM(
  systemPrompt: string,
  userMessage: string
): Promise<{ content: string; code?: string[] }> {
  // Placeholder - would integrate with actual LLM API (OpenAI, Anthropic, etc.)
  // For now, return a simple response

  // In a real implementation, this would:
  // 1. Call LLM API with system prompt and user message
  // 2. Parse response for text and any code snippets
  // 3. Return formatted response

  const content = `I understand you're asking about your notebook. Based on the current context, I can see:

- Variables: ${contextSummary(introspectionFromContext())}
- Recent activity: ${recentActivityFromContext()}

To provide a more helpful answer, please clarify your question or let me know what specific information you need about your notebook.

Note: In ASK mode, I provide text responses without executing code. If you'd like me to run code, please switch to AGENTIC mode.`;

  return { content };

  // Helper functions for placeholder
  function contextSummary(introspection: any): string {
    if (!introspection?.variables?.length) return 'no variables defined';
    return introspection.variables.map((v: any) => v.name).join(', ');
  }

  function recentActivityFromContext(): string {
    return 'view the activity panel for details';
  }

  function introspectionFromContext(): any {
    return {};
  }
}

/**
 * Context structure for ASK mode
 */
export interface AskContext {
  agentState: string;
  chatContext: {
    messages: Array<{ role: string; content: string }>;
    summary: string | null;
  };
  introspection: any;
  uiState: any;
  timestamp: number;
}

export default handleAskMode;