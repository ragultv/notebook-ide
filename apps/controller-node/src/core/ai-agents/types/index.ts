import type { ZodTypeAny } from 'zod';

export type Mode = 'ASK' | 'PLAN' | 'AGENT' | 'AGENTIC';

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'failed';

export interface Task {
  id: string;
  description: string;
  status: TaskStatus;
}

export interface Plan {
  id: string;
  goal: string;
  notebook_path?: string;
  tasks: Task[];
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface NotebookCell {
  id: string;
  type: 'code' | 'markdown';
  source: string;
}

export interface ProjectMemory {
  project_name?: string;
  main_dataset?: string;
  target_column?: string;
  preferred_model?: string;
  important_decisions?: string[];
  [key: string]: unknown;
}

export interface OctomlState {
  mode: Mode;
  session_id: string;
  active_plan_id: string | null;
  last_run_id: string | null;
  active_provider?: string;
  active_model_id?: string;
}

export interface LogEntry {
  timestamp: string;
  mode: Mode;
  tool: string;
  input_hash: string;
  result_summary: string;
}

export interface KernelOutputEvent {
  stream: 'stdout' | 'stderr';
  text: string;
}

export interface Output {
  mime_type: string;
  data: string;
}

export interface KernelExecuteResult {
  success: boolean;
  outputs: Output[];
  error?: { ename: string; evalue: string };
}

export interface RunResult {
  id: string;
  prompt: ChatMessage[];
  executed_cells: Array<{ cell_id: string; source: string; outputs: Output[] }>;
  stdout: string;
  stderr: string;
  created_at: string;
}

export interface ContextMeta {
  included: string[];
  dropped: string[];
  token_estimate: number;
}

export interface EmbeddingChunk {
  source: string;
  text: string;
  score: number;
}

// ── Agent Events (discriminated union streamed to client) ─────────────────────

export type AgentEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call_start'; tool: string; input: unknown }
  | { type: 'tool_call_result'; tool: string; result: unknown }
  | { type: 'kernel_output'; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'cell_update'; cell_id: string; source: string }
  | { type: 'cell_create'; after_cell_id: string | null; cell_type: 'code' | 'markdown'; source: string; new_cell_id?: string }
  | { type: 'cell_delete'; cell_id: string }
  | { type: 'escalation'; suggest_mode: Mode; reason: string }
  | { type: 'permission_request'; action: string; payload: unknown }
  | { type: 'notebook_create'; path: string }
  | { type: 'plan_created'; plan_id: string; plan_path: string; goal: string; tasks: Array<{ id: string; description: string; status: string }> }
  | { type: 'cell_run_start'; cell_id: string }
  | { type: 'cell_run_complete'; cell_id: string; success: boolean }
  | { type: 'done' };

// ── Request / Context types ───────────────────────────────────────────────────

export interface AgentRequest {
  messages:         ChatMessage[];
  mode:             Mode;
  project_path:     string;
  current_notebook: { cells: NotebookCell[]; path?: string };
  session_id:       string;
}

export type EmitFn = (event: AgentEvent) => void;

export interface RuntimeCell {
  id:     string;
  source: string;
  type:   string;
}

export interface MutableToolCtx {
  notebookPath:  string | null;
  cellCounter:   number;
  runtimeCells:  Map<number, RuntimeCell>;
}

export interface ToolExecutionContext {
  project_path:     string;
  current_notebook: { cells: NotebookCell[]; path?: string };
  session_id:       string;
  mode:             Mode;
  run_id:           string;
  emit:             EmitFn;
  mutableCtx:       MutableToolCtx;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  permittedModes: Mode[];
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export type ToolExecuteFn = (
  input: Record<string, unknown>,
  ctx: ToolExecutionContext,
) => Promise<ToolResult>;

export interface ToolEntry {
  definition: ToolDefinition;
  execute: ToolExecuteFn;
}
