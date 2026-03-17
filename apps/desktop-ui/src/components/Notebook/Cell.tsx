import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Play, Trash2, ArrowUp, ArrowDown, MoreHorizontal, Wrench, CheckCircle2, XCircle, Clock, GripVertical, Loader2, Zap, ChevronDown } from 'lucide-react';
import { CellData, CellStatus, CellOutput } from '../../types';
import { TerminalOutput } from './TerminalOutput';
import { controllerClient, RichOutput } from '../../services/controller.client';
import { useUIStore } from '../../store/ui.store';
import { TextCell } from './TextCell';
import { MonacoCellEditor } from './MonacoCellEditor';

interface CellProps {
  cell: CellData;
  index: number;
  notebookId: string;
  notebookName: string;
  isActive: boolean;
  onActivate: () => void;
  onDeactivate?: () => void;
  onUpdate: (id: string, content: string) => void;
  onOutputUpdate: (id: string, output: string, status: CellStatus, error?: string, execCount?: number, outputs?: CellOutput[], duration?: number) => void;
  onDelete: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onMove?: (from: number, to: number) => void;
  onFixError?: (cellIndex: number, error: string, cellContent: string, cellId: string) => void;
  allCells?: CellData[];
}

// ── helpers ────────────────────────────────────────────────────────────────────

const parseErrorLine = (error: string | undefined): number | null => {
  if (!error) return null;
  const match = error.match(/line (\d+)/i);
  return match ? parseInt(match[1], 10) : null;
};

