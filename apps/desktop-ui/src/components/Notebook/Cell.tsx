import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Play, Square, Trash2, ArrowUp, ArrowDown, MoreHorizontal, Copy, GripVertical, Wrench, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { CellData, CellStatus, CellOutput } from '../../types';
import { controllerClient, RichOutput } from '../../services/controller.client';
import { useUIStore } from '../../store/ui.store';

interface CellProps {
  cell: CellData;
  index: number;
  notebookId: string;
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

// Parse error message to extract line number from cell code
const parseErrorLine = (error: string | undefined): number | null => {
  if (!error) return null;

  // Priority order: Look for cell code line first, then fallback to other patterns
  // The cell code appears as '<string>' in Python tracebacks
  const patterns = [
    /File "<string>", line (\d+)/,     // Cell code in traceback (highest priority)
    /File "<module>", line (\d+)/,     // Module level
    /<string>:(\d+):/,                 // Alternative format
  ];

  for (const pattern of patterns) {
    const match = error.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  // Fallback: Find last occurrence of "line X" that's NOT from a real file path
  // This avoids picking up kernel_manager.py line numbers
  const lines = error.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    // Skip lines that reference actual Python files
    if (line.includes('.py') || line.includes('kernel_manager')) continue;

    const match = line.match(/line (\d+)/i);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  return null;
};

// Detect syntax/indentation errors in Python code
interface SyntaxIssue {
  line: number;
  message: string;
  type: 'error' | 'warning';
}

const detectSyntaxIssues = (code: string): SyntaxIssue[] => {
  const issues: SyntaxIssue[] = [];
  const lines = code.split('\n');

  let expectedIndent = 0;
  const indentStack: number[] = [0];
  const bracketStack: { char: string; line: number }[] = [];
  const bracketPairs: { [key: string]: string } = { '(': ')', '[': ']', '{': '}' };

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) return;

    // Count leading spaces
    const leadingSpaces = line.match(/^(\s*)/)?.[1].length || 0;

    // Check for tabs mixed with spaces
    if (line.includes('\t') && line.includes(' ') && line.match(/^\s/)) {
      issues.push({
        line: lineNum,
        message: 'Mixed tabs and spaces in indentation',
        type: 'warning'
      });
    }

    // Check indentation consistency (should be multiple of 4 or 2)
    if (leadingSpaces > 0 && leadingSpaces % 2 !== 0 && leadingSpaces % 4 !== 0) {
      issues.push({
        line: lineNum,
        message: 'Inconsistent indentation',
        type: 'warning'
      });
    }

    // Track bracket balance
    for (const char of line) {
      if ('([{'.includes(char)) {
        bracketStack.push({ char, line: lineNum });
      } else if (')]}'.includes(char)) {
        const last = bracketStack.pop();
        if (last && bracketPairs[last.char] !== char) {
          issues.push({
            line: lineNum,
            message: `Mismatched bracket: expected '${bracketPairs[last.char]}' but found '${char}'`,
            type: 'error'
          });
        } else if (!last) {
          issues.push({
            line: lineNum,
            message: `Unexpected closing bracket '${char}'`,
            type: 'error'
          });
        }
      }
    }

    // Check for common syntax issues
    if (trimmed.endsWith(':') && !['if', 'elif', 'else', 'for', 'while', 'def', 'class', 'try', 'except', 'finally', 'with', 'async', 'match', 'case'].some(kw =>
      trimmed.startsWith(kw + ' ') || trimmed.startsWith(kw + ':') || trimmed === kw + ':'
    )) {
      // Check for lambda or dict comprehension - those are valid
      if (!trimmed.includes('lambda') && !trimmed.includes('{')) {
        issues.push({
          line: lineNum,
          message: 'Unexpected colon at end of line',
          type: 'warning'
        });
      }
    }

    // Check for missing colon after if/for/while/def/class
    const blockKeywords = ['if', 'elif', 'for', 'while', 'def', 'class', 'try', 'except', 'with'];
    for (const kw of blockKeywords) {
      if ((trimmed.startsWith(kw + ' ') || trimmed === kw) && !trimmed.endsWith(':') && !trimmed.includes(':')) {
        issues.push({
          line: lineNum,
          message: `Missing ':' after '${kw}' statement`,
          type: 'error'
        });
      }
    }
  });

  // Check for unclosed brackets
  bracketStack.forEach(({ char, line }) => {
    issues.push({
      line,
      message: `Unclosed bracket '${char}'`,
      type: 'error'
    });
  });

  return issues;
};

