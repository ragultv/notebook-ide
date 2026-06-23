/**
 * NotebookWSContext.tsx
 *
 * VS Code equivalent:
 *   - extHostNotebookKernels.ts  (bridge between kernel and state)
 *   - notebookExecutionStateServiceImpl.ts (drives execution state)
 *
 * This context provides ONE shared WebSocket per notebook and translates
 * every incoming WS message into:
 *   1. execution.store actions (cell state: queued/running/success/error)
 *   2. typed event emissions for CellOutputView to consume (streaming output)
 *
 * Critical: every Cell shares the SAME WebSocket instance via this context.
 */

import React, { createContext, useContext, ReactNode, useRef, useEffect } from 'react';
import { useNotebookWebSocket } from '../../hooks/useNotebookWebSocket';
import { useExecutionStore } from '../../store/execution.store';

export interface WSContextType extends ReturnType<typeof useNotebookWebSocket> {
    registerRunCell: (cellId: string, runFn: () => Promise<any>) => void;
    unregisterRunCell: (cellId: string) => void;
    runCell: (cellId: string) => Promise<any>;
}

const NotebookWSContext = createContext<WSContextType | null>(null);

export function NotebookWSProvider({
    notebookId,
    children,
    cellIds = [],
}: {
    notebookId: string;
    children: ReactNode;
    /** Pass all current cell IDs so we can reset state on kernel restart */
    cellIds?: string[];
}) {
    const ws = useNotebookWebSocket(notebookId);
    const registryRef = useRef<Record<string, () => Promise<any>>>({});

    // ── Translate WS messages → execution.store ───────────────────────────────
    // This mirrors how VS Code's MainThreadNotebookKernels.$executeCells drives
    // INotebookExecutionStateService.createCellExecution / updateExecution / completeExecution.

    const {
        setQueued,
        setRunning,
        setStopping,
        setSuccess,
        setError,
        setIdle,
        resetNotebook,
    } = useExecutionStore();

    useEffect(() => {
        if (!ws.on) return;

        const cleanups: (() => void)[] = [];

        // execution_started: server confirmed the cell was accepted.
        // If another cell is already active show Queued so the user sees the wait.
        // Otherwise go straight to Running (no "Queue" flash) — but don't start the
        // elapsed timer yet; the timer only starts when cell_started arrives.
        cleanups.push(ws.on('execution_started', (msg: any) => {
            const { cells } = useExecutionStore.getState();
            const hasOtherActiveCells = Object.entries(cells).some(
                ([id, c]) =>
                    id !== msg.cell_id &&
                    (c.state === 'running' || c.state === 'queued' || c.state === 'stopping'),
            );
            if (hasOtherActiveCells) {
                setQueued(msg.cell_id, msg.execution_id, msg.queue_position);
            } else {
                setRunning(msg.cell_id, msg.execution_id, false); // running, timer not yet started
            }
        }));

        // cell_started: kernel dequeued this cell — NOW start the elapsed timer.
        cleanups.push(ws.on('cell_started', (msg: any) => {
            setRunning(msg.cell_id, msg.execution_id, true); // starts runStartTime
        }));

        // execution_complete: cell finished successfully (legacy + new event)
        cleanups.push(ws.on('execution_complete', (msg: any) => {
            const result = msg.result || {};
            // duration_ms may come from cell_completed; fallback to execution_time (seconds)
            const durationMs =
                msg.duration_ms ??
                (result.execution_time != null ? result.execution_time * 1000 : null);
            setSuccess(
                msg.cell_id,
                msg.execution_id,
                result.executionCount ?? result.execution_count ?? null,
                durationMs,
            );
        }));

        // execution_error: cell failed
        cleanups.push(ws.on('execution_error', (msg: any) => {
            setError(msg.cell_id, msg.execution_id, msg.error || 'Execution failed');
        }));

        // cell_interrupted: kernel interrupt completed
        cleanups.push(ws.on('cell_interrupted', (msg: any) => {
            setError(msg.cell_id, msg.execution_id, 'KeyboardInterrupt: Execution interrupted by user');
        }));

        // cell_cancelled: cell was drained from queue before running
        cleanups.push(ws.on('cell_cancelled', (msg: any) => {
            setIdle(msg.cell_id);
        }));

        // kernel restart: reset all cell execution states
        cleanups.push(ws.on('kernel_status', (msg: any) => {
            if (msg.status === 'idle' || msg.status === 'restarted') {
                // Only reset when restarted (execution_count is also reset)
                if (msg.execution_count === 0 || msg.status === 'restarted') {
                    resetNotebook(cellIds);
                }
            }
        }));

        return () => cleanups.forEach(c => c());
    }, [ws.on, notebookId, setQueued, setRunning, setStopping, setSuccess, setError, setIdle, resetNotebook]);

    // ── runCell registry — for sequential "Run All" ───────────────────────────
    // Each Cell registers its own runCell function here.
    // NotebookInner uses ws context's runCell to trigger cells sequentially.

    const registerRunCell = (cellId: string, runFn: () => Promise<any>) => {
        registryRef.current[cellId] = runFn;
    };

    const unregisterRunCell = (cellId: string) => {
        delete registryRef.current[cellId];
    };

    const runCell = async (cellId: string) => {
        const runFn = registryRef.current[cellId];
        if (runFn) {
            return await runFn();
        }
        return undefined;
    };

    const contextValue: WSContextType = {
        ...ws,
        registerRunCell,
        unregisterRunCell,
        runCell,
    };

    return (
        <NotebookWSContext.Provider value={contextValue}>
            {children}
        </NotebookWSContext.Provider>
    );
}

export function useNotebookWS(): WSContextType {
    const ctx = useContext(NotebookWSContext);
    if (!ctx) {
        throw new Error('useNotebookWS must be used within a NotebookWSProvider');
    }
    return ctx;
}
