import { AgentResponse, AgentMode } from '../types/agent.types';
import { StateManager } from '../state/StateManager';
import { ChatMemory } from '../memory/ChatMemory';
import { IntrospectionMemory } from '../memory/IntrospectionMemory';
import { LLMClient } from '../NotebookAgent';

/**
 * AGENT Mode Handler - Cell Operations Only, NO Code Execution
 * 
 * This mode handles notebook and cell operations without executing code.
 * Supported operations:
 * - Create notebook
 * - Edit notebook (metadata, settings)
 * - Create cell
 * - Edit cell (content, metadata)
 * - Update cell (execution count, outputs)
 * - Delete cell
 * 
 * When creating/editing cells, code is NOT executed.
 */

/**
 * Handle AGENT mode - Cell operations only
 * @param message - The user's message describing the operation
 * @param stateManager - State manager for accessing notebook state
 * @param chatMemory - Chat memory for conversation context
 * @param introspectionMemory - Introspection memory for variable tracking
 * @param llmClient - LLM client for generating responses
 * @returns Promise<AgentResponse> - Confirmation of operations performed
 */
export async function handleAgentMode(
  message: string,
  stateManager: StateManager,
  chatMemory: ChatMemory,
  introspectionMemory: IntrospectionMemory,
  llmClient?: LLMClient
): Promise<AgentResponse> {
  try {
    // Parse the user's request to identify the operation
    const operation = parseOperationRequest(message);

    if (!operation) {
      return {
        type: 'answer',
        content: `I couldn't understand your request. In AGENT mode, I can help with:\n` +
          `- Creating, editing, or deleting cells\n` +
          `- Managing notebook structure\n` +
          `- Updating cell metadata\n\n` +
          `Please describe what you'd like to do with the notebook structure.`,
      };
    }

    // Execute the operation (without code execution)
    const result = await executeOperation(operation, stateManager, introspectionMemory);

    return {
      type: 'operation',
      content: result.message,
      metadata: { operations: result.operations },
    };
  } catch (error) {
    console.error('Error in AGENT mode:', error);
    return {
      type: 'answer',
      content: `Failed to perform the operation: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Build system prompt for AGENT mode (Cell operations without code execution)
 */
export function buildAgentSystemPrompt(goal: string, context: any): string {
  return `You are OPREL AI, an expert AI assistant and code generator for the OPREL IDE notebook environment.
Your goal is to help users build data science and machine learning workflows efficiently.

You are currently in **AGENT MODE**.

## User Goal
${goal}

## Context
${JSON.stringify(context, null, 2)}

## Instructions
- When the user's request is clear, you SHOULD directly create/edit/delete notebook cells via JSON operations.
- When the request is ambiguous or could be done in multiple ways, ask 1–2 short clarifying questions before acting.
- Briefly explain what you are doing in natural language so the user can follow along.
- Prefer small, safe steps over huge refactors in a single response.
- Do NOT execute code, only provide the structural changes to the notebook via operations.

**JSON OPERATIONS FORMAT (CRITICAL):**
- You act by returning a list of operations in a strict JSON format.
- Operations MUST appear in exactly one \`\`\`operations\`\`\` block as a JSON array. No other JSON elsewhere.
- Output exactly this structure. No extra fields. Only these operation types.
- **Content Escaping**: In the "content" field you MUST use literal \\n for newlines (valid JSON).
  - CORRECT: "content": "import pandas as pd\\nimport numpy as np"
  - INCORRECT: using real newlines inside the JSON string.
- Do not include the raw JSON in your free-text explanation.

**STRICT OPERATIONS SCHEMA (use only these):**
- add_cell: {"type": "add_cell", "params": {"type": "code"|"markdown", "content": "string", "notebookName": "string"}}
- edit_cell: {"type": "edit_cell", "params": {"cellIndex": number (1-based), "content": "string", "type": "code|markdown"}}
- delete_cell: {"type": "delete_cell", "params": {"cellIndex": number}}
- create_notebook: {"type": "create_notebook", "params": {"name": "string"}}
`;
}

/**
 * Parse the user's message to identify the requested operation
 */
function parseOperationRequest(message: string): OperationRequest | null {
  const lowerMessage = message.toLowerCase();

  // Create cell operations
  if (lowerMessage.includes('create cell') || lowerMessage.includes('add cell') ||
    lowerMessage.includes('new cell') || lowerMessage.includes('insert cell')) {
    const cellType = lowerMessage.includes('markdown') ? 'markdown' :
      lowerMessage.includes('code') ? 'code' : 'code';
    const position = extractPosition(message);
    const content = extractContent(message);

    return {
      type: 'create_cell',
      cellType,
      position: position ?? undefined,
      content: content ?? undefined,
    };
  }

  // Edit cell operations
  if (lowerMessage.includes('edit cell') || lowerMessage.includes('modify cell') ||
    lowerMessage.includes('change cell') || lowerMessage.includes('update cell')) {
    const cellId = extractCellId(message);
    const content = extractContent(message);

    if (!cellId) {
      return {
        type: 'edit_cell',
        cellId: 'current',
        content: content ?? undefined,
      };
    }

    return {
      type: 'edit_cell',
      cellId,
      content: content ?? undefined,
    };
  }

  // Delete cell operations
  if (lowerMessage.includes('delete cell') || lowerMessage.includes('remove cell') ||
    lowerMessage.includes('clear cell')) {
    const cellId = extractCellId(message) || 'current';

    return {
      type: 'delete_cell',
      cellId,
    };
  }

  // Move cell operations
  if (lowerMessage.includes('move cell') || lowerMessage.includes('reorder cell') ||
    lowerMessage.includes('shift cell')) {
    const cellId = extractCellId(message) || 'current';
    const newPosition = extractPosition(message);

    return {
      type: 'move_cell',
      cellId,
      newPosition,
    };
  }

  // Cell metadata operations
  if (lowerMessage.includes('cell metadata') || lowerMessage.includes('cell properties') ||
    lowerMessage.includes('cell settings')) {
    const cellId = extractCellId(message) || 'current';
    const metadata = extractMetadata(message);

    return {
      type: 'update_cell_metadata',
      cellId,
      metadata,
    };
  }

  // Notebook operations
  if (lowerMessage.includes('notebook') && (lowerMessage.includes('create') ||
    lowerMessage.includes('edit') || lowerMessage.includes('rename'))) {
    const notebookName = extractNotebookName(message);

    return {
      type: 'edit_notebook',
      notebookName,
    };
  }

  return null;
}

/**
 * Execute the parsed operation
 */
async function executeOperation(
  operation: OperationRequest,
  stateManager: StateManager,
  introspectionMemory: IntrospectionMemory
): Promise<{ message: string; operations: CellOperation[] }> {
  const operations: CellOperation[] = [];

  switch (operation.type) {
    case 'create_cell':
      const createOp = await createCell(operation, stateManager);
      operations.push(createOp);
      break;

    case 'edit_cell':
      const editOp = await editCell(operation, stateManager);
      operations.push(editOp);
      break;

    case 'delete_cell':
      const deleteOp = await deleteCell(operation, stateManager);
      operations.push(deleteOp);
      break;

    case 'move_cell':
      const moveOp = await moveCell(operation, stateManager);
      operations.push(moveOp);
      break;

    case 'update_cell_metadata':
      const metadataOp = await updateCellMetadata(operation, stateManager);
      operations.push(metadataOp);
      break;

    case 'edit_notebook':
      const notebookOp = await editNotebook(operation, stateManager);
      operations.push(notebookOp);
      break;

    default:
      throw new Error(`Unsupported operation: ${(operation as OperationRequest).type}`);
  }

  return {
    message: generateOperationSummary(operations),
    operations,
  };
}

/**
 * Create a new cell
 */
async function createCell(
  operation: OperationRequest,
  stateManager: StateManager
): Promise<CellOperation> {
  const cellId = `cell-${Date.now()}`;
  const content = operation.content || getDefaultCellContent(operation.cellType || 'code');

  // In a real implementation, this would call the notebook API
  // For now, we simulate the operation

  return {
    cellId,
    type: 'create',
    cellType: operation.cellType,
    content,
    position: operation.position,
    timestamp: Date.now(),
  };
}

/**
 * Edit an existing cell
 */
async function editCell(
  operation: OperationRequest,
  stateManager: StateManager
): Promise<CellOperation> {
  const cellId = operation.cellId || 'current';

  return {
    cellId,
    type: 'edit',
    content: operation.content,
    timestamp: Date.now(),
  };
}

/**
 * Delete a cell
 */
async function deleteCell(
  operation: OperationRequest,
  stateManager: StateManager
): Promise<CellOperation> {
  const cellId = operation.cellId;

  return {
    cellId,
    type: 'delete',
    timestamp: Date.now(),
  };
}

/**
 * Move a cell to a new position
 */
async function moveCell(
  operation: OperationRequest,
  stateManager: StateManager
): Promise<CellOperation> {
  const cellId = operation.cellId;
  const newPosition = operation.newPosition;

  return {
    cellId,
    type: 'move',
    newPosition,
    timestamp: Date.now(),
  };
}

/**
 * Update cell metadata
 */
async function updateCellMetadata(
  operation: OperationRequest,
  stateManager: StateManager
): Promise<CellOperation> {
  const cellId = operation.cellId;

  return {
    cellId,
    type: 'metadata_update',
    metadata: operation.metadata,
    timestamp: Date.now(),
  };
}

/**
 * Edit notebook properties
 */
async function editNotebook(
  operation: OperationRequest,
  stateManager: StateManager
): Promise<CellOperation> {
  return {
    type: 'notebook_edit',
    notebookName: operation.notebookName,
    timestamp: Date.now(),
  };
}

/**
 * Generate a human-readable summary of operations
 */
function generateOperationSummary(operations: CellOperation[]): string {
  if (operations.length === 0) {
    return 'No operations were performed.';
  }

  const summaries = operations.map(op => {
    switch (op.type) {
      case 'create':
        return `Created new ${op.cellType} cell${op.content ? ` with content` : ''}`;
      case 'edit':
        return `Edited cell ${op.cellId}${op.content ? ` with new content` : ''}`;
      case 'delete':
        return `Deleted cell ${op.cellId}`;
      case 'move':
        return `Moved cell ${op.cellId} to position ${op.newPosition}`;
      case 'metadata_update':
        return `Updated metadata for cell ${op.cellId}`;
      case 'notebook_edit':
        return `Updated notebook properties${op.notebookName ? ` (name: ${op.notebookName})` : ''}`;
      default:
        return `Performed ${op.type} operation`;
    }
  });

  return `Operations completed:\n${summaries.map(s => `- ${s}`).join('\n')}`;
}

/**
 * Extract cell ID from message
 */
function extractCellId(message: string): string | null {
  // Look for patterns like "cell 1", "cell-1", "cell_1", "the cell", etc.
  const cellPatterns = [
    /cell[-\s]?(\d+)/i,
    /cell[_\s]?(\d+)/i,
    /cell\s+(\w+)/i,
  ];

  for (const pattern of cellPatterns) {
    const match = message.match(pattern);
    if (match) {
      return `cell-${match[1]}`;
    }
  }

  // Check for "current cell" or "this cell"
  if (message.toLowerCase().includes('current cell') ||
    message.toLowerCase().includes('this cell')) {
    return 'current';
  }

  return null;
}

/**
 * Extract position from message
 */
function extractPosition(message: string): number | null {
  const positionPatterns = [
    /position\s*(\d+)/i,
    /at\s+(\d+)(?:st|nd|rd|th)?\s+position/i,
    /(\d+)(?:st|nd|rd|th)?\s+cell/i,
    /above/i,
    /below/i,
    /end/i,
    /beginning/i,
  ];

  for (const pattern of positionPatterns) {
    const match = message.match(pattern);
    if (match) {
      if (match[0].toLowerCase().includes('above')) return -1;
      if (match[0].toLowerCase().includes('below')) return 1;
      if (match[0].toLowerCase().includes('end')) return 999;
      if (match[0].toLowerCase().includes('beginning')) return 0;
      return parseInt(match[1], 10);
    }
  }

  return null;
}

/**
 * Extract content from message
 */
function extractContent(message: string): string | null {
  // Look for content after "with" or "containing"
  const contentMatch = message.match(/with\s+(?:the\s+)?(?:following\s+)?(?:content|cell\s+body|code|text):?[\s\n]*([\s\S]*)/i);
  if (contentMatch) {
    return contentMatch[1].trim();
  }

  // Look for code blocks
  const codeBlockMatch = message.match(/```[\w]*\n([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  return null;
}

/**
 * Extract metadata from message
 */
function extractMetadata(message: string): Record<string, any> {
  const metadata: Record<string, any> = {};

  // Look for metadata patterns
  if (message.toLowerCase().includes('collapsed')) {
    metadata.collapsed = true;
  }
  if (message.toLowerCase().includes('scrolled')) {
    metadata.scrolled = true;
  }
  if (message.toLowerCase().includes('hidden')) {
    metadata.hidden = true;
  }

  // Look for tags or labels
  const tagsMatch = message.match(/tags?[:\s]+([^\n]+)/i);
  if (tagsMatch) {
    metadata.tags = tagsMatch[1].split(',').map(t => t.trim());
  }

  return metadata;
}

/**
 * Extract notebook name from message
 */
function extractNotebookName(message: string): string | null {
  const nameMatch = message.match(/name[d]?\s+to\s+["']?([^"'\n]+)["']?/i);
  if (nameMatch) {
    return nameMatch[1].trim();
  }

  const renameMatch = message.match(/rename[d]?\s+to\s+["']?([^"'\n]+)["']?/i);
  if (renameMatch) {
    return renameMatch[1].trim();
  }

  return null;
}

/**
 * Get default cell content based on type
 */
function getDefaultCellContent(cellType: string): string {
  switch (cellType) {
    case 'markdown':
      return '# New Section\n\nAdd your markdown content here.';
    case 'code':
      return '# Your code here\n';
    default:
      return '';
  }
}

// Operation request types
export interface OperationRequest {
  type: 'create_cell' | 'edit_cell' | 'delete_cell' | 'move_cell' |
  'update_cell_metadata' | 'edit_notebook';
  cellType?: string;
  cellId?: string;
  content?: string;
  position?: number | null;
  newPosition?: number | null;
  metadata?: Record<string, any>;
  notebookName?: string | null;
}

// Cell operation result
export interface CellOperation {
  cellId?: string;
  type: 'create' | 'edit' | 'delete' | 'move' | 'metadata_update' | 'notebook_edit';
  cellType?: string;
  content?: string;
  position?: number | null;
  newPosition?: number | null;
  metadata?: Record<string, any>;
  notebookName?: string | null;
  timestamp: number;
}

export default handleAgentMode;