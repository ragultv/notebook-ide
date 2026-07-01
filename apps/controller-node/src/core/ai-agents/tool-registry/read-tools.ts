import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';

import type { ToolEntry, ToolExecutionContext, ToolResult } from '../types/index.js';
import { EmbeddingStore } from '../embeddings/embedding-store.js';
import { OctomlStore } from '../store/octoml-store.js';
import { getKernelBridge } from './exec-tools.js';

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
  if (ext === '.ipynb') {
    const raw = await fs.readFile(filePath, 'utf-8');
    try {
      const parsed = JSON.parse(raw);
      // Strip outputs from cells so agent only sees the source code
      if (Array.isArray(parsed.cells)) {
        parsed.cells = parsed.cells.map((cell: any) => ({
          cell_type: cell.cell_type,
          source: cell.source,
        }));
      }
      const pretty = JSON.stringify(parsed, null, 2);
      return {
        content: pretty.slice(0, MAX_TEXT_BYTES),
        meta: `Notebook with ${parsed.cells?.length || 0} cells${pretty.length > MAX_TEXT_BYTES ? ` [truncated to ${MAX_TEXT_BYTES} chars]` : ''}`,
      };
    } catch {
      return { content: raw.slice(0, MAX_TEXT_BYTES) };
    }
  }

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

const INDEX_IGNORE = new Set([
  'node_modules', '.git', '.octoml', '__pycache__', '.venv', 'venv', 'dist', 'build', '.next', '.cache',
]);

async function buildProjectIndex(
  projectPath: string,
  dir: string,
  prefix = '',
  depth = 0,
): Promise<Array<{ path: string; type: 'file' | 'dir'; size?: number }>> {
  if (depth > 6) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const result: Array<{ path: string; type: 'file' | 'dir'; size?: number }> = [];

  for (const ent of entries) {
    if (ent.name.startsWith('.') || INDEX_IGNORE.has(ent.name)) continue;
    const rel = prefix ? `${prefix}/${ent.name}` : ent.name;

    if (ent.isDirectory()) {
      result.push({ path: rel, type: 'dir' });
      const children = await buildProjectIndex(projectPath, path.join(dir, ent.name), rel, depth + 1);
      result.push(...children);
    } else {
      try {
        const stat = await fs.stat(path.join(dir, ent.name));
        result.push({ path: rel, type: 'file', size: stat.size });
      } catch {
        result.push({ path: rel, type: 'file' });
      }
    }
  }
  return result;
}