const simpleFallbackHighlight = (code: string) => {
  let html = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  html = html.replace(/\b(def|class|return|if|else|elif|while|for|in|import|from|as|try|except|finally|with|lambda|async|await)\b/g, '<span style="color:#c678dd">$1</span>');
  html = html.replace(/\b(print|len|range|str|int|float|list|dict|set|tuple|type|isinstance)\b/g, '<span style="color:#61afef">$1</span>');
  html = html.replace(/\b(\d+)\b/g, '<span style="color:#d19a66">$1</span>');
  html = html.replace(/('.*?'|".*?")/g, '<span style="color:#98c379">$1</span>');
  html = html.replace(/(#.*)/g, '<span style="color:#5c6370;font-style:italic">$1</span>');
  return html;
};

// ── OutputItem ────────────────────────────────────────────────────────────────

const OutputItem: React.FC<{ output: CellOutput }> = ({ output }) => {
  if (output.type === 'image' && output.data) {
    return (
      <div className="flex justify-center py-2">
        <img src={`data:${output.mimeType || 'image/png'};base64,${output.data}`} alt="Output" className="max-w-full h-auto rounded-lg shadow-sm" />
      </div>
    );
  }
  if (output.type === 'html' && output.data) {
    return <div className="prose prose-invert max-w-full" dangerouslySetInnerHTML={{ __html: output.data }} />;
  }
  return (
    <div className={`whitespace-pre-wrap break-words font-mono text-[13px] leading-5 ${output.stream === 'stderr' ? 'text-yellow-300' : 'text-gray-300'}`}>
      {output.data}
    </div>
  );
};

// ── ToolBtn ────────────────────────────────────────────────────────────────────

const ToolBtn: React.FC<{ icon: React.ComponentType<any>; onClick: (e: any) => void; label: string }> = ({ icon: Icon, onClick, label }) => (
  <button onClick={(e) => { e.stopPropagation(); onClick(e); }} title={label} className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-full transition-colors">
    <Icon className="w-4 h-4" />
  </button>
);

// ── Running-line gutter icon ───────────────────────────────────────────────────
// Shows a solid green ▶ next to whichever line is currently executing.
// currentLine is 1-indexed; undefined means we don't know (just pulse everything).

const GutterRunIcon: React.FC<{ lineNum: number; currentLine: number | null; isRunning: boolean }> = ({
  lineNum, currentLine, isRunning,
}) => {
  const isThis = isRunning && (currentLine === null ? lineNum === 1 : currentLine === lineNum);
  if (!isRunning) return null;
  if (currentLine !== null && currentLine !== lineNum) return null;
  // If currentLine is null (no tracking from backend) show a dot on line 1 only
  if (currentLine === null && lineNum !== 1) return null;

  return (
    <span
      className="inline-flex items-center justify-center w-full h-[1.6rem]"
      title={`Executing line ${lineNum}`}
    >
      {/* Solid filled dark-green play triangle */}
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M1.5 1 L9 5 L1.5 9 Z" fill="#22c55e" />
      </svg>
    </span>
  );
};

// ── Cell ──────────────────────────────────────────────────────────────────────

export const Cell: React.FC<CellProps> = ({
  cell, index, notebookId, notebookName,
  isActive, onActivate, onDeactivate,
  onUpdate, onOutputUpdate,
  onDelete, onMoveUp, onMoveDown, onMove,
  onFixError, allCells,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showFixPopover, setShowFixPopover] = useState(false);

  // Input states
  const [isWaitingForInput, setIsWaitingForInput] = useState(false);
  const [inputPrompt, setInputPrompt] = useState('');
  const [inputValue, setInputValue] = useState('');

  // Streaming: live chunks appearing character by character like Jupyter
  const [streamingChunks, setStreamingChunks] = useState<CellOutput[]>([]);
  // Current executing line (1-indexed), null = backend doesn't send it
  const [currentLine, setCurrentLine] = useState<number | null>(null);
  // Live elapsed time while cell is running (ms)
  const [elapsedMs, setElapsedMs] = useState(0);
  // Animated sweep line index (when backend sends no line info)
  const [animatedLine, setAnimatedLine] = useState(1);

  const startTimeRef = useRef<number>(0);
  const cancelStreamRef = useRef<(() => void) | null>(null);
  const outputEndRef = useRef<HTMLDivElement>(null);

  const { kernelStatus, setKernelStatus, runtimeType, kernelLanguage } = useUIStore();
  const device = runtimeType === 'gpu' ? 'cuda' : 'cpu';

  const errorLine = useMemo(() => parseErrorLine(cell.error), [cell.error]);
  const codeLines = useMemo(() => cell.content.split('\n'), [cell.content]);
  const isCode = cell.type === 'code';
  const isRunning = cell.status === 'running';

  // Combine: during running show streaming chunks live; after completion show cell.outputs
  const displayOutputs = isRunning ? streamingChunks : (cell.outputs ?? []);

  // Compute terminal mode dynamically based on current output state or cell prefix
  const isTerminalMode = useMemo(() => {
    return displayOutputs.some(o => o.type === 'terminal_output') ||
      (cell.content.trim().startsWith('!'));
  }, [displayOutputs, cell.content]);



  // Auto-scroll streaming output
  useEffect(() => {
    if (outputEndRef.current && isRunning) {
      outputEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [streamingChunks, isRunning]);

  // ── Live elapsed timer while running ───────────────────────────────────────
  useEffect(() => {
    if (!isRunning) { setElapsedMs(0); return; }
    startTimeRef.current = performance.now();
    const interval = setInterval(() => {
      setElapsedMs(Math.round(performance.now() - startTimeRef.current));
    }, 100);
    return () => clearInterval(interval);
  }, [isRunning]);

  // ── Animated line indicator (when backend doesn't send line info) ───────────
  // Sweeps through code lines at ~1.5s/line so the gutter looks alive.
  // If the backend DOES send real line numbers (currentLine != null), we use those.
  useEffect(() => {
    if (!isRunning || currentLine !== null) { setAnimatedLine(1); return; }
    const nonEmptyCount = Math.max(1, codeLines.filter(l => l.trim()).length);
    setAnimatedLine(1);
    const interval = setInterval(() => {
      setAnimatedLine(prev => prev < nonEmptyCount ? prev + 1 : nonEmptyCount);
    }, 1500);
    return () => clearInterval(interval);
  }, [isRunning, currentLine, codeLines]);

  // ── Run ──

  const runCell = async () => {
    if (cell.type === 'markdown') return;
    if (!cell.content.trim()) return;
    if (cancelStreamRef.current) cancelStreamRef.current();

    setStreamingChunks([]);
    setCurrentLine(null);
    setElapsedMs(0);
    setAnimatedLine(1);
    onOutputUpdate(cell.id, '', 'running', undefined, undefined, [], undefined);
    setKernelStatus('busy');

    console.log('[Cell] running using kernelLanguage=', kernelLanguage);
    if (kernelLanguage === 'mojo') {
      // Mojo backend currently doesn't stream, so we execute and wait for completion.
      try {
        const result = await controllerClient.runMojoCell(notebookId, cell.content);
        const outputs = result.output ? [{ type: 'terminal_output', data: result.output }] : [];
        if (result.success) {
          onOutputUpdate(cell.id, result.output || '', 'success', undefined, undefined, outputs, undefined);
          setKernelStatus('idle');
        } else {
          onOutputUpdate(cell.id, '', 'error', result.error || 'Mojo execution failed', undefined, outputs, undefined);
          setKernelStatus('error');
        }
      } catch (error) {
        onOutputUpdate(cell.id, '', 'error', (error as Error).message);
        setKernelStatus('error');
      }

      setStreamingChunks([]);
      setCurrentLine(null);
      setIsWaitingForInput(false);
      cancelStreamRef.current = null;
    } else {
      const cancel = controllerClient.runCellStream(
        { cellId: cell.id, code: cell.content, notebookId, device },
        // onOutput — each SSE chunk: append immediately for live streaming
        (output: RichOutput & { line?: number }) => {
          // Backend may optionally send line number hint
          if (output.line !== undefined) setCurrentLine(output.line);

          if (output.type === 'input_request') {
            setIsWaitingForInput(true);
            setInputPrompt(output.prompt || '');
          } else if (output.type === 'terminal_output') {
            setStreamingChunks(prev => [...prev, output as CellOutput]);
          } else {
            setStreamingChunks(prev => [...prev, output as CellOutput]);
          }
        },
        // onComplete — final result
        (result) => {
          const outputs = result.outputs?.length ? result.outputs : undefined;
          if (result.success) {
            onOutputUpdate(cell.id, result.output || '', 'success', undefined, result.executionCount, outputs, result.duration);
          } else {
            onOutputUpdate(cell.id, '', 'error', result.error, result.executionCount, outputs, result.duration);
          }
          setKernelStatus('idle');
          setStreamingChunks([]);
          setCurrentLine(null);
          setIsWaitingForInput(false);
          cancelStreamRef.current = null;
        },
        (error) => {
          onOutputUpdate(cell.id, '', 'error', error);
          setKernelStatus('error');
          setStreamingChunks([]);
          setCurrentLine(null);
          setIsWaitingForInput(false);
          cancelStreamRef.current = null;
        }
      );
      cancelStreamRef.current = cancel;
    }
  };

  const handleInputSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsWaitingForInput(false);

    // Echo the input into the stream display manually, like a real terminal
    setStreamingChunks(prev => [...prev, {
      type: 'stream',
      stream: 'stdout',
      data: `${inputPrompt}${inputValue}\n`
    } as CellOutput]);

    const value = inputValue;
    setInputValue('');
    setInputPrompt('');

    try {
      await controllerClient.sendInput(notebookId, value);
    } catch (err) {
      console.error("Failed to send input", err);
    }
  };

  // ── Fix Error ──

  const handleFixError = async (mode: 'chat' | 'auto') => {
    if (!onFixError || !cell.error) return;
    if (mode === 'chat') {
      setShowFixPopover(false);
      onFixError(index + 1, cell.error, cell.content, cell.id);
    } else {
      setIsFixing(true);
      setShowFixPopover(false);
      try {
        const response = await controllerClient.fixError({
          cellIndex: index + 1,
          error: cell.error,
          cellContent: cell.content,
          context: { notebookName },
        });
        let fixedCode = response.text;
        const match = fixedCode.match(/```(?:python)?\s*([\s\S]*?)\s*```/);
        if (match?.[1]) fixedCode = match[1].trim();
        onUpdate(cell.id, fixedCode);
      } catch (err) {
        onFixError(index + 1, cell.error + `\n\n(Auto-fix failed: ${err})`, cell.content, cell.id);
      } finally {
        setIsFixing(false);
      }
    }
  };

  // ── Duration formatting ──

  const formatDuration = (ms: number) => {
    // Input is now milliseconds from elapsedMs or seconds*1000 from backend
    if (ms < 1) return '<1ms';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(2)}s`;
    return `${Math.floor(s / 60)}m ${(s % 60).toFixed(1)}s`;
  };

  // Backend sends duration in seconds; convert to ms for display
  const formatBackendDuration = (s: number) => {
    if (s === 0) return '0ms';
    return formatDuration(s * 1000);
  };

  // The display line while running — real from backend or animated fallback
  const displayLine = currentLine ?? animatedLine;


  // ── Drag ──

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'cell-drag', index: index + 1, cellId: cell.id, notebookId, notebookName, content: cell.content, cellType: cell.type,
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

  const hasOutput = isRunning || displayOutputs.length > 0 || !!cell.output || cell.status === 'error';

  return (
    <div
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
        <GripVertical className="w-4 h-4 text-gray-400 hover:text-white" />
      </div>

      {/* Gutter / Controls */}
      {isCode && (
        <div className="w-10 flex-shrink-0 flex flex-col items-center py-1 select-none z-20 sticky top-2 self-start h-fit">
          <div className="flex flex-col items-center gap-2">
            {/* Run / Stop button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (cell.status === 'running') {
                  controllerClient.interrupt(notebookId).catch(console.error);
                } else {
                  runCell();
                }
              }}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-md border
                ${cell.status !== 'running' && cell.status !== 'success' ? 'bg-[#2b2b2e] border-white/10 hover:bg-white hover:text-black group/btn' : ''}
                ${cell.status === 'running' ? 'bg-red-900/20 text-red-500 border-red-500 hover:bg-red-900/40 hover:scale-105' : ''}
                ${cell.status === 'success' ? 'bg-green-950/40 text-green-500 border-green-800 hover:border-green-500 shadow-lg shadow-green-950/50' : ''}
                ${cell.status === 'error' ? 'bg-red-900/20 text-red-500 border-red-500' : ''}
              `}
              title={cell.status === 'running' ? "Interrupt Execution" : "Run cell (Shift+Enter)"}
            >
              {cell.status === 'running'
                ? <div className="w-2.5 h-2.5 bg-red-500 rounded-sm" />
                : <Play className="w-3.5 h-3.5 fill-current" />
              }
            </button>
            {cell.status === 'running' && (
              <div className="flex flex-col items-center mt-1">
                <span className="text-[10px] font-mono text-green-400 tabular-nums">
                  {formatDuration(elapsedMs)}
                </span>
              </div>
            )}
            {cell.status === 'success' && (
              <div className="flex flex-col items-center mt-1" title={`Executed in ${formatBackendDuration(cell.duration || 0)}`}>
                <CheckCircle2 className="w-3 h-3 text-green-500 mb-0.5" />
                <span className="text-[10px] font-mono text-gray-400">{formatBackendDuration(cell.duration || 0)}</span>
              </div>
            )}
            {cell.status === 'error' && (
              <div className="flex flex-col items-center mt-1">
                <XCircle className="w-3 h-3 text-red-500 mb-0.5" />
                {(cell.duration ?? 0) > 0 && (
                  <span className="text-[10px] font-mono text-red-400">{formatBackendDuration(cell.duration || 0)}</span>
                )}
              </div>
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

        {/* ── Output Section ── */}
        {isCode && hasOutput && (
          <div className="text-sm font-mono rounded-xl bg-black/40 border border-white/5 shadow-inner overflow-hidden">
            {/* Jupyter-style output header bar */}
            <div className="flex items-center gap-2 px-4 py-1.5 border-b border-white/5 bg-black/20">
              {isRunning ? (
                <>
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-ping" />
                  <span className="text-[10px] text-green-400 font-mono font-semibold tracking-widest uppercase">
                    {currentLine !== null ? `Running · line ${currentLine}` : 'Running'}
                  </span>
                </>
              ) : cell.status === 'error' ? (
                <>
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                  <span className="text-[10px] text-red-400 font-mono tracking-widest uppercase">Error</span>
                </>
              ) : (
                <>
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500/50" />
                  <span className="text-[10px] text-gray-600 font-mono tracking-widest uppercase">
                    Output {cell.executionCount ? `[${cell.executionCount}]` : ''}
                  </span>
                  {cell.duration !== undefined && (
                    <span className="ml-auto text-[10px] text-gray-700 font-mono">{formatBackendDuration(cell.duration)}</span>
                  )}
                </>
              )}
            </div>

            {/* Scrollable output area — chunks appear live during streaming */}
            {isTerminalMode ? (
              <TerminalOutput
                notebookId={notebookId}
                streamData={displayOutputs.map(o => o.data || '')}
                isRunning={isRunning}
              />
            ) : (
              <div className="max-h-[500px] overflow-y-auto p-4 space-y-0.5">
                {displayOutputs.map((output, idx) => (
                  <OutputItem key={idx} output={output} />
                ))}

                {/* Interactive Input Form */}
                {isWaitingForInput && (
                  <form onSubmit={handleInputSubmit} className="mt-2 flex items-center gap-2 font-mono text-sm bg-black/60 p-2 rounded-md border border-[#30363d] focus-within:border-[#58a6ff] transition-colors">
                    <span className="text-[#58a6ff] whitespace-pre">{inputPrompt}</span>
                    <input
                      type="text"
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      autoFocus
                      className="flex-1 bg-transparent text-[#e6edf3] outline-none border-none placeholder-gray-600"
                      placeholder="Type input and press Enter..."
                    />
                  </form>
                )}

                {/* Fallback: plain text output (non-streaming result) */}
                {!isRunning && !displayOutputs.length && cell.output && !cell.error && (
                  <div className="text-gray-300 whitespace-pre-wrap break-words text-[13px] leading-5">{cell.output}</div>
                )}

                {/* Error output */}
                {cell.status === 'error' && cell.error && (
                  <div className="text-red-400 whitespace-pre-wrap break-words text-[13px] leading-5 mt-2 bg-red-950/20 p-3 rounded-lg border border-red-500/20 overflow-x-auto">
                    {cell.error}
                  </div>
                )}

                {/* Fix with AI button */}
                {cell.status === 'error' && onFixError && (
                  <div className="relative mt-3">
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowFixPopover(!showFixPopover); }}
                      disabled={isFixing}
                      className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold bg-sim-red text-white rounded-full hover:bg-sim-redHover transition-colors shadow-lg shadow-red-900/50 disabled:opacity-50"
                    >
                      {isFixing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5" />}
                      {isFixing ? 'Processing...' : 'Fix with AI'}
                      <ChevronDown className={`w-3 h-3 transition-transform ${showFixPopover ? 'rotate-180' : ''}`} />
                    </button>

                    {showFixPopover && (
                      <div className="absolute left-0 bottom-full mb-2 flex bg-[#1e1e20] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden divide-x divide-white/10">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleFixError('chat'); }}
                          className="flex flex-col items-center gap-1.5 px-4 py-3 text-xs text-gray-300 hover:text-white hover:bg-white/5 transition-colors min-w-[100px]"
                        >
                          <div className="p-1.5 rounded-md bg-blue-500/10 text-blue-400"><MoreHorizontal className="w-4 h-4" /></div>
                          <div className="font-bold">Chat</div>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleFixError('auto'); }}
                          className="flex flex-col items-center gap-1.5 px-4 py-3 text-xs text-gray-300 hover:text-white hover:bg-white/5 transition-colors min-w-[100px]"
                        >
                          <div className="p-1.5 rounded-md bg-green-500/10 text-green-400"><Zap className="w-4 h-4" /></div>
                          <div className="font-bold">Auto-Fix</div>
                        </button>
                      </div>
                    )}
                    {showFixPopover && (
                      <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setShowFixPopover(false); }} />
                    )}
                  </div>
                )}

                {/* Scroll anchor */}
                <div ref={outputEndRef} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Toolbar (hover) */}
      <div
        className={`absolute right-4 top-2 flex items-center gap-1 p-1 rounded-full bg-[#2b2b2e] border border-white/10 shadow-xl transition-all duration-200 z-30
          ${(isActive || (isCode && isHovered)) && !isDragOver ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'}`}
      >
        <ToolBtn icon={ArrowUp} onClick={() => onMoveUp(cell.id)} label="Up" />
        <ToolBtn icon={ArrowDown} onClick={() => onMoveDown(cell.id)} label="Down" />
        <div className="w-[1px] h-4 bg-white/10 mx-1" />
        <ToolBtn icon={Trash2} onClick={() => onDelete(cell.id)} label="Delete" />
        <ToolBtn icon={MoreHorizontal} onClick={() => { }} label="More" />
      </div>
    </div >
  );
};
