import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import type { ToolEntry, ToolExecutionContext, ToolResult } from '../types/index.js';
import type { KernelBridge } from '../kernel-bridge.js';
import { OctomlStore } from '../store/octoml-store.js';

let _bridge: KernelBridge | null = null;

export function setKernelBridge(bridge: KernelBridge): void {
  _bridge = bridge;
}

export function getKernelBridge(): KernelBridge | null {
  return _bridge;
}

export const runCellEntry: ToolEntry = {
  definition: {
    name: 'runCell',
    description: 'Execute a single notebook cell by its 1-based cell number (1, 2, ...). Example: runCell({ cell_number: 1 })',
    inputSchema: z.object({
      cell_number: z.union([z.string(), z.number()]).optional().describe('The 1-based cell number to run (e.g. 1 or "1")'),
      target: z.union([z.string(), z.number()]).optional().describe('The 1-based cell number to run (e.g. 1 or "1")'),
      source: z.string().optional().describe('Optional raw source code to run'),
      number: z.union([z.string(), z.number()]).optional(),
      cell: z.union([z.string(), z.number()]).optional(),
    }),
    permittedModes: ['AGENTIC'],
  },
  execute: async (input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    let rawTarget = input['cell_number'] ?? input['target'] ?? input['number'] ?? input['cell'] ?? input['source'];
    let target = String(rawTarget !== undefined && rawTarget !== null ? rawTarget : '').trim();

    const totalCells = Math.max(ctx.mutableCtx.runtimeCells.size, ctx.current_notebook.cells.length);

    // If no argument was provided (e.g. `{}`) or target is empty:
    if (!target) {
      if (totalCells === 1) {
        target = '1';
      } else if (totalCells > 1) {
        return {
          success: false,
          error: `Missing required argument 'cell_number'. Please call runCell({ cell_number: 1 }) through runCell({ cell_number: ${totalCells} }).`
        };
      } else {
        return { success: false, error: 'No cells exist in the notebook to execute.' };
      }
    }

    const isNumber = /^\d+$/.test(target);
    let sourceToRun = '';
    let cellId: string | null = null;
    let cellType: string | null = null;

    if (isNumber) {
      const n = parseInt(target, 10);
      const runtime = ctx.mutableCtx.runtimeCells.get(n);
      if (runtime) {
        sourceToRun = runtime.source;
        cellId      = runtime.id;
        cellType    = runtime.type;
      } else {
        const existing = ctx.current_notebook.cells;
        if (n >= 1 && n <= existing.length) {
          sourceToRun = existing[n - 1]!.source;
          cellId      = existing[n - 1]!.id;
          cellType    = existing[n - 1]!.type;
        } else {
          return { success: false, error: `Cell ${n} not found. Available cells: 1 to ${totalCells}.` };
        }
      }
    } else {
      sourceToRun = target;
      for (const cell of ctx.mutableCtx.runtimeCells.values()) {
        if (cell.source.trim() === target.trim()) {
          cellId = cell.id;
          cellType = cell.type;
          break;
        }
      }
      if (!cellId) {
        const matchedCell = ctx.current_notebook.cells.find(
          c => c.source.trim() === target.trim()
        );
        if (matchedCell) {
          cellId = matchedCell.id;
          cellType = matchedCell.type;
        }
      }
    }

    if (!sourceToRun.trim()) {
      return { success: false, error: `Cell is empty or not found. Please provide a valid 1-based cell_number (e.g. { cell_number: 1 }).` };
    }

    if (cellType === 'markdown') {
      return { success: true, data: { message: 'Skipped execution: Markdown cells cannot be executed.' } };
    }

    const bridge = _bridge;
    if (!bridge) return { success: false, error: 'Kernel bridge not connected' };

    // Signal the frontend that this cell is now running
    if (cellId) ctx.emit({ type: 'cell_run_start', cell_id: cellId });

    const result = await bridge.executeCell(sourceToRun, evt => {
      ctx.emit({ type: 'kernel_output', stream: evt.stream, text: evt.text });
    }, cellId ?? undefined);

    // Signal the frontend that execution finished
    if (cellId) ctx.emit({ type: 'cell_run_complete', cell_id: cellId, success: result.success });

    const store = new OctomlStore(ctx.project_path);
    const state = await store.getState();
    if (state.last_run_id) {
      const runDir  = store.getRunArtifactsDir(state.last_run_id);
      const outPath = path.join(runDir, `cell_${cellId ?? 'anon'}_output.json`);
      await fs.mkdir(runDir, { recursive: true });
      await fs.writeFile(outPath, JSON.stringify(result, null, 2), 'utf-8');
    }

    return {
      success: result.success,
      data: {
        success: result.success,
        outputs: result.outputs,
        error:   result.error,
      },
    };
  },
};

export const runNotebookEntry: ToolEntry = {
  definition: {
    name: 'runNotebook',
    description: 'Run all code cells from a starting cell (or from top if from_cell_id is empty).',
    inputSchema: z.object({ from_cell_id: z.string().describe("Starting cell ID or empty string to run all.") }),
    permittedModes: ['AGENTIC'],
  },
  execute: async (input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const bridge = _bridge;
    if (!bridge) return { success: false, error: 'Kernel bridge not connected' };

    const cells = ctx.mutableCtx.runtimeCells.size > 0
      ? Array.from(ctx.mutableCtx.runtimeCells.entries()).sort((a, b) => a[0] - b[0]).map(e => e[1])
      : ctx.current_notebook.cells;
    const fromId    = (input['from_cell_id'] as string || '').trim();
    const startIdx  = fromId ? cells.findIndex(c => c.id === fromId) : 0;

    if (startIdx === -1) return { success: false, error: `Cell not found: ${fromId}` };

    const results: Array<{ cell_id: string; success: boolean }> = [];

    for (const cell of cells.slice(startIdx)) {
      if (cell.type !== 'code') continue;
      const res = await bridge.executeCell(cell.source, evt => {
        ctx.emit({ type: 'kernel_output', stream: evt.stream, text: evt.text });
      }, cell.id);
      results.push({ cell_id: cell.id, success: res.success });
      if (!res.success) break;
    }

    return { success: true, data: { cells_run: results } };
  },
};

export const createArtifactEntry: ToolEntry = {
  definition: {
    name: 'createArtifact',
    description: 'Write a file to the current run artifacts directory.',
    inputSchema: z.object({ filename: z.string(), content: z.string() }),
    permittedModes: ['AGENTIC'],
  },
  execute: async (input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const store  = new OctomlStore(ctx.project_path);
    const state  = await store.getState();
    const runId  = state.last_run_id ?? ctx.run_id;
    const dir    = store.getRunArtifactsDir(runId);
    await fs.mkdir(dir, { recursive: true });

    const safeName = path.basename(input['filename'] as string);
    const outPath  = path.join(dir, safeName);
    await fs.writeFile(outPath, input['content'] as string, 'utf-8');
    return { success: true, data: { filename: safeName } };
  },
};
