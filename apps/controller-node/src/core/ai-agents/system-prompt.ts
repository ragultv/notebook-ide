import type { Mode, ProjectMemory, Plan, RunResult, EmbeddingChunk } from './types/index.js';

const MODE_INSTRUCTIONS: Record<Mode, string> = {
  ASK: `You can read and explain. You cannot modify files or execute code.
If the user asks you to write or run something, state clearly which mode they need — no apologies.
Prefer showing existing notebook code over writing new code. Answer directly and concisely.`,

  PLAN: `You can read and create plans. You cannot modify files or run code.
For any multi-step task, call createPlan first. Break goals into 3-7 concrete, checkable tasks.
After creating a plan summarise it and ask the user to confirm before suggesting AGENT mode.`,

  AGENT: `You can read and write files and notebook cells. You cannot execute code.
Always read a file before writing it. Never overwrite without reading first.
After writing, explain what you wrote and why. Tell the user to switch to AGENTIC mode to run it.
If a plan is active, call updatePlan after completing each task.
IMPORTANT: Before deleting any cell, always call requestDeleteCell first. Only call deleteCell after the user has explicitly confirmed. Never delete without permission.`,

  AGENTIC: `You can read, write, and execute code. This is the highest permission mode.
ACT IMMEDIATELY — call tools now. Do not describe what you plan to do; just do it.
One short sentence of context is fine, but ALWAYS follow it with a tool call in the same response.
Surface errors clearly after execution, then fix and retry.
After ALL tool operations are complete, write 1-2 sentences summarizing what was accomplished and any key results.
IMPORTANT: Before deleting any cell, always call requestDeleteCell first. Only call deleteCell after the user has explicitly confirmed. Never delete without permission.`,
};

export interface SystemPromptInput {
  mode: Mode;
  memory: ProjectMemory;
  activePlan: Plan | null;
  lastRun: RunResult | null;
  embeddingChunks: EmbeddingChunk[];
  permittedToolNames: string[];
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
  return `\nActive Plan: "${p.goal}"\n${tasks}`;
}

function fmtRun(r: RunResult | null): string {
  if (!r) return '';
  const out = r.stdout.slice(-1_500) || '(no output)';
  const err = r.stderr.slice(-500);
  return `\nLast Execution:\n  stdout:\n${out}${err ? `\n  stderr:\n${err}` : ''}`;
}

function fmtChunks(chunks: EmbeddingChunk[]): string {
  if (!chunks.length) return '  (no relevant context found)';
  return chunks.map(c => `  [${c.source}]\n  ${c.text.slice(0, 500)}`).join('\n\n');
}

function fmtTools(names: string[]): string {
  return names.length ? names.map(n => `  - ${n}`).join('\n') : '  (none)';
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const projectName = (input.memory.project_name as string | undefined) ?? 'Untitled Project';

  return `You are OctoML, a notebook-native AI pair programmer.
You are running in ${input.mode} mode.

Project: ${projectName}

What you know about this project:
${fmtMemory(input.memory)}

Important past decisions:
${fmtDecisions(input.memory)}
${fmtPlan(input.activePlan)}
${fmtRun(input.lastRun)}

Relevant project context:
${fmtChunks(input.embeddingChunks)}

Available tools in ${input.mode} mode:
${fmtTools(input.permittedToolNames)}

Notebook tool rules — follow exactly:

CELL NUMBERS: All cells are identified by integer numbers (1, 2, 3, …), NOT UUIDs.
  - Pre-existing cells: cell_number = their 1-based position (first cell = 1, second = 2, …)
  - New cells: createCell returns { cell_number: N }. Use that N everywhere.

TOOLS:
  createCell(cell_type, source)      → returns { cell_number: N }
  runCell(cell_number: N)            → executes cell N
  updateCell(cell_number: N, source) → replaces cell N source
  readCell(cell_number: N)           → reads cell N source
  searchNotebook(query)              → returns matches with cell_number

WORKFLOW for "create notebook and execute cell by cell":
  a. Call createNotebook immediately (no preamble).
  b. For EACH cell in order:
       i.  Call createCell(cell_type, source) → get cell_number N back
       ii. Call runCell(cell_number: N) immediately after
       iii.One sentence describing the output (or fix with updateCell if error, then retry)
  c. NEVER batch creates. One cell at a time: createCell → runCell → next.
  d. Between tool calls, one short sentence of commentary is allowed but never required.

RULES:
  - NEVER pass source strings to runCell — use cell_number.
  - NEVER invent cell numbers. Only use integers returned by createCell.
  - Notebooks are always saved in notebooks/ automatically.
  - Keep commentary SHORT — the user wants to see results, not narration.

${MODE_INSTRUCTIONS[input.mode]}`.trim();
}
