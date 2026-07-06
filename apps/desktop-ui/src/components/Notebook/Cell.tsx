/**
 * Cell.tsx — Notebook Cell Component
 *
 * VS Code equivalents:
 *   - codeCell.ts    (browser/view/cellParts/codeCell.ts)   — code cell lifecycle
 *   - markupCell.ts  (browser/view/cellParts/markupCell.ts) — markdown cell
 *   - CellExecution.ts (cellParts/cellExecution.ts)          — gutter run button
 *
 * Architecture changes from VS Code pattern:
 *   OLD: Cell owned all execution state via props (cell.status, onOutputUpdate)
 *   NEW: Cell reads execution state from useExecutionStore() by cell.id
 *        Cell delegates all output rendering to CellOutputView
 *        Cell never calls setCells() during streaming
 *
 * React.memo: Cell only re-renders when its OWN content or active state changes.
 * Execution state changes (from Zustand) only re-render the affected cell.
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
    Play, Trash2, ArrowUp, ArrowDown, MoreHorizontal, Wrench,
    CheckCircle2, XCircle, GripVertical, Loader2, StopCircle, X,
} from 'lucide-react';
import { CellData, CellOutput } from '../../types';
import { controllerClient } from '../../services/controller.client';
import { useExecutionStore } from '../../store/execution.store';
import { TextCell } from './TextCell';
import { MonacoCellEditor } from './MonacoCellEditor';
import { WidgetRenderer } from './WidgetRenderer';
import { handleCommOpen, handleCommMsg, handleCommClose } from '../../services/widget.service';
import { useNotebookWS } from './NotebookWSContext';
import { CellOutputView } from './CellOutput/CellOutputView';

// ── Props ─────────────────────────────────────────────────────────────────────

interface CellProps {
    cell: CellData;
    index: number;
    notebookId: string;
    notebookName: string;
    isActive: boolean;
    onActivate: () => void;
    onDeactivate?: () => void;
    onUpdate: (id: string, content: string) => void;
    /**
     * Called ONCE on completion (success/error) with the final outputs.
     * NOT called on streaming chunks — CellOutputView handles those internally.
     */
    onFinalOutput: (
        id: string,
        outputs: CellOutput[],
        error?: string,
    ) => void;
    onDelete: (id: string) => void;
    onMoveUp: (id: string) => void;
    onMoveDown: (id: string) => void;
    onMove?: (from: number, to: number) => void;
    onFixError?: (cellIndex: number, error: string, cellContent: string, cellId: string) => void;
    allCells?: CellData[];
}

// ── ToolBtn ───────────────────────────────────────────────────────────────────

const ToolBtn: React.FC<{
    icon: React.ComponentType<any>;
    onClick: (e: any) => void;
    label: string;
    danger?: boolean;
}> = ({ icon: Icon, onClick, label, danger }) => (
    <button
        onClick={(e) => { e.stopPropagation(); onClick(e); }}
        title={label}
        className={`p-2 rounded-full transition-colors ${danger
            ? 'text-red-500 hover:text-red-600 hover:bg-red-500/10'
            : 'text-sim-muted hover:text-sim-text hover:bg-sim-border'
            }`}
    >
        <Icon className="w-4 h-4" />
    </button>
);

