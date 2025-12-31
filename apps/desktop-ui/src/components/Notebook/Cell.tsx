import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, Trash2, ArrowUp, ArrowDown, MoreHorizontal, Copy, GripVertical, Wrench, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { CellData, CellStatus, CellOutput } from '../../types';
import { controllerClient, RichOutput } from '../../services/controller.client';
import { useUIStore } from '../../state/ui.store';

interface CellProps {
  cell: CellData;
  index: number;
  notebookName: string;
  isActive: boolean;
  onActivate: () => void;
  onUpdate: (id: string, content: string) => void;
  onOutputUpdate: (id: string, output: string, status: CellStatus, error?: string, execCount?: number, outputs?: CellOutput[], duration?: number) => void;
  onDelete: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onFixError?: (cellIndex: number, error: string, cellContent: string) => void;
  allCells?: CellData[];
}

export const Cell: React.FC<CellProps> = ({
  cell,
  index,
  notebookName,
  isActive,
  onActivate,
  onUpdate,
  onOutputUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  onFixError,
  allCells,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [streamingOutputs, setStreamingOutputs] = useState<CellOutput[]>([]);
  const cancelStreamRef = useRef<(() => void) | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const { kernelStatus, setKernelStatus } = useUIStore();

  // Auto-resize textarea and sync with pre
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [cell.content]);

  // Auto-scroll output to bottom during streaming
  useEffect(() => {
    if (outputRef.current && cell.status === 'running') {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [streamingOutputs, cell.status]);

  const runCell = async () => {
    if (cell.type === 'markdown') return;
    if (!cell.content.trim()) return;
    
    // Cancel any existing stream
    if (cancelStreamRef.current) {
      cancelStreamRef.current();
    }
    
    setStreamingOutputs([]);
    onOutputUpdate(cell.id, '', 'running', undefined, undefined, [], undefined);
    setKernelStatus('busy');
    
    // Use streaming execution
    const cancel = controllerClient.runCellStream(
      { cellId: cell.id, code: cell.content },
      // On each output chunk
      (output: RichOutput) => {
        setStreamingOutputs(prev => [...prev, output as CellOutput]);
      },
      // On complete
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
      // On error
      (error) => {
        onOutputUpdate(cell.id, '', 'error', error);
        setKernelStatus('error');
        setStreamingOutputs([]);
        cancelStreamRef.current = null;
      }
    );
    
    cancelStreamRef.current = cancel;
  };

  const handleFixError = async () => {
    console.log('Fix Error clicked', { onFixError: !!onFixError, error: cell.error, output: cell.output });
    if (!onFixError) {
      console.error('onFixError is not defined');
      return;
    }
    
    const errorText = cell.error || cell.output || 'Unknown error';
    console.log('Calling onFixError with:', { index: index + 1, errorText, content: cell.content });
    
    setIsFixing(true);
    try {
      await onFixError(index + 1, errorText, cell.content);
      console.log('Fix error completed');
    } catch (e) {
      console.error('Fix error failed:', e);
    } finally {
      setIsFixing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Ctrl+Enter or Cmd+Enter to run
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runCell();
    }
    
    // Tab support
    if (e.key === 'Tab') {
      e.preventDefault();
      const target = e.target as HTMLTextAreaElement;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const value = target.value;
      const newValue = value.substring(0, start) + '  ' + value.substring(end);
      
      onUpdate(cell.id, newValue);
      
      // We need to set selection after render, but React state update is async.
      // A simple timeout or effect handles it, but for now simple imperative works often enough.
      setTimeout(() => {
        target.selectionStart = target.selectionEnd = start + 2;
      }, 0);
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    // structured data for internal app drag-and-drop
    const dragData = {
      type: 'cell-drag',
      index: index + 1, // Use 1-based index for user visibility
      content: cell.content,
      cellType: cell.type
    };
    
    e.dataTransfer.setData('application/json', JSON.stringify(dragData));
    
    // Fallback text for external drops or if JSON isn't handled
    const textPayload = `[Cell ${index + 1}]`;
    e.dataTransfer.setData('text/plain', textPayload);
    
    e.dataTransfer.effectAllowed = 'copy';
  };

  const isCode = cell.type === 'code';

  // Syntax Highlighting
  const highlightCode = (code: string) => {
    if (typeof window !== 'undefined' && (window as any).Prism) {
      try {
        return (window as any).Prism.highlight(code, (window as any).Prism.languages.python, 'python');
      } catch (e) {
        return code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      }
    }
    return code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };

  // Format duration for display
  const formatDuration = (seconds: number): string => {
    if (seconds < 1) {
      return `${Math.round(seconds * 1000)}ms`;
    } else if (seconds < 60) {
      return `${seconds.toFixed(1)}s`;
    } else {
      const mins = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      return `${mins}m ${secs}s`;
    }
  };

  return (
    <div 
      className={`relative group flex gap-2 pl-2 pr-4 py-2 my-2 rounded-lg transition-all duration-200 border
        ${isActive 
          ? 'bg-sim-surface border-sim-red shadow-cell-focus z-10' 
          : 'bg-sim-surface/50 border-sim-border hover:border-sim-muted'
        }`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onActivate}
    >
      {/* Active Indicator Border (Left) */}
      {isActive && <div className="absolute left-0 top-0 bottom-0 w-1 bg-sim-red rounded-l-lg"></div>}

      {/* Left Gutter: Play/Status Button & Drag Handle */}
      <div className="w-14 flex-shrink-0 flex flex-col items-center pt-2 relative select-none group/gutter">
        {/* Drag Handle - Visible on hover */}
        <div 
          draggable 
          onDragStart={handleDragStart}
          className="absolute -left-1 top-2 p-1 cursor-grab active:cursor-grabbing text-sim-muted hover:text-white opacity-0 group-hover:opacity-100 transition-opacity z-20"
          title="Drag to Chat"
        >
          <GripVertical className="w-4 h-4" />
        </div>

        {isCode && (
          <>
            {/* Play/Status Button */}
            <button 
              onClick={(e) => { e.stopPropagation(); runCell(); }}
              className={`w-7 h-7 rounded-full flex items-center justify-center transition-all mb-1 z-10
                ${cell.status === 'running' 
                  ? 'bg-yellow-500/20 border border-yellow-500/50' 
                  : cell.status === 'success'
                    ? 'bg-green-500/20 border border-green-500/50 hover:bg-green-500/30'
                    : cell.status === 'error'
                      ? 'bg-red-500/20 border border-red-500/50 hover:bg-red-500/30'
                      : 'bg-sim-border text-sim-text hover:bg-sim-red hover:text-white'
                }
              `}
              title={cell.status === 'running' ? 'Running...' : cell.status === 'success' ? 'Run again' : cell.status === 'error' ? 'Run again' : 'Run cell'}
            >
              {cell.status === 'running' ? (
                <div className="w-4 h-4 border-2 border-yellow-500/30 border-t-yellow-500 rounded-full animate-spin"></div>
              ) : cell.status === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-green-500" />
              ) : cell.status === 'error' ? (
                <XCircle className="w-4 h-4 text-red-500" />
              ) : (
                <Play className="w-3 h-3 fill-current ml-0.5" />
              )}
            </button>
            
            {/* Execution Count & Duration */}
            <div className="flex flex-col items-center gap-0.5">
              {cell.executionCount && (
                <span className="text-[10px] text-sim-muted font-mono opacity-60">[{cell.executionCount}]</span>
              )}
              {cell.duration !== undefined && cell.status !== 'running' && cell.status !== 'idle' && (
                <span className={`text-[9px] font-mono flex items-center gap-0.5 ${cell.status === 'success' ? 'text-green-500/70' : 'text-red-500/70'}`}>
                  <Clock className="w-2.5 h-2.5" />
                  {formatDuration(cell.duration)}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Editor */}
        <div className={`relative w-full rounded overflow-hidden ${isCode ? 'bg-[#0f0f11] border border-sim-border' : 'bg-transparent'}`}>
           {isCode ? (
             <div className="relative font-mono text-sm leading-relaxed w-full">
               {/* Syntax Highlighting Layer */}
               <pre
                 ref={preRef}
                 aria-hidden="true"
                 className="pointer-events-none absolute inset-0 m-0 p-3 whitespace-pre-wrap break-words bg-transparent text-gray-300 w-full"
                 style={{ minHeight: '100%' }}
                 dangerouslySetInnerHTML={{ __html: highlightCode(cell.content) + '<br/>' }}
               />
               {/* Editable Layer */}
               <textarea
                 ref={textareaRef}
                 value={cell.content}
                 onChange={(e) => onUpdate(cell.id, e.target.value)}
                 onKeyDown={handleKeyDown}
                 placeholder="# Enter Python code here..."
                 className="relative w-full p-3 bg-transparent text-transparent caret-white resize-none outline-none whitespace-pre-wrap break-words z-10"
                 spellCheck={false}
                 rows={1}
                 style={{ color: 'transparent', lineHeight: 'inherit' }}
               />
             </div>
           ) : (
             <textarea
               ref={textareaRef}
               value={cell.content}
               onChange={(e) => onUpdate(cell.id, e.target.value)}
               onKeyDown={handleKeyDown}
               placeholder="Enter text here..."
               className="w-full p-3 bg-transparent resize-none outline-none text-sm leading-relaxed font-sans text-gray-200 caret-sim-red"
               spellCheck={true}
               rows={1}
             />
           )}
        </div>

        {/* Output Area - Shows during streaming or after execution */}
        {isCode && (cell.status === 'running' || cell.output || cell.outputs?.length || cell.status === 'error') && (
          <div 
            ref={outputRef}
            className="mt-2 text-sm font-mono overflow-x-auto max-h-[500px] overflow-y-auto bg-black/50 border border-sim-border rounded"
          >
            {/* Streaming Output - Terminal style */}
            {cell.status === 'running' && streamingOutputs.length > 0 && (
              <div className="p-3 space-y-1">
                <div className="flex items-center gap-2 text-xs text-sim-muted mb-2 pb-2 border-b border-sim-border">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <span>Running...</span>
                </div>
                {streamingOutputs.map((output, idx) => (
                  <OutputItem key={idx} output={output} />
                ))}
              </div>
            )}
            
            {/* Final Output - After execution completes */}
            {cell.status !== 'running' && (
              <div className="p-3 space-y-2">
                {cell.status === 'error' ? (
                  <div className="flex flex-col gap-2">
                    {/* Show any outputs before the error */}
                    {cell.outputs?.filter(o => o.type !== 'error').map((output, idx) => (
                      <OutputItem key={idx} output={output} />
                    ))}
                    {/* Error message */}
                    <div className="text-red-400 whitespace-pre-wrap bg-red-500/10 p-2 rounded border border-red-500/30">
                      {cell.error || cell.output}
                    </div>
                    {onFixError && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleFixError(); }}
                        disabled={isFixing}
                        className="self-start flex items-center gap-1.5 px-2 py-1 text-xs bg-sim-red/20 hover:bg-sim-red/30 text-sim-red border border-sim-red/50 rounded transition-colors disabled:opacity-50"
                      >
                        {isFixing ? (
                          <>
                            <div className="w-3 h-3 border-2 border-sim-red/30 border-t-sim-red rounded-full animate-spin"></div>
                            Analyzing...
                          </>
                        ) : (
                          <>
                            <Wrench className="w-3 h-3" />
                            Fix Error with AI
                          </>
                        )}
                      </button>
                    )}
                  </div>
                ) : cell.outputs?.length ? (
                  // Rich outputs (images, streams, etc.)
                  cell.outputs.map((output, idx) => (
                    <OutputItem key={idx} output={output} />
                  ))
                ) : cell.output ? (
                  // Fallback to simple text output
                  <div className="text-gray-300 whitespace-pre-wrap">{cell.output}</div>
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Toolbar (Visible on Hover/Active) */}
      <div 
        className={`absolute right-2 top-2 flex flex-row items-center gap-1 bg-sim-surface border border-sim-border rounded p-1 transition-opacity duration-200 z-20 shadow-xl
          ${isActive || isHovered ? 'opacity-100' : 'opacity-0 pointer-events-none'}
        `}
      >
        <ToolBtn icon={ArrowUp} onClick={() => onMoveUp(cell.id)} label="Move cell up" />
        <ToolBtn icon={ArrowDown} onClick={() => onMoveDown(cell.id)} label="Move cell down" />
        <div className="w-[1px] h-4 bg-sim-border mx-1"></div>
        <ToolBtn icon={Trash2} onClick={() => onDelete(cell.id)} label="Delete cell" />
        <ToolBtn icon={MoreHorizontal} onClick={() => {}} label="More actions" />
      </div>
    </div>
  );
};

// Output Item Component - Renders different output types
const OutputItem: React.FC<{ output: CellOutput }> = ({ output }) => {
  if (output.type === 'image' && output.data) {
    return (
      <div className="flex justify-center py-2">
        <img 
          src={`data:${output.mimeType || 'image/png'};base64,${output.data}`}
          alt="Output"
          className="max-w-full h-auto rounded border border-sim-border"
          style={{ maxHeight: '400px' }}
        />
      </div>
    );
  }
  
  if (output.type === 'html' && output.data) {
    return (
      <div 
        className="prose prose-invert max-w-full"
        dangerouslySetInnerHTML={{ __html: output.data }}
      />
    );
  }
  
  if (output.type === 'stream') {
    const isStderr = output.stream === 'stderr';
    return (
      <span className={`whitespace-pre-wrap ${isStderr ? 'text-yellow-400' : 'text-gray-300'}`}>
        {output.data}
      </span>
    );
  }
  
  if (output.type === 'error') {
    return (
      <div className="text-red-400 whitespace-pre-wrap">
        {output.data}
      </div>
    );
  }
  
  // Default text output
  return (
    <div className="text-gray-300 whitespace-pre-wrap">
      {output.data}
    </div>
  );
};

const ToolBtn: React.FC<{ icon: React.ComponentType<any>; onClick: (e: any) => void; label: string }> = ({ icon: Icon, onClick, label }) => (
  <button 
    onClick={(e) => { e.stopPropagation(); onClick(e); }} 
    title={label}
    className="p-1.5 text-sim-muted hover:bg-sim-bg hover:text-white rounded transition-colors"
  >
    <Icon className="w-4 h-4" />
  </button>
);