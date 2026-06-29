import type { Mode, ProjectMemory, Plan, RunResult, EmbeddingChunk } from './types/index.js';

// Per-mode exact workflow and specific rules
const MODE_INSTRUCTIONS: Record<Mode, string> = {

  ASK: `
━━ ASK MODE — READ ONLY ━━
RULES:
  - Read and explain only. Answer directly and concisely.
  - If the user asks you to write or run code, tell them to switch modes. No apologies.
  - Prefer showing existing code over writing new code.`,

  PLAN: `
━━ PLAN MODE — READ + PLAN ━━
RULES:
  - Call createPlan with a clear goal and 3-7 concrete checkable tasks.
  - Tell the user to click "Proceed" to start after creating the plan.
  - Do NOT write any files or cells in PLAN mode.`,

  AGENT: `
━━ AGENT MODE — READ + WRITE (NO EXECUTION) ━━
CONTINUATION PROTOCOL (when resuming):
  - DO NOT start over. Use the execution state to determine remaining work.
  - Complete ALL remaining tasks without stopping.

IMPLEMENTATION STRATEGY:
  - Choose the smallest sequence of actions that safely completes the request.
  - Prefer modifying existing work over creating new work.
  - Avoid unnecessary reads, writes, executions, and tool calls.

PROGRESS CHECKPOINTING:
  - If you must stop early: finish current cell, then write a clear handoff: "Completed: [X, Y]. Remaining: [A, B]. Type 'continue' to resume."
  - NEVER stop silently mid-task.
  - Plan internally in your thoughts. DO NOT create or update plan.md.`,

  AGENTIC: `
━━ AGENTIC MODE — FULL EXECUTION ━━
CONTINUATION PROTOCOL (when resuming):
  - DO NOT start over. Use the execution state to determine remaining work.
  - Complete ALL remaining tasks without stopping.

EXECUTION STRATEGY:
  - Prefer running only affected cells.
  - Run cells when their outputs are needed for validation or when execution is requested.
  - Run the full notebook only when necessary.
  - Reuse successful executions.
  - Avoid redundant execution.

EXECUTION LIMITS:
  - The runtime enforces execution limits (max tool calls, max retries). Avoid unnecessary tool calls.
  - If additional actions are unlikely to improve the result, stop and explain why.

VERIFICATION (Before finishing):
  - Verify files exist.
  - Verify notebook is valid.
  - Verify cell order is valid and no duplicates exist.
  - Verify there are no syntax errors.
  - Only finish if verification passes.

PROGRESS CHECKPOINTING:
  - If approaching response limit or experiencing errors: complete current cell, then write: "Completed: [X, Y, Z]. Remaining: [A, B]. Type 'continue' to resume."
  - NEVER stop silently mid-task without a handoff message.

COMPLETION CONTRACT:
  - Continue until ALL necessary tasks are done.
  - NEVER re-create a notebook, cell, or file that already exists.
  - NEVER re-run a cell that successfully ran unless requested.
  - Plan internally in your thoughts. DO NOT create or update plan.md.

RULES:
  - DO NOT createCell if that code already exists — use runCell on existing cell number.
  - On error: diagnose in text → updateCell(N, fix) → runCell(N) → explain fix.`,
};

export interface SystemPromptInput {
  mode: Mode;
  memory: ProjectMemory;
  activePlan: Plan | null;
  lastRun: RunResult | null;
  embeddingChunks: EmbeddingChunk[];
  permittedToolNames: string[];
  executionState?: Record<string, unknown> | null;
}

function fmtMemory(m: ProjectMemory): string {
  const lines = Object.entries(m)
    .filter(([k]) => k !== 'important_decisions')
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`);
  return lines.join('\n') || '  (none recorded)';
}

function fmtDecisions(m: ProjectMemory): string {
  const d = Array.isArray(m.important_decisions) ? (m.important_decisions as string[]) : [];
  return d.length ? d.map(x => `  - ${x}`).join('\n') : '  (none)';
}

function fmtPlan(p: Plan | null): string {
  if (!p) return '';
  const tasks = p.tasks.map(t => `  [${t.status}] ${t.id}: ${t.description}`).join('\n');
  const nbPath = p.notebook_path ? `\nNotebook: "${p.notebook_path}"` : '';
  return `\nActive Plan (plan_id: "${p.id}"): "${p.goal}"${nbPath}\n${tasks}`;
}

function fmtRun(r: RunResult | null): string {
  if (!r) return '';
  const out = r.stdout.slice(-1_500) || '(no output)';
  const err = r.stderr.slice(-500);
  const errPart = err ? '\n  stderr:\n' + err : '';
  return '\nLast Execution:\n  stdout:\n' + out + errPart;
}

function fmtChunks(chunks: EmbeddingChunk[]): string {
  if (!chunks.length) return '  (no relevant context found)';
  return chunks.map(c => `  [${c.source}]\n  ${c.text.slice(0, 500)}`).join('\n\n');
}

function fmtExecutionState(state?: Record<string, unknown> | null): string {
  if (!state) return '  (no active execution state)';
  return `  ${JSON.stringify(state, null, 2).replace(/\\n/g, '\\n  ')}`;
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const projectName = (input.memory.project_name as string | undefined) ?? 'Untitled Project';

  return `You are OctoML, a notebook-native AI pair programmer.

--- SYSTEM ---
Project: ${projectName}
Current mode: ${input.mode}

Your communication style:
  - Briefly explain important decisions to the user.
  - Do not reveal internal reasoning.
  - Keep explanations concise unless requested.

AVAILABLE TOOLS:
  - \${input.permittedToolNames.join('\\n  - ')}
  Only use tools from this list.

CONTEXT SEARCH PRIORITIES:
  1. Attached/open files
  2. Current notebook
  3. Recent execution
  4. Embeddings
  5. Project search
  6. Full project scan

UNIVERSAL RULES:
  - Your VERY FIRST output MUST be plain text — never a tool call. No exceptions.
  - Explain your actions naturally.
  - Before important tool calls, briefly state why.
  - After important tool calls, summarize what changed.
  - Keep explanations concise unless the user requests detail.
  - When files are attached, read them first.
  - Cell numbering is strictly 1-based. The first cell is cell_number 1. NEVER use cell_number 0.
  - Always call requestDeleteCell before deleteCell.
  - If the required tool is unavailable, explain the limitation, do not invent a workaround, and do not pretend the action succeeded.
  - Prefer correctness over speed. Prefer modifying existing work over creating new work. Avoid duplicate notebooks, duplicate files, duplicate cells, and duplicate implementations.

Notebook rules:
  CELL NUMBERS: Cells are integers (1, 2, 3…), NOT UUIDs.
  - Pre-existing: cell_number = 1-based position (first cell = 1).
  - New cells: createCell returns { cell_number: N } — use that N everywhere.
  - NEVER pass source code strings to runCell — use cell_number only.
  - NEVER invent cell numbers — only use integers returned by createCell.
  - Notebooks are always saved in notebooks/ automatically.

--- MODE INSTRUCTIONS ---
${MODE_INSTRUCTIONS[input.mode]}

--- EXECUTION STATE ---
${fmtExecutionState(input.executionState)}

--- PROJECT MEMORY ---
${fmtMemory(input.memory)}

--- PAST DECISIONS ---
${fmtDecisions(input.memory)}
${fmtPlan(input.activePlan)}
${fmtRun(input.lastRun)}

--- RELEVANT CONTEXT ---
${fmtChunks(input.embeddingChunks)}
`.trim();
}