// ── Duration formatter ────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
    if (ms < 1) return '<1ms';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(2)}s`;
    return `${Math.floor(s / 60)}m ${(s % 60).toFixed(1)}s`;
}

function formatSeconds(s: number): string {
    return formatDuration(s * 1000);
}

// ── Cell ──────────────────────────────────────────────────────────────────────

export const Cell: React.FC<CellProps> = React.memo(({
    cell, index, notebookId, notebookName,
    isActive, onActivate, onDeactivate,
    onUpdate, onFinalOutput,
    onDelete, onMoveUp, onMoveDown, onMove,
    onFixError, allCells,
}) => {
    const [isHovered, setIsHovered] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);

    // Live elapsed timer (only reads runStartTime from store, not from props)
    const [elapsedMs, setElapsedMs] = useState(0);

    const { execute, interrupt, sendStdin, sendCommMsg, on, connected, registerRunCell, unregisterRunCell } = useNotebookWS();

    // ── Execution state from Zustand (VS Code: INotebookExecutionStateService) ─
    // This is the KEY CHANGE: we read state from the Zustand store, not from
    // cell.status. Only this cell re-renders when its execution state changes.
    const execInfo = useExecutionStore(s => s.cells[cell.id]);
    const execState = execInfo?.state ?? 'idle';
    const executionCount = execInfo?.executionCount ?? cell.executionCount ?? null;
    const duration = execInfo?.duration ?? null;

    const isRunning = execState === 'running';
    const isQueued = execState === 'queued';
    const isStopping = execState === 'stopping';
    const isSuccess = execState === 'success';
    const isError = execState === 'error';

    const isCode = cell.type === 'code';

    // ── Elapsed timer (from store runStartTime, survives tab switches) ────────
    useEffect(() => {
        if (!isRunning && !isStopping) { setElapsedMs(0); return; }
        const startEpoch = execInfo?.runStartTime ?? Date.now();
        const update = () => setElapsedMs(Date.now() - startEpoch);
        update();
        const interval = setInterval(update, 100);
        return () => clearInterval(interval);
    }, [isRunning, isStopping, execInfo?.runStartTime]);

    // ── Widget comm messages ──────────────────────────────────────────────────
    const executionIdRef = useRef<string | null>(null);
    executionIdRef.current = execInfo?.executionId ?? null;

    useEffect(() => {
        const cleanups: (() => void)[] = [];

        cleanups.push(on('comm_open', async (msg: any) => {
            await handleCommOpen(msg.comm_id, msg.target_name, msg.data, msg.metadata,
                (cid: string, d: any) => sendCommMsg(cid, d));
        }));

        cleanups.push(on('comm_msg', (msg: any) => {
            handleCommMsg(msg.comm_id, msg.data);
        }));

        cleanups.push(on('comm_close', (msg: any) => {
            handleCommClose(msg.comm_id);
        }));

        // Sync final outputs to shared cell state (for save/reload)
        cleanups.push(on('execution_complete', (msg: any) => {
            if (msg.cell_id !== cell.id) return;
            const result = msg.result || {};
            const outputs = result.outputs?.length ? result.outputs as CellOutput[] : [];
            onFinalOutput(cell.id, outputs, undefined);
        }));

        cleanups.push(on('execution_error', (msg: any) => {
            if (msg.cell_id !== cell.id) return;
            onFinalOutput(cell.id, [], msg.error || 'Execution failed');
        }));

        return () => cleanups.forEach(c => c());
    }, [cell.id, on, onFinalOutput, sendCommMsg]);

    // ── Run ───────────────────────────────────────────────────────────────────
    const { setStopping, setIdle, setQueued: optimisticSetQueued, setRunning: optimisticSetRunning } = useExecutionStore();
    const pendingResolveRef = useRef<((value: any) => void) | null>(null);
    const interruptTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const runCell = useCallback(() => {
        return new Promise<any>(async (resolve) => {
            if (cell.type === 'markdown') return resolve({ success: true });
            if (!cell.content.trim()) return resolve({ success: true });

            pendingResolveRef.current = resolve;

            // Optimistic update: immediately enter the correct state so old outputs
            // clear before the server responds. If the kernel appears free (no other
            // cells active), go directly to Running — no Queued flash. If another
            // cell is already running, show Queued until it's our turn.
            const pendingId = `__pending_${Date.now()}__`;
            const { cells: activeCells } = useExecutionStore.getState();
            const kernelBusy = Object.entries(activeCells).some(
                ([id, c]) =>
                    id !== cell.id &&
                    (c.state === 'running' || c.state === 'queued' || c.state === 'stopping'),
            );
            if (kernelBusy) {
                optimisticSetQueued(cell.id, pendingId, 0);
            } else {
                optimisticSetRunning(cell.id, pendingId);
            }

            try {
                await execute(cell.id, cell.content);
                // execution_started WS message → execution.store.setRunning() (or setQueued)
                // cell_started WS message     → execution.store.setRunning()
                // execution_complete          → execution.store.setSuccess() + this listener
                // execution_error             → execution.store.setError()
            } catch (e) {
                pendingResolveRef.current = null;
                resolve({ success: false, error: 'Failed to start execution' });
            }
        });
    }, [cell.id, cell.type, cell.content, execute, optimisticSetQueued, optimisticSetRunning]);

    // Resolve the pending promise when execution finishes
    useEffect(() => {
        const cleanups: (() => void)[] = [];

        cleanups.push(on('execution_complete', (msg: any) => {
            if (msg.cell_id !== cell.id) return;
            if (interruptTimeoutRef.current) { clearTimeout(interruptTimeoutRef.current); interruptTimeoutRef.current = null; }
            if (pendingResolveRef.current) {
                pendingResolveRef.current({ success: true });
                pendingResolveRef.current = null;
            }
        }));

        cleanups.push(on('execution_error', (msg: any) => {
            if (msg.cell_id !== cell.id) return;
            if (interruptTimeoutRef.current) { clearTimeout(interruptTimeoutRef.current); interruptTimeoutRef.current = null; }
            if (pendingResolveRef.current) {
                pendingResolveRef.current({ success: false, error: msg.error });
                pendingResolveRef.current = null;
            }
        }));

        cleanups.push(on('cell_cancelled', (msg: any) => {
            if (msg.cell_id !== cell.id) return;
            if (pendingResolveRef.current) {
                pendingResolveRef.current({ success: false, error: 'Cancelled' });
                pendingResolveRef.current = null;
            }
        }));

        return () => cleanups.forEach(c => c());
    }, [cell.id, on]);

    // Register for Run All sequential execution
    useEffect(() => {
        registerRunCell(cell.id, runCell);
        return () => unregisterRunCell(cell.id);
    }, [cell.id, runCell, registerRunCell, unregisterRunCell]);

    // ── Cancel queued cell (remove from queue before it starts) ──────────────
    const handleCancelQueue = useCallback(() => {
        // Immediately reset the cell's visual state to idle — the execution
        // will silently run in the background (output discarded since
        // execution_id no longer matches the cell's current state).
        setIdle(cell.id);
        if (pendingResolveRef.current) {
            pendingResolveRef.current({ success: false, error: 'Cancelled' });
            pendingResolveRef.current = null;
        }
    }, [cell.id, setIdle]);

    // ── Interrupt ─────────────────────────────────────────────────────────────
    const handleInterrupt = useCallback(() => {
        setStopping(cell.id);

        interrupt();
        if (interruptTimeoutRef.current) clearTimeout(interruptTimeoutRef.current);
        interruptTimeoutRef.current = setTimeout(() => {
            interruptTimeoutRef.current = null;
            // If kernel didn't respond in 3s, force error state
            useExecutionStore.getState().setError(cell.id, execInfo?.executionId ?? '', 'KeyboardInterrupt: Execution interrupted by user');
            if (pendingResolveRef.current) {
                pendingResolveRef.current({ success: false, error: 'Interrupted' });
                pendingResolveRef.current = null;
            }
        }, 3000);
    }, [interrupt, cell.id, setStopping, execInfo?.executionId]);

    // ── stdin handler (passed to CellOutputView) ──────────────────────────────
    const handleStdinSubmit = useCallback((executionId: string, value: string) => {
        sendStdin(executionId, value);
    }, [sendStdin]);

    // ── Fix Error ─────────────────────────────────────────────────────────────
    const handleFixError = () => {
        if (!onFixError || !cell.error) return;
        onFixError(index + 1, cell.error, cell.content, cell.id);
    };

    // ── Drag ──────────────────────────────────────────────────────────────────
    const handleDragStart = (e: React.DragEvent) => {
        e.dataTransfer.setData('application/json', JSON.stringify({
            type: 'cell-drag', index: index + 1, cellId: cell.id, notebookId, notebookName,
            content: cell.content, cellType: cell.type,
        }));
        e.dataTransfer.setData('application/x-cell-index', index.toString());
        e.dataTransfer.setData('text/plain', `[Cell ${index + 1}]`);
        e.dataTransfer.effectAllowed = 'copyMove';
    };

    const handleDragOver = (e: React.DragEvent) => {
        if (e.dataTransfer.types.includes('application/x-cell-index')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setIsDragOver(true);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        const fromIndexStr = e.dataTransfer.getData('application/x-cell-index');
        if (fromIndexStr && onMove) {
            const fromIndex = parseInt(fromIndexStr, 10);
            if (!isNaN(fromIndex) && fromIndex !== index) onMove(fromIndex, index);
        }
    };

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div
            id={`cell-${cell.id}`}
            data-cell-id={cell.id}
            data-cell-index={index + 1}
            onDragOver={handleDragOver}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); }}
            onDrop={handleDrop}
            className={`relative group flex ${isCode ? 'gap-3 px-4' : 'px-3 py-3'} py-2 my-1 rounded-xl transition-all duration-200 min-h-[40px] cursor-default border
                ${isDragOver ? 'border-2 border-dashed border-sim-red bg-sim-red/5' : 'border-transparent'}
                ${isActive
                    ? `${isCode ? 'bg-[#1e1e20]/30 border-white/20' : 'border-white/20 bg-transparent'} z-10`
                    : isCode
                        ? 'bg-[#1e1e20]/10 border-white/5'
                        : 'bg-transparent border-transparent'
                }`}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={(e) => { e.stopPropagation(); if (!isActive) onActivate(); }}
        >
            {/* Drag handle */}
            <div
                draggable
                onDragStart={handleDragStart}
                className="absolute left-1/2 -translate-x-1/2 -top-2 px-3 py-1 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-all z-30 bg-[#2b2b2e] border border-white/10 rounded-full shadow-lg hover:bg-[#3b3b3e]"
                title="Drag to reorder"
                onClick={(e) => e.stopPropagation()}
            >
                <GripVertical className="w-4 h-4 text-sim-muted hover:text-sim-text" />
            </div>

            {/* Gutter / Controls (VS Code: CellExecution.ts) */}
            {isCode && (
                <div className="w-10 flex-shrink-0 flex flex-col items-center py-1 select-none z-20 sticky top-2 self-start h-fit">
                    <div className="flex flex-col items-center gap-2">
                        {/* Run / Stop button */}
                        {isRunning || isStopping ? (
                            <button
                                onClick={(e) => { e.stopPropagation(); if (!isStopping) handleInterrupt(); }}
                                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-md border
                                    ${isStopping
                                        ? 'bg-blue-500/10 dark:bg-blue-950/20 text-sim-redHover border-sim-red ring-2 ring-sim-red cursor-not-allowed'
                                        : 'bg-red-500/10 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-400 dark:border-red-500 ring-2 ring-red-400 dark:ring-red-500 hover:bg-red-500/20 dark:hover:bg-red-900/40'
                                    }`}
                                title={isStopping ? 'Stopping...' : 'Interrupt kernel'}
                                disabled={isStopping}
                            >
                                {isStopping
                                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    : <StopCircle className="w-3.5 h-3.5" />}
                            </button>
                        ) : isQueued ? (
                            <button
                                onClick={(e) => { e.stopPropagation(); handleCancelQueue(); }}
                                className="w-8 h-8 rounded-full flex items-center justify-center bg-yellow-500/10 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-500 border border-yellow-400 dark:border-yellow-600 hover:bg-yellow-500/20 dark:hover:bg-yellow-900/40 hover:text-yellow-750 dark:hover:text-yellow-300 hover:border-yellow-400 transition-all group/cancel"
                                title="Queued — click to cancel"
                            >
                                <Loader2 className="w-3.5 h-3.5 animate-spin group-hover/cancel:hidden" />
                                <X className="w-3.5 h-3.5 hidden group-hover/cancel:block" />
                            </button>
                        ) : (
                            <button
                                onClick={(e) => { e.stopPropagation(); runCell(); }}
                                disabled={!connected}
                                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-md border
                                    ${!connected ? 'opacity-40 cursor-not-allowed bg-sim-border border-sim-border text-sim-muted' : ''}
                                    ${isSuccess ? 'bg-green-500/10 dark:bg-green-950/40 text-green-600 dark:text-green-500 border-green-300 dark:border-green-800 hover:border-green-500 hover:bg-green-500/20 dark:hover:bg-green-950/60 shadow-lg' : ''}
                                    ${isError ? 'bg-red-500/10 dark:bg-red-900/20 text-red-600 dark:text-red-500 border-red-300 dark:border-red-500 hover:bg-red-500/20 dark:hover:bg-red-900/40' : ''}
                                    ${!isRunning && !isSuccess && !isError && connected ? 'bg-sim-border border-sim-border text-sim-text hover:bg-sim-selection hover:border-sim-red/50 hover:text-sim-red' : ''}
                                `}
                                title={connected ? 'Run cell (Shift+Enter)' : 'Kernel not connected'}
                            >
                                <Play className="w-3.5 h-3.5 fill-current" />
                            </button>
                        )}

                        {/* Elapsed timer — only shown once the kernel has actually started */}
                        {(isRunning || isStopping) && execInfo?.runStartTime != null && (
                            <div className="flex flex-col items-center mt-1">
                                <span className={`text-[10px] font-mono tabular-nums ${isStopping ? 'text-sim-redHover' : 'text-green-400'}`}>
                                    {isStopping ? 'Stopping' : (elapsedMs < 1 ? '0ms' : formatDuration(elapsedMs))}
                                </span>
                            </div>
                        )}

                        {/* Queued position */}
                        {isQueued && (
                            <div className="flex flex-col items-center mt-1">
                                <span className="text-[10px] font-mono text-yellow-500">Queue</span>
                            </div>
                        )}

                        {/* Success indicator + execution count (VS Code: [1] counter) */}
                        {isSuccess && !isRunning && (
                            <div className="flex flex-col items-center mt-1" title={duration ? `Executed in ${formatSeconds(duration)}` : ''}>
                                <CheckCircle2 className="w-3 h-3 text-green-500 mb-0.5" />
                                {duration != null && (
                                    <span className="text-[10px] font-mono text-gray-400">{formatSeconds(duration)}</span>
                                )}
                            </div>
                        )}

                        {/* Error indicator */}
                        {isError && !isRunning && (
                            <div className="flex flex-col items-center mt-1">
                                <XCircle className="w-3 h-3 text-red-500 mb-0.5" />
                                {duration != null && duration > 0 && (
                                    <span className="text-[10px] font-mono text-red-400">{formatSeconds(duration)}</span>
                                )}
                            </div>
                        )}

                        {/* Execution count [N] — from kernel, mirrors VS Code's executionOrder */}
                        {executionCount != null && !isRunning && !isStopping && !isQueued && (
                            <span className="text-[9px] font-mono text-gray-600 mt-0.5">[{executionCount}]</span>
                        )}
                    </div>
                </div>
            )}

            {/* Editor + Output */}
            <div className="flex-1 min-w-0 flex flex-col gap-3">
                {isCode ? (
                    <MonacoCellEditor
                        value={cell.content}
                        onChange={(val: string) => onUpdate(cell.id, val)}
                        onRun={runCell}
                        onActivate={onActivate}
                        notebookId={notebookId}
                        isActive={isActive}
                        allCells={allCells}
                        cellIndex={index}
                    />
                ) : (
                    <TextCell
                        content={cell.content}
                        isActive={isActive}
                        onUpdate={(content) => onUpdate(cell.id, content)}
                        onActivate={onActivate}
                        onDeactivate={onDeactivate}
                    />
                )}

                {/* Output section — delegated to CellOutputView (VS Code: CellOutputPart) */}
                {isCode && (
                    <CellOutputView
                        cellId={cell.id}
                        persistedOutputs={cell.outputs}
                        persistedText={cell.output}
                        persistedError={cell.error}
                        onStdinSubmit={handleStdinSubmit}
                    />
                )}

                {/* Fix error button (shown when state is error) */}
                {isCode && isError && cell.error && onFixError && (
                    <div className="flex items-center gap-2 mt-1">
                        <button
                            onClick={handleFixError}
                            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-sim-surface border border-sim-border shadow-xl hover:bg-sim-bg transition-colors"
                        >
                            <Wrench className="w-3 h-3 text-red-400" />
                            <span className="text-sm text-red-400">Fix in Chat</span>
                        </button>
                    </div>
                )}
            </div>

            {/* Hover toolbar */}
            <div
                className={`absolute right-4 top-2 flex items-center gap-1 p-1 rounded-full bg-sim-surface border border-sim-border shadow-xl transition-all duration-200 z-30
                    ${isHovered && !isDragOver ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'}`}
            >
                <ToolBtn icon={ArrowUp} onClick={() => onMoveUp(cell.id)} label="Up" />
                <ToolBtn icon={ArrowDown} onClick={() => onMoveDown(cell.id)} label="Down" />
                <div className="w-[1px] h-4 bg-sim-border mx-1" />
                <ToolBtn icon={Trash2} onClick={() => onDelete(cell.id)} label="Delete" danger />
                <ToolBtn icon={MoreHorizontal} onClick={() => { }} label="More" />
            </div>
        </div>
    );
}, (prev, next) => {
    // Custom comparison — Cell only re-renders when content or active state changes.
    // Execution state is read from Zustand store directly (no prop needed).
    return (
        prev.cell.id === next.cell.id &&
        prev.cell.content === next.cell.content &&
        prev.cell.type === next.cell.type &&
        prev.cell.output === next.cell.output &&
        prev.cell.outputs === next.cell.outputs &&
        prev.cell.error === next.cell.error &&
        prev.cell.executionCount === next.cell.executionCount &&
        prev.isActive === next.isActive &&
        prev.index === next.index &&
        prev.connected === next.connected
    );
});

Cell.displayName = 'Cell';