export const listProjectEntry: ToolEntry = {
  definition: {
    name: 'listProject',
    description: [
      'Read the project file index (octoml.json at project root).',
      'Always call this FIRST before reading individual files — never scan directories blindly.',
      'Returns all files and folders. Incremental reads: pick only the specific files you need from the result.',
    ].join(' '),
    inputSchema: z.object({}),
    permittedModes: ['ASK', 'PLAN', 'AGENT', 'AGENTIC'],
  },
  execute: async (_input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const indexPath = path.join(ctx.project_path, 'octoml.json');
    try {
      // Return cached index if fresh (< 60 s)
      const raw  = await fs.readFile(indexPath, 'utf-8');
      const data = JSON.parse(raw) as { generated_at: string; files: unknown[] };
      const age  = Date.now() - new Date(data.generated_at).getTime();
      if (age < 60_000) return { success: true, data };
    } catch { /* not cached yet */ }

    // Generate fresh index
    const files = await buildProjectIndex(ctx.project_path, ctx.project_path);
    const index = { generated_at: new Date().toISOString(), file_count: files.length, files };
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8').catch(() => undefined);
    return { success: true, data: index };
  },
};

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

      if (ext === '.ipynb') {
        ctx.mutableCtx.notebookPath = userPath;
        const bridge = getKernelBridge();
        if (bridge) {
          await bridge.updateBroadcastId(safePath);
        }

        // Pre-populate runtimeCells from the notebook so runCell works immediately
        // in this same turn — no second turn required.
        if (ctx.current_notebook.cells.length === 0) {
          try {
            const rawNb = await fs.readFile(safePath, 'utf-8');
            const nb = JSON.parse(rawNb) as { cells: Array<{ id?: string; cell_type: string; source: string | string[] }> };
            if (Array.isArray(nb.cells)) {
              ctx.mutableCtx.cellCounter = nb.cells.length;
              nb.cells.forEach((cell, i) => {
                const cellNum = i + 1;
                const src = Array.isArray(cell.source) ? cell.source.join('') : (cell.source ?? '');
                ctx.mutableCtx.runtimeCells.set(cellNum, {
                  id:   cell.id ?? `cell-${cellNum}`,
                  source: src,
                  type: cell.cell_type as 'code' | 'markdown',
                });
              });
            }
          } catch { /* ignore — runCell will fall back to current_notebook.cells */ }
        }

        const loaded = ctx.mutableCtx.runtimeCells.size || ctx.current_notebook.cells.length;
        return {
          success: true,
          data: {
            content,
            meta,
            cells_loaded: loaded,
            _INSTRUCTION: loaded > 0
              ? `${loaded} cells are now ready. You may call runCell(1) through runCell(${loaded}) directly in this same turn.`
              : 'Notebook opened. No cells found — you may add cells with createCell.',
          }
        };
      }

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
      topK: z.number().int().describe('Number of chunks to return (e.g. 5)'),
    }),
    permittedModes: ['ASK', 'PLAN', 'AGENT', 'AGENTIC'],
  },
  execute: async (input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    try {
      const store = new EmbeddingStore(ctx.project_path);
      let topK = input['topK'] as number;
      if (!topK || topK < 1) topK = 5;
      const chunks = await store.search(input['query'] as string, topK);
      return { success: true, data: { chunks } };
    } catch {
      return { success: true, data: { chunks: [] } };
    }
  },
};

export const readCellEntry: ToolEntry = {
  definition: {
    name: 'readCell',
    description: 'DO NOT use this tool if the cell content is already attached in your prompt. Use this ONLY to fetch a cell by its ID or number if you do NOT have its content.',
    inputSchema: z.object({
      target: z.string().describe('The cell number (e.g. "1") or cell ID string.'),
    }),
    permittedModes: ['ASK', 'PLAN', 'AGENT', 'AGENTIC'],
  },
  execute: async (input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    let target = input['target'] as string;
    target = target.trim();

    const existing = ctx.current_notebook.cells;
    const isNumber = /^\d+$/.test(target);

    if (!isNumber) {
      // It's a cell ID (potentially with filename cruft)
      let cid = target.replace(/\.(py|md)$/i, '');
      const parts = cid.split('.');
      cid = parts[parts.length - 1];

      const cell = existing.find(c => c.id === cid);
      if (cell) {
        const idx = existing.indexOf(cell) + 1;
        return { success: true, data: { cell_number: idx, cell_id: cid, type: cell.type, source: cell.source } };
      }
      for (const [key, runtimeCell] of ctx.mutableCtx.runtimeCells.entries()) {
        if (runtimeCell.id === cid) {
          return { success: true, data: { cell_number: key, cell_id: cid, type: runtimeCell.type, source: runtimeCell.source } };
        }
      }
      return { success: false, error: `Cell with id ${cid} not found` };
    } else {
      // It's a cell number
      const n = parseInt(target, 10);
      if (n <= existing.length) {
        const cell = existing[n - 1]!;
        return { success: true, data: { cell_number: n, cell_id: cell.id, type: cell.type, source: cell.source } };
      }

      const runtime = ctx.mutableCtx.runtimeCells.get(n);
      if (!runtime) return { success: false, error: `Cell ${n} not found` };
      return { success: true, data: { cell_number: n, cell_id: runtime.id, type: runtime.type, source: runtime.source } };
    }
  },
};

export const countNotebookCellsEntry: ToolEntry = {
  definition: {
    name: 'countNotebookCells',
    description: 'Get the number of cells in the currently opened notebook.',
    inputSchema: z.object({}),
    permittedModes: ['ASK', 'PLAN', 'AGENT', 'AGENTIC'],
  },
  execute: async (_input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    return { success: true, data: { cell_count: ctx.current_notebook.cells.length } };
  },
};
