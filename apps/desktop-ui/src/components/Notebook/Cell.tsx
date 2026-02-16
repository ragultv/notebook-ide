import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Play, Trash2, ArrowUp, ArrowDown, MoreHorizontal, Wrench, CheckCircle2, XCircle, Clock, GripVertical, Loader2, Zap, ChevronDown } from 'lucide-react';
import { CellData, CellStatus, CellOutput } from '../../types';
import { controllerClient, RichOutput } from '../../services/controller.client';
import { useUIStore } from '../../store/ui.store';
import { TextCell } from './TextCell';

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

// Parse error message to extract line number from cell code
const parseErrorLine = (error: string | undefined): number | null => {
  if (!error) return null;
  const match = error.match(/line (\d+)/i);
  return match ? parseInt(match[1], 10) : null;
};

// Simple Fallback Highlighter if Prism is missing (For Code Cells)
const simpleFallbackHighlight = (code: string) => {
  let html = code
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  html = html.replace(/\b(def|class|return|if|else|elif|while|for|in|import|from|as|try|except|finally|with|lambda|async|await)\b/g, '<span style="color: #c678dd;">$1</span>');
  html = html.replace(/\b(print|len|range|str|int|float|list|dict|set|tuple|type|isinstance)\b/g, '<span style="color: #61afef;">$1</span>');
  html = html.replace(/\b(\d+)\b/g, '<span style="color: #d19a66;">$1</span>');
  html = html.replace(/('.*?'|".*?")/g, '<span style="color: #98c379;">$1</span>');
  html = html.replace(/(#.*)/g, '<span style="color: #5c6370; font-style: italic;">$1</span>');
  return html;
};

export const Cell: React.FC<CellProps> = ({
  cell,
  index,
  notebookId,
  notebookName,
  isActive,
  onActivate,
  onDeactivate,
  onUpdate,
  onOutputUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  onMove,
  onFixError,
  allCells,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [streamingOutputs, setStreamingOutputs] = useState<CellOutput[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showFixPopover, setShowFixPopover] = useState(false);

  const cancelStreamRef = useRef<(() => void) | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const { kernelStatus, setKernelStatus } = useUIStore();

  const errorLine = useMemo(() => parseErrorLine(cell.error), [cell.error]);
  const codeLines = useMemo(() => cell.content.split('\n'), [cell.content]);
  const isCode = cell.type === 'code';

  useEffect(() => {
    if (textareaRef.current && isCode) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.max(24, textareaRef.current.scrollHeight) + 'px';
    }
  }, [cell.content, isCode]);

  useEffect(() => {
    if (outputRef.current && cell.status === 'running') {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [streamingOutputs, cell.status]);

  const runCell = async () => {
    if (cell.type === 'markdown') return;
    if (!cell.content.trim()) return;

    if (cancelStreamRef.current) cancelStreamRef.current();

    setStreamingOutputs([]);
    onOutputUpdate(cell.id, '', 'running', undefined, undefined, [], undefined);
    setKernelStatus('busy');

    const cancel = controllerClient.runCellStream(
      { cellId: cell.id, code: cell.content, notebookId: notebookId },
      (output: RichOutput) => setStreamingOutputs(prev => [...prev, output as CellOutput]),
      (result) => {
        const outputs = result.outputs || [];
        if (result.success) {
          onOutputUpdate(cell.id, result.output || '', 'success', undefined, result.executionCount, outputs, result.duration);
        } else {
          onOutputUpdate(cell.id, '', 'error', result.error, result.executionCount, outputs, result.duration);
        }
        setKernelStatus('idle');
        setStreamingOutputs([]);
        cancelStreamRef.current = null;
      },
      (error) => {
        onOutputUpdate(cell.id, '', 'error', error);
        setKernelStatus('error');
        setStreamingOutputs([]);
        cancelStreamRef.current = null;
      }
    );
    cancelStreamRef.current = cancel;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      runCell();
    }
  };

  const handleFixError = async (mode: 'chat' | 'auto') => {
    if (!onFixError || !cell.error) return;

    if (mode === 'chat') {
      setShowFixPopover(false);
      onFixError(index + 1, cell.error, cell.content, cell.id);
    } else {
      setIsFixing(true);
      setShowFixPopover(false);
      try {
        // Call AI Service to fix error
        const response = await controllerClient.fixError({
          cellIndex: index + 1,
          error: cell.error,
          cellContent: cell.content,
          context: {
            notebookName: notebookName,
          }
        });

        // Extract code from response
        let fixedCode = response.text;
        // Check for markdown code blocks
        const codeBlockRegex = /```(?:python)?\s*([\s\S]*?)\s*```/;
        const match = fixedCode.match(codeBlockRegex);
        if (match && match[1]) {
          fixedCode = match[1].trim();
        }

        // Update cell content directly
        onUpdate(cell.id, fixedCode);

      } catch (err) {
        console.error("Auto-fix failed:", err);
        // If auto-fix fails, we could fallback to chat or just alert
        // For now, let's open chat with the error so user knows something went wrong
        onFixError(index + 1, cell.error + `\n\n(Auto-fix failed: ${err})`, cell.content, cell.id);
      } finally {
        setIsFixing(false);
      }
    }
  };

  const formatDuration = (seconds: number) => {
    if (seconds === 0) return '0ms';
    if (seconds < 0.001) return '<1ms';
    if (seconds < 1) return `${(seconds * 1000).toFixed(1)}ms`;
    if (seconds < 60) return `${seconds.toFixed(2)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs.toFixed(1)}s`;
  };

  // DRAG AND DROP HANDLERS
  const handleDragStart = (e: React.DragEvent) => {
    // Prepare drag data with cell information
    const dragData = {
      type: 'cell-drag',
      index: index + 1,
      cellId: cell.id,
      notebookId: notebookId,
      notebookName: notebookName,
      content: cell.content,
      cellType: cell.type
    };

    e.dataTransfer.setData('application/json', JSON.stringify(dragData));
    e.dataTransfer.setData('application/x-cell-index', index.toString());
    // Use cell reference instead of actual content for text/plain
    const textPayload = `[Cell ${index + 1}]`;
    e.dataTransfer.setData('text/plain', textPayload);
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-cell-index')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const fromIndexStr = e.dataTransfer.getData('application/x-cell-index');
    if (fromIndexStr && onMove) {
      const fromIndex = parseInt(fromIndexStr, 10);
      if (!isNaN(fromIndex) && fromIndex !== index) {
        onMove(fromIndex, index);
      }
    }
  };

  const highlightCode = (code: string) => {
    if (typeof window !== 'undefined' && (window as any).Prism && (window as any).Prism.languages.python) {
      try { return (window as any).Prism.highlight(code, (window as any).Prism.languages.python, 'python'); } catch (e) { }
    }
    return simpleFallbackHighlight(code);
  };

  const renderHighlightedCode = () => {
    return codeLines.map((line, idx) => {
      const lineNum = idx + 1;
      const isErrorLine = errorLine === lineNum && cell.status === 'error';
      return (
        <div key={idx} className={`${isErrorLine ? 'bg-red-900/20' : ''} pl-1 -ml-1`}>
          <span dangerouslySetInnerHTML={{ __html: highlightCode(line) || '&nbsp;' }} />
        </div>
      );
    });
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
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
      {/* Drag Handle (Top Center) */}
      <div
        draggable
        onDragStart={handleDragStart}
        className="absolute left-1/2 -translate-x-1/2 -top-2 px-3 py-1 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-all z-30 bg-[#2b2b2e] border border-white/10 rounded-full shadow-lg hover:bg-[#3b3b3e] hover:shadow-xl"
        title="Drag to Chat or Reorder"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="w-4 h-4 text-gray-400 hover:text-white" />
      </div>
      {/* Active Indicator Removed as requested */}

      {/* Gutter / Controls - Only for code */}
      {isCode && (
        <div className="w-10 flex-shrink-0 flex flex-col items-center pt-2 select-none z-20 sticky top-2 self-start h-fit">
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); runCell(); }}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-md border 
                 ${cell.status !== 'running' && cell.status !== 'success' ? 'bg-[#2b2b2e] border-white/10 hover:bg-white hover:text-black' : ''}
                 ${cell.status === 'running' ? 'bg-green-900/20 text-green-400 border-green-500 ring-2 ring-green-500 animate-pulse' : ''}
                 ${cell.status === 'success' ? 'bg-green-950/40 text-green-500 border-green-800 hover:border-green-500 shadow-lg shadow-green-950/50' : ''}
                 ${cell.status === 'error' ? 'bg-red-900/20 text-red-500 border-red-500' : ''}
              `}
              title="Run cell"
            >
              {cell.status === 'running' ? (
                <div className="w-3.5 h-3.5 border-2 border-green-400 border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <Play className="w-3.5 h-3.5 fill-current" />
              )}
            </button>
            {cell.status === 'success' && (
              <div className="flex flex-col items-center mt-1" title={`Executed in ${formatDuration(cell.duration || 0)}`}>
                <CheckCircle2 className="w-3 h-3 text-green-500 mb-0.5" />
                <span className="text-[10px] font-mono text-gray-400">{formatDuration(cell.duration || 0)}</span>
              </div>
            )}
            {cell.status === 'error' && (
              <div className="flex flex-col items-center mt-1">
                <XCircle className="w-3 h-3 text-red-500 mb-0.5" />
                <span className="text-[10px] font-mono text-red-400">Error</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Editor & Output Container */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        {isCode ? (
          // Code Editor
          <div className={`relative w-full rounded-xl overflow-hidden bg-[#09090b] shadow-inner`}>
            <div className="relative font-mono text-sm w-full flex py-3 min-h-[3rem]" style={{ lineHeight: '1.6rem' }}>
              <div className="flex-shrink-0 px-3 text-right select-none text-gray-600 border-r border-[#27272a] bg-[#09090b]">
                {codeLines.map((_, idx) => (
                  <div key={idx} className="h-[1.6rem] text-[11px] font-mono opacity-50">{idx + 1}</div>
                ))}
              </div>
              <div
                className="flex-1 relative min-w-0 no-drag"
                onDragStart={(e) => e.stopPropagation()}
              >
                <pre ref={preRef} aria-hidden="true" className="pointer-events-none absolute inset-0 m-0 px-4 whitespace-pre-wrap break-words bg-transparent text-gray-300 w-full font-mono text-sm" style={{ minHeight: '100%', lineHeight: '1.6rem', fontFamily: 'inherit' }}>
                  {renderHighlightedCode()}
                </pre>
                <textarea
                  ref={textareaRef}
                  value={cell.content}
                  onChange={(e) => onUpdate(cell.id, e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="relative w-full px-4 bg-transparent text-transparent caret-sim-red resize-none outline-none whitespace-pre-wrap break-words z-10 min-h-[1.6rem] font-mono text-sm border-none ring-0 p-0"
                  spellCheck={false}
                  rows={1}
                  style={{ color: 'transparent', lineHeight: '1.6rem', fontFamily: 'inherit', padding: '0 1rem' }}
                />
              </div>
            </div>
          </div>
        ) : (
          // Text/Markdown Editor (Delegated to TextCell)
          <TextCell
            content={cell.content}
            isActive={isActive}
            onUpdate={(content) => onUpdate(cell.id, content)}
            onActivate={onActivate}
            onDeactivate={onDeactivate}
          />
        )}

        {/* Output Section */}
        {isCode && (cell.status === 'running' || cell.output || cell.outputs?.length || cell.status === 'error') && (
          <div ref={outputRef} className="mt-1 text-sm font-mono overflow-auto max-h-[500px] rounded-lg bg-black/30 border border-white/5 p-4 shadow-inner">
            {cell.status === 'running' && (
              <div className="flex items-center gap-2 text-xs text-sim-red mb-2 animate-pulse">
                <Clock className="w-3 h-3" /> Executing...
              </div>
            )}
            <div className="space-y-2">
              {cell.outputs?.map((output, idx) => <OutputItem key={idx} output={output} />)}
              {!cell.outputs?.length && cell.output && !cell.error && (
                <div className="text-gray-300 whitespace-pre-wrap break-words">{cell.output}</div>
              )}
              {cell.status === 'error' && (
                <div className="text-red-400 whitespace-pre-wrap break-words break-all mt-2 bg-red-950/20 p-3 rounded-lg border border-red-500/20 w-full max-w-full overflow-hidden overflow-x-auto">
                  {cell.error}
                </div>
              )}
              {cell.status === 'error' && onFixError && (
                <div className="relative mt-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowFixPopover(!showFixPopover); }}
                    disabled={isFixing}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold bg-sim-red text-white rounded-full hover:bg-sim-redHover transition-colors shadow-lg shadow-red-900/50 disabled:opacity-50"
                  >
                    {isFixing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Wrench className="w-3.5 h-3.5" />
                    )}
                    {isFixing ? 'Processing...' : 'Fix with AI'}
                    <ChevronDown className={`w-3 h-3 transition-transform ${showFixPopover ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Fix Options Popover - Horizontal Layout */}
                  {showFixPopover && (
                    <div className="absolute left-0 bottom-full mb-2 flex bg-[#1e1e20] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200 divide-x divide-white/10">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleFixError('chat'); }}
                        className="flex flex-col items-center gap-1.5 px-4 py-3 text-xs text-gray-300 hover:text-white hover:bg-white/5 transition-colors min-w-[100px]"
                      >
                        <div className="p-1.5 rounded-md bg-blue-500/10 text-blue-400">
                          <MoreHorizontal className="w-4 h-4" />
                        </div>
                        <div className="font-bold">Chat</div>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleFixError('auto'); }}
                        className="flex flex-col items-center gap-1.5 px-4 py-3 text-xs text-gray-300 hover:text-white hover:bg-white/5 transition-colors min-w-[100px]"
                      >
                        <div className="p-1.5 rounded-md bg-green-500/10 text-green-400">
                          <Zap className="w-4 h-4" />
                        </div>
                        <div className="font-bold">Auto-Fix</div>
                      </button>
                    </div>
                  )}

                  {/* Click outside listener */}
                  {showFixPopover && (
                    <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setShowFixPopover(false); }} />
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div
        className={`absolute right-4 top-2 flex items-center gap-1 p-1 rounded-full bg-[#2b2b2e] border border-white/10 shadow-xl transition-all duration-200 z-30
          ${(isActive || (isCode && isHovered)) && !isDragOver ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'}
        `}
      >
        <ToolBtn icon={ArrowUp} onClick={() => onMoveUp(cell.id)} label="Up" />
        <ToolBtn icon={ArrowDown} onClick={() => onMoveDown(cell.id)} label="Down" />
        <div className="w-[1px] h-4 bg-white/10 mx-1"></div>
        <ToolBtn icon={Trash2} onClick={() => onDelete(cell.id)} label="Delete" />
        <ToolBtn icon={MoreHorizontal} onClick={() => { }} label="More" />
      </div>
    </div>
  );
};

// Helper Components
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
  return <div className={`whitespace-pre-wrap ${output.stream === 'stderr' ? 'text-yellow-300' : 'text-gray-300'}`}>{output.data}</div>
};

const ToolBtn: React.FC<{ icon: React.ComponentType<any>; onClick: (e: any) => void; label: string }> = ({ icon: Icon, onClick, label }) => (
  <button onClick={(e) => { e.stopPropagation(); onClick(e); }} title={label} className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-full transition-colors">
    <Icon className="w-4 h-4" />
  </button>
);
