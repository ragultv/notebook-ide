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
    description: 'Execute a single notebook cell by its number or raw source. You must provide EITHER cell_number (as string) OR source code.',
    inputSchema: z.object({
      target: z.string().describe('The cell number to run (e.g. "1") or the raw Python source code to execute directly.'),
    }),
    permittedModes: ['AGENTIC'],
  },
  execute: async (input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const target = input['target'] as string;
    const isNumber = /^\d+$/.test(target.trim());
    let sourceToRun = '';
    let cellId: string | null = null;

    if (isNumber) {
      const n = parseInt(target.trim(), 10);
      const existing = ctx.current_notebook.cells;
      if (n <= existing.length) {
        sourceToRun = existing[n - 1]!.source;
        cellId      = existing[n - 1]!.id;
      } else {
        const runtime = ctx.mutableCtx.runtimeCells.get(n);
        if (!runtime) return { success: false, error: `Cell ${n} not found` };
        sourceToRun = runtime.source;
        cellId      = runtime.id;
      }
    } else {
      sourceToRun = target;
      // If the agent passed raw source code, try to find the corresponding cell ID in the notebook
      // so we can broadcast the execution state to the UI.
      const matchedCell = ctx.current_notebook.cells.find(
        c => c.source.trim() === target.trim()
      );
      if (matchedCell) {
        cellId = matchedCell.id;
      }
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
      await fs.mkdir(store.getRunArtifactsDir(state.last_run_id), { recursive: true });
    }

    return {
      success: result.success,
      data:    { outputs: result.outputs },
      ...(result.error ? { error: `${result.error.ename}: ${result.error.evalue}` } : {}),
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

    const { cells } = ctx.current_notebook;
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