export const Cell: React.FC<CellProps> = ({
  cell,
  index,
  notebookId,
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

  // Parse error line from cell error
  const errorLine = useMemo(() => parseErrorLine(cell.error), [cell.error]);

  // Get lines array for rendering
  const codeLines = useMemo(() => cell.content.split('\n'), [cell.content]);

  // Detect syntax issues in real-time (only for code cells)
  const syntaxIssues = useMemo(() => {
    if (cell.type !== 'code') return [];
    return detectSyntaxIssues(cell.content);
  }, [cell.content, cell.type]);

  // Get issues for a specific line
  const getLineIssues = (lineNum: number) => syntaxIssues.filter(i => i.line === lineNum);

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
      { cellId: cell.id, code: cell.content, notebookId: notebookId },
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift+Enter: Run cell
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      runCell();
    }
  };

  const handleFixError = async () => {
    if (!onFixError || !cell.error) return;
    setIsFixing(true);
    try {
      await onFixError(index + 1, cell.error, cell.content);
    } finally {
      setIsFixing(false);
    }
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 0.01) return '<0.01s';
    if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`;
    if (seconds < 60) return `${seconds.toFixed(2)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs.toFixed(1)}s`;
  };

  const handleDragStart = (e: React.DragEvent) => {
    const dragData = {
      type: 'cell-drag',
      index: index + 1,
      content: cell.content,
      cellType: cell.type
    };
    e.dataTransfer.setData('application/json', JSON.stringify(dragData));
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

  // Highlight code with line-level styling
  const renderHighlightedCode = () => {
    return codeLines.map((line, idx) => {
      const lineNum = idx + 1;
      const isErrorLine = errorLine === lineNum && cell.status === 'error';

      let lineClass = '';
      if (isErrorLine) {
        lineClass = 'bg-red-500/20 border-l-2 border-red-500';
      }

      return (
        <div key={idx} className={`${lineClass} pl-1 -ml-1`}>
          <span dangerouslySetInnerHTML={{ __html: highlightCode(line) || '&nbsp;' }} />
        </div>
      );
    });
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
                  : cell.status === 'pending'
                    ? 'bg-gray-500/20 border border-gray-500/50'
                    : cell.status === 'success'
                      ? 'bg-green-500/20 border border-green-500/50 hover:bg-green-500/30'
                      : cell.status === 'error'
                        ? 'bg-red-500/20 border border-red-500/50 hover:bg-red-500/30'
                        : 'bg-sim-border text-sim-text hover:bg-sim-red hover:text-white'
                }
                `}
              title={cell.status === 'running' ? 'Running...' : cell.status === 'pending' ? 'Queued' : cell.status === 'success' ? 'Run again' : cell.status === 'error' ? 'Run again' : 'Run cell'}
            >
              {cell.status === 'running' ? (
                <div className="w-4 h-4 border-2 border-yellow-500/30 border-t-yellow-500 rounded-full animate-spin"></div>
              ) : cell.status === 'pending' ? (
                <Clock className="w-3.5 h-3.5 text-gray-400 animate-pulse" />
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
            <div className="relative font-mono text-sm w-full flex" style={{ lineHeight: '1.5rem' }}>
              {/* Line Numbers Gutter */}
              <div className="flex-shrink-0 pt-3 pb-3 pr-2 pl-2 border-r border-sim-border/50 select-none bg-black/30">
                {codeLines.map((_, idx) => {
                  const lineNum = idx + 1;
                  const isErrorLine = errorLine === lineNum && cell.status === 'error';
                  const isRunning = cell.status === 'running';
                  const lineIssues = getLineIssues(lineNum);
                  const hasError = lineIssues.some(i => i.type === 'error');
                  const hasWarning = lineIssues.some(i => i.type === 'warning');
                  const issueTooltip = lineIssues.map(i => i.message).join('\n');

                  return (
                    <div
                      key={idx}
                      className={`text-right pr-1 min-w-[2rem] flex items-center justify-end relative group/line
                        ${isErrorLine ? 'text-red-500 font-bold'
                          : hasError ? 'text-red-400'
                            : hasWarning ? 'text-yellow-400'
                              : isRunning && lineNum === 1 ? 'text-yellow-400'
                                : 'text-sim-muted/50'}
                      `}
                      style={{ height: '1.5rem' }}
                      title={issueTooltip || undefined}
                    >
                      {/* Running indicator removed */}
                      {(isErrorLine || hasError) && (
                        <span className="mr-1 text-red-500">●</span>
                      )}
                      {!isErrorLine && !hasError && hasWarning && (
                        <span className="mr-1 text-yellow-500">⚠</span>
                      )}
                      {lineNum}
                      {/* Tooltip for syntax issues */}
                      {lineIssues.length > 0 && (
                        <div className="absolute left-full ml-2 top-0 hidden group-hover/line:block z-50 whitespace-nowrap">
                          <div className={`px-2 py-1 text-xs rounded shadow-lg border ${hasError ? 'bg-red-500/90 border-red-400 text-white' : 'bg-yellow-500/90 border-yellow-400 text-black'}`}>
                            {lineIssues.map((issue, i) => (
                              <div key={i}>{issue.message}</div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Code Area */}
              <div className="flex-1 relative min-w-0">
                {/* Syntax Highlighting Layer with Error Lines */}
                <pre
                  ref={preRef}
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 m-0 p-3 whitespace-pre-wrap break-words bg-transparent text-gray-300 w-full overflow-hidden"
                  style={{ minHeight: '100%', lineHeight: '1.5rem' }}
                >
                  {renderHighlightedCode()}
                </pre>
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
                  style={{ color: 'transparent', lineHeight: '1.5rem' }}
                />
              </div>
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
                    {/* Error message with line highlight info */}
                    <div className="text-red-400 whitespace-pre-wrap bg-red-500/10 p-2 rounded border border-red-500/30">
                      {errorLine && (
                        <div className="text-xs text-red-300 mb-2 flex items-center gap-2">
                          <span className="bg-red-500/30 px-2 py-0.5 rounded">Line {errorLine}</span>
                          <span className="text-red-400/70">Error detected on line {errorLine}</span>
                        </div>
                      )}
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
                ) : (
                  <>
                    {cell.outputs?.map((output, idx) => (
                      <OutputItem key={idx} output={output} />
                    ))}
                    {!cell.outputs?.length && cell.output && (
                      <div className="text-gray-300 whitespace-pre-wrap">{cell.output}</div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right Toolbar - Shows on hover */}
      <div
        className={`absolute right-2 top-2 flex items-center gap-1 p-1 rounded bg-sim-bg/90 border border-sim-border shadow-lg transition-all duration-200
          ${isHovered || isActive ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'}
        `}
      >
        <ToolBtn icon={ArrowUp} onClick={() => onMoveUp(cell.id)} label="Move cell up" />
        <ToolBtn icon={ArrowDown} onClick={() => onMoveDown(cell.id)} label="Move cell down" />
        <div className="w-[1px] h-4 bg-sim-border mx-1"></div>
        <ToolBtn icon={Trash2} onClick={() => onDelete(cell.id)} label="Delete cell" />
        <ToolBtn icon={MoreHorizontal} onClick={() => { }} label="More actions" />
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