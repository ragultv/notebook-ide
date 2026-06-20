/**
 * CellOutputView.tsx
 *
 * VS Code equivalent: CellOutputPart
 * (src/vs/workbench/contrib/notebook/browser/view/cellParts/cellOutput.ts)
 *
 * KEY ARCHITECTURAL PRINCIPLE:
 *   This component manages its OWN streaming output buffer.
 *   It NEVER calls setCells() / onOutputUpdate() during streaming.
 *   It subscribes directly to WS events via useNotebookWS().on().
 *
 *   VS Code does the same: CellOutputPart directly observes
 *   NotebookCellTextModel.onDidChangeOutputs and appends to its own
 *   DOM list — it never triggers a full notebook re-render.
 *
 * Lifecycle:
 *   1. When execution starts (executionId changes), buffer is cleared
 *   2. 'output' WS messages are appended to local buffer ref
 *   3. A version counter triggers minimal rerender (only this component)
 *   4. On completion (state → success/error), switch to persisted cell.outputs
 *
 * This is the fix for:
 *   - Lag/flicker: setCells() was called on EVERY streaming chunk
 *   - Choppy output: full React tree was reconciling on every output line
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { CellOutput } from '../../../types';
import { useNotebookWS } from '../NotebookWSContext';
import { useExecutionStore, CellExecState } from '../../../store/execution.store';
import { OutputItem } from './OutputItem';
import { AnsiRenderer, stripAnsi } from './AnsiRenderer';
import { Terminal, CornerDownLeft } from 'lucide-react';

// ── Debounced batch flush (mirrors VS Code's TimeoutBasedCollector, 16ms) ────
// Instead of calling setState on every single chunk, we batch them and flush
// at most once per animation frame.
function useBatchedState<T>(initial: T): [T, (updater: (prev: T) => T) => void] {
    const [state, setState] = useState<T>(initial);
    const pendingRef = useRef<((prev: T) => T) | null>(null);
    const rafRef = useRef<number | null>(null);

    const batchedSet = useCallback((updater: (prev: T) => T) => {
        // Compose updaters
        const prev = pendingRef.current;
        if (prev) {
            pendingRef.current = (s: T) => updater(prev(s));
        } else {
            pendingRef.current = updater;
        }

        if (rafRef.current === null) {
            rafRef.current = requestAnimationFrame(() => {
                rafRef.current = null;
                const fn = pendingRef.current;
                pendingRef.current = null;
                if (fn) setState(fn);
            });
        }
    }, []);

    useEffect(() => () => {
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    }, []);

    return [state, batchedSet];
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface CellOutputViewProps {
    cellId: string;
    /** Persisted outputs from shared state — shown after completion */
    persistedOutputs?: CellOutput[];
    /** Persisted plain-text output (legacy) */
    persistedText?: string;
    /** Persisted error from shared state */
    persistedError?: string;
    /** Called when user submits stdin input */
    onStdinSubmit: (executionId: string, value: string) => void;
}

// ── CellOutputView ─────────────────────────────────────────────────────────────

