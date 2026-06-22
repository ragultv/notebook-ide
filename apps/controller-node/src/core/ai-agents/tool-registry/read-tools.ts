import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';

import type { ToolEntry, ToolExecutionContext, ToolResult } from '../types/index.js';
import { EmbeddingStore } from '../embeddings/embedding-store.js';
import { OctomlStore } from '../store/octoml-store.js';

function safeRead(projectPath: string, userPath: string): string {
  const resolved = path.resolve(projectPath, userPath);
  if (!resolved.startsWith(path.resolve(projectPath))) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}

const DATA_PREVIEW_ROWS = 50;
const MAX_TEXT_BYTES    = 8_000;

async function readDataFile(filePath: string, ext: string): Promise<{ content: string; meta?: string }> {
  if (ext === '.json') {
    const raw = await fs.readFile(filePath, 'utf-8');
    try {
      const parsed = JSON.parse(raw);
      const pretty = JSON.stringify(parsed, null, 2);
      return {
        content: pretty.slice(0, MAX_TEXT_BYTES),
        meta: pretty.length > MAX_TEXT_BYTES ? `[truncated — full size ${pretty.length} chars]` : undefined,
      };
    } catch {
      return { content: raw.slice(0, MAX_TEXT_BYTES) };
    }
  }

  if (ext === '.csv') {
    const raw = await fs.readFile(filePath, 'utf-8');
    const lines = raw.split('\n');
    const preview = lines.slice(0, DATA_PREVIEW_ROWS).join('\n');
    return {
      content: preview,
      meta: `${lines.length} total rows, showing first ${Math.min(DATA_PREVIEW_ROWS, lines.length)}`,
    };
  }

  if (ext === '.xlsx' || ext === '.xls') {
    return { content: '', meta: '[Binary Excel file — use a data processing tool to read it]' };
  }

  // .py, .md, .txt, .ts, .js, etc.
  const raw = await fs.readFile(filePath, 'utf-8');
  return {
    content: raw.slice(0, MAX_TEXT_BYTES),
    meta: raw.length > MAX_TEXT_BYTES ? `[truncated — ${raw.length} chars total]` : undefined,
  };
}

export const readFileEntry: ToolEntry = {
  definition: {
    name: 'readFile',
    description: 'Read a file relative to the project root. Handles csv, json, py, xlsx, and text files. Never reads outside the project.',
    inputSchema: z.object({ path: z.string() }),
    permittedModes: ['ASK', 'PLAN', 'AGENT', 'AGENTIC'],
  },
  execute: async (input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    try {
      const userPath = input['path'] as string;
      const safePath = safeRead(ctx.project_path, userPath);
      const ext = path.extname(userPath).toLowerCase();
      const { content, meta } = await readDataFile(safePath, ext);
      return { success: true, data: { path: userPath, content, ...(meta ? { meta } : {}) } };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  },
};

export const searchNotebookEntry: ToolEntry = {
  definition: {
    name: 'searchNotebook',
    description: 'Search current notebook cells. Returns matching cells with cell_number (1-based integer) and source. Use cell_number to reference cells in other tools.',
    inputSchema: z.object({ query: z.string() }),
    permittedModes: ['ASK', 'PLAN', 'AGENT', 'AGENTIC'],
  },
  execute: async (input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const q = (input['query'] as string).toLowerCase();
    const matches = ctx.current_notebook.cells
      .map((c, i) => ({ cell_number: i + 1, type: c.type, source: c.source }))
      .filter(c => c.source.toLowerCase().includes(q));
    return { success: true, data: { matches } };
  },
};

export const loadMemoryEntry: ToolEntry = {
  definition: {
    name: 'loadMemory',
    description: 'Load all project memory facts from .octoml/memory/project.json.',
    inputSchema: z.object({}),
    permittedModes: ['ASK', 'PLAN', 'AGENT', 'AGENTIC'],
  },
  execute: async (_input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const store = new OctomlStore(ctx.project_path);
    const memory = await store.getMemory();
    return { success: true, data: memory };
  },
};

export const searchEmbeddingsEntry: ToolEntry = {
  definition: {
    name: 'searchEmbeddings',
    description: 'Vector search over embedded project files. Returns relevant text chunks.',
    inputSchema: z.object({
      query: z.string(),
      topK: z.number().int().min(1).max(20).default(5),
    }),
    permittedModes: ['ASK', 'PLAN', 'AGENT', 'AGENTIC'],
  },
  execute: async (input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    try {
      const store = new EmbeddingStore(ctx.project_path);
      const chunks = await store.search(
        input['query'] as string,
        (input['topK'] as number) ?? 5,
      );
      return { success: true, data: { chunks } };
    } catch {
      return { success: true, data: { chunks: [] } };
    }
  },
};

export const readCellEntry: ToolEntry = {
  definition: {
    name: 'readCell',
    description: 'Read a notebook cell by cell_number (1-based integer). Pre-existing cells: 1 = first cell. Cells created this turn: use the cell_number returned by createCell.',
    inputSchema: z.object({
      cell_number: z.number().int().min(1).describe('1-based cell number. Use the integer from createCell result or position for pre-existing cells.'),
    }),
    permittedModes: ['ASK', 'PLAN', 'AGENT', 'AGENTIC'],
  },
  execute: async (input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const n        = input['cell_number'] as number;
    const existing = ctx.current_notebook.cells;

    if (n <= existing.length) {
      const cell = existing[n - 1]!;
      return { success: true, data: { cell_number: n, type: cell.type, source: cell.source } };
    }

    const runtime = ctx.mutableCtx.runtimeCells.get(n);
    if (!runtime) return { success: false, error: `Cell ${n} not found` };
    return { success: true, data: { cell_number: n, type: runtime.type, source: runtime.source } };
  },
};
