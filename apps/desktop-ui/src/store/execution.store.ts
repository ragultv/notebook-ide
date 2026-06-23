/**
 * execution.store.ts
 *
 * VS Code equivalent: INotebookExecutionStateService
 * (src/vs/workbench/contrib/notebook/common/notebookExecutionStateService.ts)
 *
 * This store is the SINGLE SOURCE OF TRUTH for per-cell execution state.
 * It is driven entirely by WebSocket messages from the server — never by
 * local component state.
 *
 * Key difference from old approach:
 *   OLD: cell.status lived in CellData[] in useNotebookManagement → caused
 *        full React reconciliation on every streaming output chunk.
 *   NEW: execution state lives here (Zustand) → only the specific cell that
 *        changed state re-renders. The cell data array is NOT touched during
 *        streaming.
 *
 * State machine (mirrors VS Code's NotebookCellExecutionState):
 *   idle → queued → running → success | error
 *              ↑                  ↓
 *           (cancelled)      (stopping → error)
 */

import { create } from 'zustand';

// ── Types ──────────────────────────────────────────────────────────────────────

export type CellExecState =
  | 'idle'      // No execution — VS Code: cell has no execution object
  | 'queued'    // In queue, waiting — VS Code: Unconfirmed
  | 'running'   // Kernel is executing — VS Code: Executing
  | 'stopping'  // Interrupt sent, awaiting reply
  | 'success'   // Completed OK — VS Code: lastRunSuccess=true
  | 'error';    // Completed with error — VS Code: lastRunSuccess=false

export interface CellExecutionInfo {
  state: CellExecState;
  /** Server-assigned execution ID for correlating output messages */
  executionId: string | null;
  /** Kernel execution counter, e.g. [1], [2] — from server execute_reply */
  executionCount: number | null;
  /** Execution duration in seconds (from server) */
  duration: number | null;
  /** Error string if state === 'error' */
  error: string | null;
  /** Queue position (1-based) when state === 'queued' */
  queuePosition: number | null;
  /** Epoch ms when execution started — for elapsed timer */
  runStartTime: number | null;
}

interface ExecutionState {
  /** Map of cellId → execution info */
  cells: Record<string, CellExecutionInfo>;

  // ── Actions (driven by WS messages) ────────────────────────────────────────

  /** execution_started: cell accepted into queue */
  setQueued: (cellId: string, executionId: string, queuePosition?: number) => void;

  /** cell_started: kernel dequeued the cell and is now running it */
  setRunning: (cellId: string, executionId: string, startTimer?: boolean) => void;

  /** Optimistic stopping state — interrupt was sent */
  setStopping: (cellId: string) => void;

  /** execution_complete: cell finished successfully */
  setSuccess: (cellId: string, executionId: string, executionCount: number | null, durationMs: number | null) => void;

  /** execution_error: cell failed */
  setError: (cellId: string, executionId: string, error: string) => void;

  /** cell_cancelled: cell was removed from queue before running */
  setIdle: (cellId: string) => void;

  /** Reset all cells for a notebook (on kernel restart) */
  resetNotebook: (cellIds: string[]) => void;

  /** Get execution info for a cell, or a default idle state */
  getCell: (cellId: string) => CellExecutionInfo;
}

// ── Default state for a cell ───────────────────────────────────────────────────

const IDLE: CellExecutionInfo = {
  state: 'idle',
  executionId: null,
  executionCount: null,
  duration: null,
  error: null,
  queuePosition: null,
  runStartTime: null,
};

// ── Store ──────────────────────────────────────────────────────────────────────

export const useExecutionStore = create<ExecutionState>((set, get) => ({
  cells: {},

  setQueued: (cellId, executionId, queuePosition) =>
    set(s => ({
      cells: {
        ...s.cells,
        [cellId]: {
          state: 'queued',
          executionId,
          executionCount: s.cells[cellId]?.executionCount ?? null, // preserve previous
          duration: null,
          error: null,
          queuePosition: queuePosition ?? null,
          runStartTime: null,
        },
      },
    })),

  setRunning: (cellId, executionId, startTimer = false) =>
    set(s => {
      const prev = s.cells[cellId];
      return {
        cells: {
          ...s.cells,
          [cellId]: {
            state: 'running',
            executionId,
            executionCount: prev?.executionCount ?? null,
            duration: null,
            error: null,
            queuePosition: null,
            // Only stamp runStartTime when the kernel has actually dequeued the cell
            // (startTimer=true, sent with cell_started). When called from
            // execution_started we stay in running state but keep runStartTime null
            // so the elapsed counter doesn't tick during the queue-wait period.
            runStartTime: startTimer ? Date.now() : (prev?.runStartTime ?? null),
          },
        },
      };
    }),

  setStopping: (cellId) =>
    set(s => {
      const prev = s.cells[cellId];
      if (!prev || prev.state !== 'running') return s;
      return {
        cells: {
          ...s.cells,
          [cellId]: { ...prev, state: 'stopping' },
        },
      };
    }),

  setSuccess: (cellId, executionId, executionCount, durationMs) =>
    set(s => ({
      cells: {
        ...s.cells,
        [cellId]: {
          state: 'success',
          executionId,
          executionCount,
          duration: durationMs !== null ? durationMs / 1000 : null, // store as seconds
          error: null,
          queuePosition: null,
          runStartTime: null,
        },
      },
    })),

  setError: (cellId, executionId, error) =>
    set(s => ({
      cells: {
        ...s.cells,
        [cellId]: {
          state: 'error',
          executionId,
          executionCount: s.cells[cellId]?.executionCount ?? null,
          duration: null,
          error,
          queuePosition: null,
          runStartTime: null,
        },
      },
    })),

  setIdle: (cellId) =>
    set(s => ({
      cells: {
        ...s.cells,
        [cellId]: {
          ...IDLE,
          executionCount: s.cells[cellId]?.executionCount ?? null, // preserve previous exec count
        },
      },
    })),

  resetNotebook: (cellIds) =>
    set(s => {
      const next = { ...s.cells };
      for (const id of cellIds) {
        next[id] = { ...IDLE };
      }
      return { cells: next };
    }),

  getCell: (cellId) => get().cells[cellId] ?? IDLE,
}));