export const CellOutputView: React.FC<CellOutputViewProps> = React.memo(({
    cellId,
    persistedOutputs,
    persistedText,
    persistedError,
    onStdinSubmit,
}) => {
    // Live streaming buffer — NOT in React state, to avoid unnecessary renders
    const bufferRef = useRef<CellOutput[]>([]);
    // Trigger a rerender of only this component when buffer changes
    const [, setBatchVersion] = useBatchedState(0);

    // Execution state from Zustand — only this cell's state is subscribed
    const execInfo = useExecutionStore(s => s.cells[cellId]);
    const state: CellExecState = execInfo?.state ?? 'idle';
    const executionId = execInfo?.executionId ?? null;

    const { on, sendStdin } = useNotebookWS();

    // Input prompt state
    const [inputRequest, setInputRequest] = useState<{
        executionId: string;
        prompt: string;
        password: boolean;
    } | null>(null);
    const [inputValue, setInputValue] = useState('');

    // Scroll ref
    const outputContainerRef = useRef<HTMLDivElement>(null);

    // ── Race condition fix: one-frame delay before switching to persisted outputs ──
    // When state transitions running→success/error, the last batch of output chunks
    // may still be pending in the RAF queue (useBatchedState). Without this delay,
    // the component switches to persistedOutputs before the last chunks render.
    const [completionDelay, setCompletionDelay] = useState(false);
    const completionRafRef = useRef<number | null>(null);
    useEffect(() => {
        if (state === 'success' || state === 'error') {
            // Stay in live mode for one more frame to let RAF buffer flush
            setCompletionDelay(true);
            completionRafRef.current = requestAnimationFrame(() => {
                completionRafRef.current = null;
                setCompletionDelay(false);
            });
        }
        return () => {
            if (completionRafRef.current !== null) {
                cancelAnimationFrame(completionRafRef.current);
            }
        };
    }, [state]);

    // ── Clear buffer when a new execution starts ─────────────────────────────
    const prevExecIdRef = useRef<string | null>(null);
    useEffect(() => {
        if (executionId && executionId !== prevExecIdRef.current) {
            prevExecIdRef.current = executionId;
            bufferRef.current = [];
            setInputRequest(null);
            setInputValue('');
            setBatchVersion(v => v + 1);
        }
    }, [executionId]);

    // Also clear on idle (after kernel restart / cell cancel)
    useEffect(() => {
        if (state === 'idle') {
            bufferRef.current = [];
            setInputRequest(null);
        }
    }, [state]);

    // ── Subscribe to WS output events (streaming) ────────────────────────────
    // This mirrors CellOutputPart observing NotebookCellTextModel.onDidChangeOutputs.
    // We filter by executionId so we only accumulate output for the current run.
    useEffect(() => {
        const cleanups: (() => void)[] = [];

        cleanups.push(on('output', (msg: any) => {
            if (msg.execution_id !== executionId) return;
            const output = msg.output;
            if (!output) return;

            let chunk: CellOutput | null = null;
            if (output.type === 'stream') {
                chunk = { type: 'stream', data: output.data, stream: output.stream };
            } else if (output.type === 'result' || output.type === 'display') {
                chunk = { type: output.type, data: output.data };
            } else if (output.type === 'error') {
                // Preserve structured error so OutputItem can use TracebackRenderer
                chunk = {
                    type: 'error',
                    data: `${output.ename}: ${output.evalue}`,
                    ename: output.ename,
                    evalue: output.evalue,
                    traceback: output.traceback ?? [],
                } as any;
            }

            if (chunk) {
                bufferRef.current = [...bufferRef.current, chunk];
                // Batched rerender — at most once per animation frame
                setBatchVersion(v => v + 1);
            }
        }));

        cleanups.push(on('input_request', (msg: any) => {
            if (msg.execution_id !== executionId) return;
            setInputRequest({
                executionId: msg.execution_id,
                prompt: msg.prompt || '> ',
                password: msg.password || false,
            });
        }));

        // Widget comm events (re-broadcast to widget service via existing handlers in Cell.tsx)
        // These are handled at Cell level — we don't duplicate here.

        return () => cleanups.forEach(c => c());
    }, [on, executionId]);

    // ── Auto-scroll while streaming ──────────────────────────────────────────
    useEffect(() => {
        if (outputContainerRef.current && (state === 'running' || state === 'stopping')) {
            const el = outputContainerRef.current;
            const threshold = 150;
            if (el.scrollHeight - el.scrollTop - el.clientHeight <= threshold) {
                el.scrollTop = el.scrollHeight;
            }
        }
    }, [bufferRef.current.length, state]);

    // ── Determine what to display ─────────────────────────────────────────────
    // During running: show live buffer.
    // After completion: wait one RAF (completionDelay) then switch to persisted outputs.
    // This ensures the last streaming chunks are rendered before the handoff.
    const isLive = state === 'running' || state === 'stopping' || state === 'queued' || completionDelay;
    const displayOutputs: CellOutput[] = isLive
        ? bufferRef.current
        : (persistedOutputs ?? []);

    const hasOutput =
        isLive ||
        displayOutputs.length > 0 ||
        !!persistedText ||
        state === 'error';

    if (!hasOutput) return null;

    // ── Input submit ─────────────────────────────────────────────────────────
    const handleInputSubmit = () => {
        if (!inputRequest) return;
        onStdinSubmit(inputRequest.executionId, inputValue);
        // Echo
        if (!inputRequest.password) {
            bufferRef.current = [...bufferRef.current, {
                type: 'text',
                data: inputValue + '\n',
                stream: 'stdout',
            }];
            setBatchVersion(v => v + 1);
        }
        setInputRequest(null);
        setInputValue('');
    };

    // ── Status badge ─────────────────────────────────────────────────────────
    const renderStatusBadge = () => {
        if (state === 'running' || state === 'stopping') {
            return (
                <>
                    <div className={`w-1.5 h-1.5 rounded-full ${state === 'stopping' ? 'bg-sim-redHover animate-pulse' : 'bg-green-500 animate-ping'}`} />
                    <span className={`text-[10px] font-mono font-semibold tracking-widest uppercase ${state === 'stopping' ? 'text-sim-redHover' : 'text-green-400'}`}>
                        {state === 'stopping' ? 'Stopping...' : 'Running'}
                    </span>
                </>
            );
        }
        if (state === 'queued') {
            return (
                <>
                    <div className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
                    <span className="text-[10px] text-yellow-400 font-mono tracking-widest uppercase">Queued</span>
                </>
            );
        }
        if (state === 'error') {
            return (
                <>
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                    <span className="text-[10px] text-red-400 font-mono tracking-widest uppercase">Error</span>
                </>
            );
        }
        const execCount = execInfo?.executionCount;
        const duration = execInfo?.duration;
        const fmtDuration = duration != null ? formatDuration(duration * 1000) : null;
        return (
            <>
                <div className="w-1.5 h-1.5 rounded-full bg-green-500/50" />
                <span className="text-[10px] text-gray-600 font-mono tracking-widest uppercase">
                    Output {execCount ? `[${execCount}]` : ''}
                </span>
                {fmtDuration && (
                    <span className="ml-auto text-[10px] text-gray-700 font-mono">{fmtDuration}</span>
                )}
            </>
        );
    };

    return (
        <div className="text-sm font-mono rounded-xl bg-black/40 border border-white/5 shadow-inner overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-1.5 border-b border-white/5 bg-black/20">
                {renderStatusBadge()}
            </div>

            {/* Output area */}
            <div ref={outputContainerRef} className="max-h-[500px] overflow-y-auto p-4 space-y-0.5">
                {displayOutputs.map((output, idx) => (
                    <OutputItem key={idx} output={output} />
                ))}

                {/* Fallback plain-text output */}
                {!isLive && !displayOutputs.length && persistedText && state !== 'error' && (
                    <div className="text-gray-300 whitespace-pre-wrap break-words text-[13px] leading-5">{persistedText}</div>
                )}

                {/* Error output — render with ANSI colors (tracebacks have escape codes) */}
                {state === 'error' && persistedError && (
                    <div className="mt-2 bg-red-950/20 p-3 rounded-lg border border-red-500/20 overflow-x-auto">
                        <AnsiRenderer
                            text={persistedError}
                            className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.55]"
                            defaultColor="#f87171"
                        />
                    </div>
                )}

                {/* stdin input prompt */}
                {inputRequest && (
                    <div className="mt-4 p-4 bg-black/40 border border-white/10 rounded-xl flex flex-col gap-3 group transition-all">
                        <div className="flex items-center gap-2 mb-1">
                            <Terminal className="w-3.5 h-3.5 text-gray-400 group-focus-within:text-blue-400 transition-colors" />
                            <span className="text-[12px] text-gray-200 font-medium">{inputRequest.prompt}</span>
                        </div>
                        <div className="relative">
                            <input
                                type={inputRequest.password ? 'password' : 'text'}
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleInputSubmit()}
                                autoFocus
                                className="w-full bg-black/40 border border-white/10 focus:border-blue-500/50 rounded-lg px-3 py-2 text-[13px] text-white font-mono outline-none transition-all placeholder:text-gray-600 shadow-inner"
                                placeholder="Type response and press Enter..."
                            />
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 opacity-40 group-focus-within:opacity-100 transition-opacity">
                                <span className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">Press Enter</span>
                                <CornerDownLeft className="w-3 h-3 text-gray-500" />
                            </div>
                        </div>
                    </div>
                )}

                <div style={{ height: 1 }} />
            </div>
        </div>
    );
});

CellOutputView.displayName = 'CellOutputView';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
    if (ms < 1) return '<1ms';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(2)}s`;
    return `${Math.floor(s / 60)}m ${(s % 60).toFixed(1)}s`;
}
