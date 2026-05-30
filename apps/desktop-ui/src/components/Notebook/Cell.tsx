import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Play, Trash2, ArrowUp, ArrowDown, MoreHorizontal, Wrench, CheckCircle2, XCircle, GripVertical, Loader2, Zap, ChevronDown, StopCircle, Terminal, CornerDownLeft } from 'lucide-react';
import { CellData, CellStatus, CellOutput } from '../../types';
import { controllerClient } from '../../services/controller.client';
import { useUIStore } from '../../store/ui.store';
import { TextCell, renderMarkdown } from './TextCell';
import { MonacoCellEditor } from './MonacoCellEditor';
import { WidgetRenderer, extractWidgetInfo } from './WidgetRenderer';
import { handleCommOpen, handleCommMsg, handleCommClose } from '../../services/widget.service';
import { useNotebookWS } from './NotebookWSContext';

interface CellProps {
  cell: CellData;
  index: number;
  notebookId: string;
  notebookName: string;
  isActive: boolean;
  onActivate: () => void;
  onDeactivate?: () => void;
  onUpdate: (id: string, content: string) => void;
  onOutputUpdate: (
    id: string,
    output: string,
    status: CellStatus,
    error?: string,
    execCount?: number,
    outputs?: CellOutput[],
    duration?: number,
    /** Optional streaming chunk to append to cell.streamingOutputs in shared state */
    streamChunk?: CellOutput
  ) => void;
  onDelete: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onMove?: (from: number, to: number) => void;
  onFixError?: (cellIndex: number, error: string, cellContent: string, cellId: string) => void;
  allCells?: CellData[];
}

// ── Strip ANSI escape codes from strings so they render cleanly in <div> ──────

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

// ── OutputItem ────────────────────────────────────────────────────────────────

const OutputItem: React.FC<{ output: CellOutput }> = ({ output }) => {
  // Explicit widget type
  if (output.type === 'widget' && output.commId) {
    return <WidgetRenderer commId={output.commId} targetName={output.targetName} />;
  }
  if (output.type === 'image' && output.data) {
    return (
      <div className="flex justify-center py-2">
        <img src={`data:${output.mimeType || 'image/png'};base64,${output.data}`} alt="Output" className="max-w-full h-auto rounded-lg shadow-sm" />
      </div>
    );
  }
  if (output.type === 'html' && output.data) {
    // Check for widget view in HTML MIME bundle
    try {
      const dataObj = typeof output.data === 'string' ? {} : output.data;
      const widgetInfo = extractWidgetInfo(dataObj as Record<string, any>);
      if (widgetInfo) {
        return <WidgetRenderer commId={widgetInfo.modelId} />;
      }
    } catch (e) { }
    return <div className="prose prose-invert max-w-full" dangerouslySetInnerHTML={{ __html: output.data as string }} />;
  }

  if (output.type === 'text' || output.type === 'stream' || output.type === 'result' || output.type === 'display') {
    let displayText = output.data;

    // Evaluate rich MIME bundles sent in display_data or execute_result
    if (typeof displayText === 'object' && displayText !== null) {
      const bundle: any = displayText;

      // 1. Interactive Widgets
      if (bundle['application/vnd.jupyter.widget-view+json']) {
        const modelId = bundle['application/vnd.jupyter.widget-view+json']?.model_id;
        const htmlFallback = bundle['text/html'] as string | undefined;
        if (modelId) return <WidgetRenderer commId={modelId} htmlFallback={htmlFallback} />;
        return <div className="text-gray-400 text-sm italic p-2">[Widget — model not ready]</div>;
      }

      // 2. HTML
      if (bundle['text/html']) {
        return <div className="prose prose-invert max-w-full" dangerouslySetInnerHTML={{ __html: bundle['text/html'] }} />;
      }

      // 3. Images (PNG)
      if (bundle['image/png']) {
        return (
          <div className="flex justify-center py-2">
            <img src={`data:image/png;base64,${bundle['image/png']}`} alt="Output" className="max-w-full h-auto rounded-lg shadow-sm" />
          </div>
        );
      }

      // 4. Images (JPEG)
      if (bundle['image/jpeg']) {
        return (
          <div className="flex justify-center py-2">
            <img src={`data:image/jpeg;base64,${bundle['image/jpeg']}`} alt="Output" className="max-w-full h-auto rounded-lg shadow-sm" />
          </div>
        );
      }

      // 5. Images (SVG)
      if (bundle['image/svg+xml']) {
        return (
          <div className="flex justify-center py-2" dangerouslySetInnerHTML={{ __html: bundle['image/svg+xml'] }} />
        );
      }

      // 6. Markdown
      if (bundle['text/markdown']) {
        return (
          <div className="prose prose-invert prose-sm max-w-none text-gray-200 leading-relaxed font-sans"
            dangerouslySetInnerHTML={renderMarkdown(bundle['text/markdown'])}
          />
        );
      }

      // 7. LaTeX / Math
      if (bundle['text/latex']) {
        // Simple LaTeX render fallback using TextCell's renderMarkdown math syntax,
        // or just displaying the raw LaTeX cleanly
        return (
          <div className="font-mono text-yellow-500 py-2 overflow-x-auto whitespace-pre">
            {bundle['text/latex']}
          </div>
        );
      }

      // 8. JSON
      if (bundle['application/json']) {
        return (
          <div className="bg-[#1e1e20] p-3 rounded-lg border border-white/10 m-2 overflow-x-auto text-[13px] font-mono text-sim-red">
            <pre className="break-words whitespace-pre-wrap m-0">
              {JSON.stringify(bundle['application/json'], null, 2)}
            </pre>
          </div>
        );
      }

      // 9. Plain Text fallback
      if (bundle['text/plain']) {
        displayText = bundle['text/plain'];
      } else {
        displayText = JSON.stringify(bundle, null, 2);
      }
    }

    return (
      <div className={`whitespace-pre-wrap break-words font-mono text-[13px] leading-5 ${output.stream === 'stderr' ? 'text-yellow-300' : 'text-gray-300'}`}>
        {String(displayText)}
      </div>
    );
  }

  return (
    <div className="whitespace-pre-wrap break-words font-mono text-[13px] leading-5 text-gray-300">
      {String(output.data || '')}
    </div>
  );
};

