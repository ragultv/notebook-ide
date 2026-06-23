import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import type { ToolEntry, ToolExecutionContext, ToolResult } from '../types/index.js';
import { OctomlStore } from '../store/octoml-store.js';

function safeWrite(projectPath: string, userPath: string): string {
  const root     = path.resolve(projectPath);
  const octoml   = path.join(root, '.octoml');
  const resolved = path.resolve(root, userPath);
  if (!resolved.startsWith(root))    throw new Error('Path traversal detected');
  if (resolved.startsWith(octoml))   throw new Error('Cannot write inside .octoml/');
  return resolved;
}

export const writeFileEntry: ToolEntry = {
  definition: {
    name: 'writeFile',
    description: 'Write content to a file relative to the project root. Never writes to .octoml/.',
    inputSchema: z.object({ path: z.string(), content: z.string() }),
    permittedModes: ['AGENT', 'AGENTIC'],
  },
  execute: async (input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    try {
      const safePath = safeWrite(ctx.project_path, input['path'] as string);
      await fs.mkdir(path.dirname(safePath), { recursive: true });
      await fs.writeFile(safePath, input['content'] as string, 'utf-8');
      return { success: true, data: { path: input['path'], bytes: (input['content'] as string).length } };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  },
};

export const createCellEntry: ToolEntry = {
  definition: {
    name: 'createCell',
    description: [
      'Append a new cell to the end of the active notebook.',
      'Returns { cell_number } — an integer (1, 2, 3, …).',
      'Immediately after this call, call runCell(cell_number: N) with the returned integer.',
    ].join(' '),
    inputSchema: z.object({
      cell_type: z.string().describe('Must be exactly "code" or "markdown"'),
      source:    z.string(),
    }),
    permittedModes: ['AGENT', 'AGENTIC'],
  },
  execute: async (input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const cellType  = input['cell_type'] as 'code' | 'markdown';
    const source    = input['source'] as string;
    const cellNum   = ++ctx.mutableCtx.cellCounter;
    const newCellId = crypto.randomUUID();

    // Register this cell so runCell / updateCell can find it by number
    ctx.mutableCtx.runtimeCells.set(cellNum, { id: newCellId, source, type: cellType });

    // Fire-and-forget disk sync — the UI updates immediately via the cell_create SSE event
    if (ctx.mutableCtx.notebookPath) {
      const nbPath     = path.join(ctx.project_path, ctx.mutableCtx.notebookPath);
      const cellSource = source;
      const cellId     = newCellId;
      void (async () => {
        try {
          const raw = await fs.readFile(nbPath, 'utf-8');
          const nb  = JSON.parse(raw) as { cells: Array<Record<string, unknown>>; [k: string]: unknown };
          const lines = cellSource.endsWith('\n') ? cellSource : cellSource + '\n';
          nb.cells.push({
            cell_type:       cellType,
            id:              cellId,
            metadata:        {},
            source:          lines.split('\n').reduce<string[]>((acc, l, i, arr) => {
              if (i < arr.length - 1) acc.push(l + '\n');
              else if (l)             acc.push(l);
              return acc;
            }, []),
            outputs:         [],
            ...(cellType === 'code' ? { execution_count: null } : {}),
          });
          await fs.writeFile(nbPath, JSON.stringify(nb, null, 2));
        } catch { /* ignore — UI is already updated via SSE */ }
      })();
    }

    ctx.emit({
      type:          'cell_create',
      new_cell_id:   newCellId,
      after_cell_id: null,
      cell_type:     cellType,
      source,
    });

    return {
      success: true,
      data: {
        cell_number: cellNum,
        cell_type:   cellType,
      },
    };
  },
};

export const updateCellEntry: ToolEntry = {
  definition: {
    name: 'updateCell',
    description: 'Update a notebook cell\'s source. Use cell_number — the integer returned by createCell or the 1-based position for pre-existing cells. When user says "edit cell 5", use cell_number: 5.',
    inputSchema: z.object({
      cell_number: z.number().int().describe('Integer cell number (from createCell result, or 1-based position for existing cells)'),
      source:      z.string(),
    }),
    permittedModes: ['AGENT', 'AGENTIC'],
  },
  execute: async (input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const n        = input['cell_number'] as number;
    const source   = input['source'] as string;
    const existing = ctx.current_notebook.cells;
    let cellId: string;

    if (n <= existing.length) {
      cellId = existing[n - 1]!.id;
    } else {
      const runtime = ctx.mutableCtx.runtimeCells.get(n);
      if (!runtime) return { success: false, error: `Cell ${n} not found` };
      cellId = runtime.id;
      ctx.mutableCtx.runtimeCells.set(n, { ...runtime, source });
    }

    ctx.emit({ type: 'cell_update', cell_id: cellId, source });
    return { success: true, data: { cell_number: n } };
  },
};

export const writeCellEntry: ToolEntry = {
  definition: {
    name: 'writeCell',
    description: 'Write content to a notebook cell, replacing its source.',
    inputSchema: z.object({ cell_id: z.string(), source: z.string() }),
    permittedModes: ['AGENT', 'AGENTIC'],
  },
  execute: async (input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    ctx.emit({ type: 'cell_update', cell_id: input['cell_id'] as string, source: input['source'] as string });
    return { success: true, data: { cell_id: input['cell_id'] } };
  },
};

export const requestDeleteCellEntry: ToolEntry = {
  definition: {
    name: 'requestDeleteCell',
    description: 'Ask the user for permission to delete a notebook cell. ALWAYS call this before deleteCell. Wait for user confirmation before calling deleteCell.',
    inputSchema: z.object({
      cell_id:  z.string(),
      reason:   z.string().describe('Why this cell should be deleted'),
    }),
    permittedModes: ['AGENT', 'AGENTIC'],
  },
  execute: async (input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    ctx.emit({
      type:    'permission_request',
      action:  'delete_cell',
      payload: { cell_id: input['cell_id'], reason: input['reason'] },
    });
    return { success: true, data: { message: 'Permission request sent. Inform the user and wait for their confirmation before calling deleteCell.' } };
  },
};

export const deleteCellEntry: ToolEntry = {
  definition: {
    name: 'deleteCell',
    description: 'Delete a notebook cell. Only call AFTER the user has confirmed via requestDeleteCell.',
    inputSchema: z.object({ cell_id: z.string() }),
    permittedModes: ['AGENT', 'AGENTIC'],
  },
  execute: async (input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    ctx.emit({ type: 'cell_delete', cell_id: input['cell_id'] as string });
    return { success: true, data: { cell_id: input['cell_id'] } };
  },
};

const NOTEBOOK_TEMPLATE = () => ({
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {
    kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
    language_info: { name: 'python', version: '3.10.0' },
  },
  cells: [],
});

export const createNotebookEntry: ToolEntry = {
  definition: {
    name: 'createNotebook',
    description: 'Create a new Jupyter notebook in the project\'s notebooks/ folder. Always stored under notebooks/.',
    inputSchema: z.object({
      path:  z.string().describe('Filename only, e.g. "linear_regression.ipynb". Always saved in notebooks/.'),
      // title: z.string().describe('Human-readable title for the first markdown cell. Provide empty string if no title is needed.'),
    }),
    permittedModes: ['AGENT', 'AGENTIC'],
  },
  execute: async (input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    try {
      // Always place notebooks inside notebooks/ regardless of what the agent provides
      const basename = path.basename(input['path'] as string);
      const relPath  = `notebooks/${basename.endsWith('.ipynb') ? basename : basename + '.ipynb'}`;
      const notebookPath = safeWrite(ctx.project_path, relPath);
      const nb = NOTEBOOK_TEMPLATE();
      await fs.mkdir(path.dirname(notebookPath), { recursive: true });
      await fs.writeFile(notebookPath, JSON.stringify(nb, null, 2));

      // Track this notebook so createCell can write cells to it directly
      ctx.mutableCtx.notebookPath = relPath;
      ctx.mutableCtx.cellCounter  = nb.cells.length;
      ctx.mutableCtx.runtimeCells.clear();

      ctx.emit({ type: 'notebook_create', path: relPath });
      return { success: true, data: { path: relPath, cells: nb.cells.length } };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  },
};

const FILE_TEMPLATES: Record<string, string> = {
  '.py':   '# Python script\n\n',
  '.json': '{}\n',
  '.csv':  '',
  '.md':   '# Title\n\n',
  '.txt':  '',
};

export const createFileEntry: ToolEntry = {
  definition: {
    name: 'createFile',
    description: 'Create a new file at the given path relative to project root. Supports .py, .csv, .json, .md, .txt. For .xlsx, writes an empty workbook placeholder.',
    inputSchema: z.object({
      path:    z.string().describe('Relative path including extension, e.g. "data/output.csv"'),
      content: z.string().describe('Initial file content. Provide empty string to use a default template.'),
    }),
    permittedModes: ['AGENT', 'AGENTIC'],
  },
  execute: async (input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    try {
      const userPath  = input['path'] as string;
      const filePath  = safeWrite(ctx.project_path, userPath);
      const ext       = path.extname(userPath).toLowerCase();
      const content   = (input['content'] as string | undefined)
        ?? FILE_TEMPLATES[ext]
        ?? '';
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf-8');
      return { success: true, data: { path: userPath, ext, bytes: content.length } };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  },
};

export const saveMemoryEntry: ToolEntry = {
  definition: {
    name: 'saveMemory',
    description: 'Merge facts into project memory. Always merges — never replaces the full file.',
    inputSchema: z.object({ patch_json: z.string().describe('JSON string representing the object to merge into memory.') }),
    permittedModes: ['AGENT', 'AGENTIC'],
  },
  execute: async (input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const store   = new OctomlStore(ctx.project_path);
    const current = await store.getMemory();
    const patch   = JSON.parse(input['patch_json'] as string);
    await store.saveMemory({ ...current, ...patch });
    return { success: true, data: { saved_keys: Object.keys(patch) } };
  },
};
