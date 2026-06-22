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
    description: [
      'Execute a notebook cell in the Jupyter kernel.',
      'Use cell_number — the integer returned by createCell, or the 1-based position for pre-existing cells.',
      'Example: createCell returns cell_number:3 → runCell(cell_number:3).',
      'Fallback: if you only have the source code, pass source instead.',
    ].join(' '),
    inputSchema: z.object({
      cell_number: z.number().int().min(1).optional().describe('PREFERRED: integer from createCell result (1, 2, 3…). Also accepts 1-based position for pre-existing cells.'),
      source:      z.string().optional().describe('Fallback: exact Python source to execute directly.'),
    }).refine(d => d.cell_number !== undefined || d.source, {
      message: 'Provide cell_number or source',
    }),
    permittedModes: ['AGENTIC'],
  },
  execute: async (input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    let source: string;

    if (input['cell_number'] !== undefined) {
      const n        = input['cell_number'] as number;
      const existing = ctx.current_notebook.cells;

      if (n <= existing.length) {
        source = existing[n - 1]!.source;
      } else {
        const runtime = ctx.mutableCtx.runtimeCells.get(n);
        if (!runtime) {
          return {
            success: false,
            error: `Cell ${n} not found. Notebook has ${existing.length} pre-existing cells and ${ctx.mutableCtx.runtimeCells.size} cells created this turn.`,
          };
        }
        source = runtime.source;
      }
    } else {
      source = input['source'] as string;
    }

    const bridge = _bridge;
    if (!bridge) return { success: false, error: 'Kernel bridge not connected' };

    const result = await bridge.executeCell(source, evt => {
      ctx.emit({ type: 'kernel_output', stream: evt.stream, text: evt.text });
    });

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
    description: 'Run all code cells from a starting cell (or from top if from_cell_id is omitted).',
    inputSchema: z.object({ from_cell_id: z.string().optional() }),
    permittedModes: ['AGENTIC'],
  },
  execute: async (input: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const bridge = _bridge;
    if (!bridge) return { success: false, error: 'Kernel bridge not connected' };

    const { cells } = ctx.current_notebook;
    const fromId    = input['from_cell_id'] as string | undefined;
    const startIdx  = fromId ? cells.findIndex(c => c.id === fromId) : 0;

    if (startIdx === -1) return { success: false, error: `Cell not found: ${fromId}` };

    const results: Array<{ cell_id: string; success: boolean }> = [];

    for (const cell of cells.slice(startIdx)) {
      if (cell.type !== 'code') continue;
      const res = await bridge.executeCell(cell.source, evt => {
        ctx.emit({ type: 'kernel_output', stream: evt.stream, text: evt.text });
      });
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