// ── ToolBtn ───────────────────────────────────────────────────────────────────

const ToolBtn: React.FC<{ icon: React.ComponentType<any>; onClick: (e: any) => void; label: string; danger?: boolean }> = ({ icon: Icon, onClick, label, danger }) => (
  <button
    onClick={(e) => { e.stopPropagation(); onClick(e); }}
    title={label}
    className={`p-2 rounded-full transition-colors ${danger ? 'text-red-400 hover:text-white hover:bg-red-500/20' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
  >
    <Icon className="w-4 h-4" />
  </button>
);

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

  // Live elapsed time while cell is running (ms) — computed from cell.runStartTime
  // so it survives tab switches without resetting to zero.
  const [elapsedMs, setElapsedMs] = useState(0);
  // Input request state for input() prompts
  const [inputRequest, setInputRequest] = useState<{ executionId: string; prompt: string; password: boolean } | null>(null);
  const [inputValue, setInputValue] = useState('');
  // Active widgets for this cell
  const [activeWidgets, setActiveWidgets] = useState<Array<{ commId: string; targetName: string }>>([]);

  // Track current execution
  const currentExecIdRef = useRef<string | null>(null);
  const outputEndRef = useRef<HTMLDivElement>(null);

  const { setKernelStatus } = useUIStore();
  const isCode = cell.type === 'code';
  const isRunning = cell.status === 'running';
  const isQueued = cell.status === 'queued';
  const isStopping = cell.status === 'stopping';

  // ── Shared WebSocket from Notebook-level context (single connection per notebook) ─
  const { execute, interrupt, sendStdin, sendCommMsg, on, connected } = useNotebookWS();

  // ── Auto-scroll output while streaming ──────────────────────────────────────
  useEffect(() => {
    if (outputEndRef.current && isRunning) {
      outputEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [cell.streamingOutputs, isRunning]);

  // ── Live elapsed timer — resumes from cell.runStartTime after tab switch ─────
  useEffect(() => {
    if (!isRunning && !isStopping) { setElapsedMs(0); return; }
    // Compute initial elapsed from shared runStartTime (survives tab unmount)
    const startEpoch = cell.runStartTime ?? Date.now();
    const update = () => setElapsedMs(Date.now() - startEpoch);
    update(); // immediate paint
    const interval = setInterval(update, 100);
    return () => clearInterval(interval);
  }, [isRunning, isStopping, cell.runStartTime]);

  // ── Listen for WebSocket messages relevant to this cell ──────────────────────
  useEffect(() => {
    const cleanups: (() => void)[] = [];

    // Output chunks (stream, result, display)
    cleanups.push(on('output', (msg: any) => {
      if (msg.execution_id !== currentExecIdRef.current) return;
      const output = msg.output;
      if (!output) return;

      if (output.type === 'stream') {
        const chunk: CellOutput = { type: 'stream', data: output.data, stream: output.stream };
        // Append to shared cell state so output survives tab switches
        onOutputUpdate(cell.id, '', 'running', undefined, undefined, undefined, undefined, chunk);
      } else if (output.type === 'result' || output.type === 'display') {
        const chunk: CellOutput = { type: output.type, data: output.data };
        onOutputUpdate(cell.id, '', 'running', undefined, undefined, undefined, undefined, chunk);
      }
    }));

    // Execution complete (success)
    cleanups.push(on('execution_complete', (msg: any) => {
      if (msg.execution_id !== currentExecIdRef.current) return;
      const result = msg.result || {};
      const outputs = result.outputs?.length ? result.outputs as CellOutput[] : undefined;
      const duration = result.execution_time ? result.execution_time : undefined;
      onOutputUpdate(cell.id, result.output || '', 'success', undefined, result.executionCount, outputs, duration);
      setKernelStatus('idle');
      setInputRequest(null);
      currentExecIdRef.current = null;
    }));

    // Execution error
    cleanups.push(on('execution_error', (msg: any) => {
      if (msg.execution_id !== currentExecIdRef.current) return;
      const clean = stripAnsi(msg.error || 'Execution failed');
      onOutputUpdate(cell.id, '', 'error', clean, undefined, undefined, undefined);
      setKernelStatus('error');
      setInputRequest(null);
      currentExecIdRef.current = null;
    }));

    // Input prompt
    cleanups.push(on('input_request', (msg: any) => {
      if (msg.execution_id !== currentExecIdRef.current) return;
      setInputRequest({
        executionId: msg.execution_id,
        prompt: msg.prompt || '> ',
        password: msg.password || false,
      });
    }));

    // Widget comm messages — register models with widget.service so WidgetRenderer can find them.
    // Do NOT add to activeWidgets here: sub-widgets (Button, HTML, Label…) all emit comm_open.
    // Only ROOT widgets get displayed, and only via display_data MIME in the output stream above.
    cleanups.push(on('comm_open', async (msg: any) => {
      const commId = msg.comm_id;
      const targetName = msg.target_name;
      await handleCommOpen(commId, targetName, msg.data, msg.metadata,
        (cid: string, d: any) => sendCommMsg(cid, d));
    }));

    cleanups.push(on('comm_msg', (msg: any) => {
      handleCommMsg(msg.comm_id, msg.data);
    }));

    cleanups.push(on('comm_close', (msg: any) => {
      handleCommClose(msg.comm_id);
    }));

    return () => cleanups.forEach(c => c());
  }, [cell.id, on, onOutputUpdate, notebookId, setKernelStatus]);

  // ── Run ──────────────────────────────────────────────────────────────────────

  const runCell = useCallback(async () => {
    if (cell.type === 'markdown') return;
    if (!cell.content.trim()) return;

    setInputRequest(null);
    setInputValue('');
    setActiveWidgets([]);
    // Set running + record start time + clear previous streaming output
    onOutputUpdate(cell.id, '', 'running', undefined, undefined, [], undefined);
    setKernelStatus('busy');

    try {
      const execId = await execute(cell.id, cell.content);
      currentExecIdRef.current = execId;
    } catch (e) {
      onOutputUpdate(cell.id, '', 'error', 'Failed to start execution', undefined, [], undefined);
      setKernelStatus('error');
    }
  }, [cell.id, cell.type, cell.content, execute, onOutputUpdate, setKernelStatus]);

  // ── Input submission ──────────────────────────────────────────────────────────

  const handleInputSubmit = useCallback(() => {
    if (!inputRequest) return;
    sendStdin(inputRequest.executionId, inputValue);
    // Echo input to streaming output (except passwords)
    if (!inputRequest.password) {
      const echo: CellOutput = { type: 'text', data: inputValue + '\n', stream: 'stdout' };
      onOutputUpdate(cell.id, '', 'running', undefined, undefined, undefined, undefined, echo);
    }
    setInputRequest(null);
    setInputValue('');
  }, [inputRequest, inputValue, sendStdin, onOutputUpdate, cell.id]);

  // ── Interrupt ─────────────────────────────────────────────────────────────────

  const handleInterrupt = useCallback(() => {
    // Optimistic: immediately show 'stopping' so user gets instant feedback
    onOutputUpdate(cell.id, '', 'stopping', undefined, undefined, undefined, undefined);
    interrupt();
  }, [interrupt, cell.id, onOutputUpdate]);

  // ── Fix Error ──────────────────────────────────────────────────────────────────

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

  // ── Duration formatting ────────────────────────────────────────────────────────

  const formatDuration = (ms: number) => {
    if (ms < 1) return '<1ms';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(2)}s`;
    return `${Math.floor(s / 60)}m ${(s % 60).toFixed(1)}s`;
  };

  const formatBackendDuration = (s: number) => {
    if (s === 0) return '0ms';
    return formatDuration(s * 1000);
  };

  // ── Drag ──────────────────────────────────────────────────────────────────────

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

  // ── Render ────────────────────────────────────────────────────────────────────

  // Issue 5: Use shared cell.streamingOutputs (survives tab switches)
  const streamingChunks = cell.streamingOutputs ?? [];
  // During running show streaming chunks live; after completion show cell.outputs
  const displayOutputs = (isRunning || isStopping) ? streamingChunks : (cell.outputs ?? []);
  const hasOutput = isRunning || isStopping || isQueued || displayOutputs.length > 0 || !!cell.output || cell.status === 'error';

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
            {isRunning || isStopping ? (
              <button
                onClick={(e) => { e.stopPropagation(); if (!isStopping) handleInterrupt(); }}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-md border
                  ${isStopping
                    ? 'bg-orange-900/20 text-orange-400 border-orange-500 ring-2 ring-orange-500 cursor-not-allowed'
                    : 'bg-red-900/20 text-red-400 border-red-500 ring-2 ring-red-500 hover:bg-red-900/40'
                  }`}
                title={isStopping ? 'Stopping...' : 'Interrupt kernel'}
                disabled={isStopping}
              >
                {isStopping
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <StopCircle className="w-3.5 h-3.5" />}
              </button>
            ) : isQueued ? (
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center bg-yellow-900/20 text-yellow-500 border border-yellow-600"
                title="Queued — waiting for previous cell"
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              </div>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); runCell(); }}
                disabled={!connected}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-md border
                  ${!connected ? 'opacity-40 cursor-not-allowed bg-[#2b2b2e] border-white/10' : ''}
                  ${cell.status === 'success' ? 'bg-green-950/40 text-green-500 border-green-800 hover:border-green-500 shadow-lg shadow-green-950/50' : ''}
                  ${cell.status === 'error' ? 'bg-red-900/20 text-red-500 border-red-500' : ''}
                  ${cell.status !== 'running' && cell.status !== 'success' && cell.status !== 'error' && connected ? 'bg-[#2b2b2e] border-white/10 hover:bg-white hover:text-black' : ''}
                `}
                title={connected ? 'Run cell (Shift+Enter)' : 'Kernel not connected'}
              >
                <Play className="w-3.5 h-3.5 fill-current" />
              </button>
            )}

            {(isRunning || isStopping) && (
              <div className="flex flex-col items-center mt-1">
                <span className={`text-[10px] font-mono tabular-nums ${isStopping ? 'text-orange-400' : 'text-green-400'}`}>
                  {isStopping ? 'Stopping' : formatDuration(elapsedMs)}
                </span>
              </div>
            )}
            {isQueued && (
              <div className="flex flex-col items-center mt-1">
                <span className="text-[10px] font-mono text-yellow-500">Queue</span>
              </div>
            )}
            {cell.status === 'success' && !isRunning && (
              <div className="flex flex-col items-center mt-1" title={`Executed in ${formatBackendDuration(cell.duration || 0)}`}>
                <CheckCircle2 className="w-3 h-3 text-green-500 mb-0.5" />
                <span className="text-[10px] font-mono text-gray-400">{formatBackendDuration(cell.duration || 0)}</span>
              </div>
            )}
            {cell.status === 'error' && !isRunning && (
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
            {/* Header bar */}
            <div className="flex items-center gap-2 px-4 py-1.5 border-b border-white/5 bg-black/20">
              {isRunning || isStopping ? (
                <>
                  <div className={`w-1.5 h-1.5 rounded-full ${isStopping ? 'bg-orange-400 animate-pulse' : 'bg-green-500 animate-ping'}`} />
                  <span className={`text-[10px] font-mono font-semibold tracking-widest uppercase ${isStopping ? 'text-orange-400' : 'text-green-400'}`}>
                    {isStopping ? 'Stopping...' : 'Running'}
                  </span>
                </>
              ) : isQueued ? (
                <>
                  <div className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
                  <span className="text-[10px] text-yellow-400 font-mono tracking-widest uppercase">Queued</span>
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

            {/* Scrollable output area */}
            <div className="max-h-[500px] overflow-y-auto p-4 space-y-0.5">
              {displayOutputs.map((output, idx) => (
                <OutputItem key={idx} output={output} />
              ))}

              {/* Fallback: plain text output (non-streaming result) */}
              {!isRunning && !displayOutputs.length && cell.output && !cell.error && (
                <div className="text-gray-300 whitespace-pre-wrap break-words text-[13px] leading-5">{cell.output}</div>
              )}

              {/* Error output — ANSI stripped */}
              {cell.status === 'error' && cell.error && (
                <div className="text-red-400 whitespace-pre-wrap break-words text-[13px] leading-5 mt-2 bg-red-950/20 p-3 rounded-lg border border-red-500/20 overflow-x-auto">
                  {stripAnsi(cell.error)}
                </div>
              )}

              {/* Simplified Input prompt for input() */}
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

              {/* Scroll anchor */}
              <div ref={outputEndRef} />
            </div>
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
        <ToolBtn icon={Trash2} onClick={() => onDelete(cell.id)} label="Delete" danger />
        <ToolBtn icon={MoreHorizontal} onClick={() => { }} label="More" />
      </div>
    </div>
  );
};
