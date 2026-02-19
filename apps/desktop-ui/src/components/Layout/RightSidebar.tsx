import React, { useState, useRef, useEffect } from 'react';
import { X, Send, User, CornerDownLeft, Zap, ChevronDown, Wrench, Paperclip, AlertTriangle, Check, Ban, File as FileIcon, Code, Plus, Loader2, MessageSquarePlus, MessageCircle, Bot, ListChecks } from 'lucide-react';
import { controllerClient } from '../../services/controller.client';
import { CellData, ProjectFile } from '../../types';
import { ModelSelector } from '../ModelSelector';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

interface RightSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onAddCell: (content: string, type: 'code' | 'markdown') => void;
  onDeleteCell: (index: number) => void;
  onMoveCell: (fromIndex: number, toIndex: number) => void;
  onEditCell: (index: number, content: string, type?: 'code' | 'markdown') => void;
  onAddPackages: (packages: string[]) => void;
  onCreateNotebook: (name: string) => void;
  onDeleteNotebook: (name?: string) => void;
  notebookCells: CellData[];
  notebookName: string;
  projectFiles: ProjectFile[];
  activeCellId?: string | null;
  onOpenManageModels: () => void;
  modelsRefreshTrigger?: number;
  width: number;
  isResizing: boolean;
  onStartResizing: () => void;
}

type AIMode = 'ask' | 'agent' | 'plan';

interface Message {
  id: string;
  role: 'user' | 'ai';
  text: string;
  tokenInfo?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  streaming?: boolean;
  pendingConfirmation?: {
    type: 'delete_notebook';
    name?: string;
  } | {
    type: 'plan_execute';
    operations: Array<{ type: string; params: Record<string, any> }>;
  };
  isConfirmed?: boolean; // true = accepted, false = rejected
  attachments?: AttachedFile[];
  mode?: AIMode; // mode used when this message was sent (for AI messages)
}

interface AttachedFile {
  id: string;
  name: string;
  content: string;
  type: 'file' | 'cell';
}

export const RightSidebar: React.FC<RightSidebarProps> = ({
  isOpen,
  onClose,
  onAddCell,
  onDeleteCell,
  onMoveCell,
  onEditCell,
  onAddPackages,
  onCreateNotebook,
  onDeleteNotebook,
  notebookCells,
  notebookName,
  projectFiles,
  activeCellId,
  onOpenManageModels,
  modelsRefreshTrigger,
  width,
  isResizing,
  onStartResizing
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedMode, setSelectedMode] = useState<AIMode>('agent');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Active cell logic
  const activeCell = activeCellId ? notebookCells.find(c => c.id === activeCellId) : null;
  const activeCellIndex = activeCell ? notebookCells.findIndex(c => c.id === activeCellId) : -1;
  const suggestedCellId = activeCell ? `cell-${activeCellIndex + 1}` : null;
  const isSuggestedAttached = suggestedCellId && attachedFiles.some(f => f.id === suggestedCellId);

  const addActiveCellAttachment = () => {
    if (activeCell && suggestedCellId && !isSuggestedAttached) {
      setAttachedFiles(prev => [...prev, {
        id: suggestedCellId,
        name: `Cell ${activeCellIndex + 1}`,
        content: activeCell.content,
        type: 'cell'
      }]);
    }
  };

  const generateProjectContext = () => {
    // 1. Notebook Context
    const cellContext = notebookCells.map((cell, index) => {
      let contentPreview = cell.content;
      if (contentPreview.length > 500) contentPreview = contentPreview.substring(0, 500) + "...(truncated)";
      return `[Cell ${index + 1}] (${cell.type}):\n${contentPreview}`;
    }).join('\n\n');

    // 2. File Context (List of available files)
    const fileContext = projectFiles.map(f => {
      const sizeText = f.file ? `${f.file.size} bytes` : 'Virtual/In-Memory';
      return `- ${f.name} (${f.type}, ${sizeText})`;
    }).join('\n');

    return `
=== SYSTEM CONTEXT ===
The user is currently viewing the file: "${notebookName}". 
This is the ACTIVE NOTEBOOK.
Unless the user explicitly mentions another file, assume all questions (e.g., "add a cell", "fix the error", "what does this code do") refer to "${notebookName}".

=== AVAILABLE FILES IN PROJECT ===
${fileContext || "No files uploaded."}

=== CONTENT OF ACTIVE NOTEBOOK ("${notebookName}") ===
${cellContext}
=== END CONTEXT ===
`;
  };

  const handleSend = async () => {
    if ((!inputValue.trim() && attachedFiles.length === 0) || isLoading) return;

    // Capture attached files before clearing
    const currentAttachments = [...attachedFiles];

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: inputValue,
      attachments: currentAttachments
    };

    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    setAttachedFiles([]);

    setIsLoading(true);

    // Build Context
    const projectOverview = generateProjectContext();

    const attachmentContext = currentAttachments.map(f => {
      if (f.type === 'cell') {
        return `\n\n=== CELL CONTEXT: ${f.name} ===\nUser has explicitly dragged this cell for context:\n\`\`\`\n${f.content}\n\`\`\`\n`;
      }
      return `\n\n=== FILE ATTACHMENT: ${f.name} ===\nUser has explicitly attached this file for context:\n\`\`\`\n${f.content}\n\`\`\`\n`;
    }).join('');

    const finalMessage = `${projectOverview}${attachmentContext}\n\nUSER QUERY: ${inputValue}`;

    const currentMode = selectedMode;
    const placeholderId = `streaming-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: placeholderId,
      role: 'ai',
      text: '',
      streaming: true,
      mode: currentMode,
    }]);

    const runOperations = (ops: Array<{ type: string; params: Record<string, any> }>): string[] => {
      const actionDescriptions: string[] = [];
      console.log('[RightSidebar.runOperations] Executing operations:', ops);
      ops.forEach((op, idx) => {
        try {
          console.log(`[RightSidebar.runOperations] Executing operation ${idx + 1}/${ops.length}: ${op.type}`, op.params);
          switch (op.type) {
            case 'create_notebook':
              onCreateNotebook(op.params.name);
              actionDescriptions.push(`Created notebook: ${op.params.name}`);
              break;
            case 'add_cell': {
              const cellType = (op.params.type === 'markdown' ? 'markdown' : 'code') as 'code' | 'markdown';
              console.log(`[RightSidebar.runOperations] Calling onAddCell with content length=${(op.params.content ?? '').length}, type=${cellType}`);
              onAddCell(op.params.content ?? '', cellType);
              const preview = (op.params.content || '').slice(0, 50).replace(/\n/g, ' ');
              actionDescriptions.push(`Added ${cellType} cell${preview ? `: ${preview}${(op.params.content?.length || 0) > 50 ? '...' : ''}` : ''}`);
              console.log(`[RightSidebar.runOperations] onAddCell called successfully`);
              break;
            }
            case 'move_cell':
              onMoveCell(op.params.fromIndex, op.params.toIndex);
              actionDescriptions.push(`Moved cell ${op.params.fromIndex} → ${op.params.toIndex}`);
              break;
            case 'delete_cell':
              onDeleteCell(op.params.cellIndex);
              actionDescriptions.push(`Deleted cell ${op.params.cellIndex}`);
              break;
            case 'delete_notebook':
              setMessages(prev => [...prev, {
                id: (Date.now() + Math.random()).toString(),
                role: 'ai',
                text: `Request to DELETE notebook: "${op.params.name || 'Current Notebook'}". This action cannot be undone.`,
                pendingConfirmation: { type: 'delete_notebook', name: op.params.name }
              }]);
              break;
            case 'edit_cell': {
              const editType = (op.params.type === 'markdown' ? 'markdown' : 'code') as 'code' | 'markdown' | undefined;
              onEditCell(op.params.cellIndex, op.params.content ?? '', editType);
              actionDescriptions.push(`Edited cell ${op.params.cellIndex}`);
              break;
            }
            case 'add_package':
              onAddPackages(op.params.packages || []);
              actionDescriptions.push(`Added packages: ${(op.params.packages || []).join(', ')}`);
              break;
            default:
              console.warn(`[RightSidebar.runOperations] Unknown operation type: ${op.type}`);
          }
        } catch (err: any) {
          console.error(`[RightSidebar.runOperations] Error executing operation ${op.type}:`, err);
          actionDescriptions.push(`Error executing ${op.type}: ${err.message}`);
        }
      });
      console.log(`[RightSidebar.runOperations] Completed, ${actionDescriptions.length} actions executed`);
      return actionDescriptions;
    };

    const stripOperationsBlock = (t: string): string => {
      let out = t.replace(/```(?:json|operations)?\s*\n[\s\S]*?\n```/g, '').trim();
      if (out.match(/\[\s*\{[\s\S]*?\}\s*\]/)) out = out.replace(/\[\s*\{[\s\S]*?\}\s*\]/g, '').trim();
      return out;
    };

    const req = {
      prompt: finalMessage,
      sessionId: sessionId ?? undefined,
      mode: currentMode,
      context: { notebookName, cells: notebookCells.map(c => ({ type: c.type, content: c.content })) },
    };

    const applyNonStreamResponse = (response: { text: string; operations?: Array<{ type: string; params: Record<string, any> }>; tokenInfo?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null; sessionId?: string }) => {
      const executeOps = currentMode !== 'ask' && (response.operations?.length ?? 0) > 0;
      if (currentMode === 'plan' && response.operations?.length) {
        setMessages(prev => prev.map(m => m.id === placeholderId
          ? { ...m, streaming: false, text: stripOperationsBlock(response.text), tokenInfo: response.tokenInfo ?? null, pendingConfirmation: { type: 'plan_execute', operations: response.operations! } }
          : m));
      } else if (executeOps) {
        const descriptions = runOperations(response.operations!);
        setMessages(prev => prev.map(m => m.id === placeholderId
          ? { ...m, streaming: false, text: stripOperationsBlock(response.text) + (descriptions.length ? `\n\n**Applied:** ${descriptions.join('; ')}` : ''), tokenInfo: response.tokenInfo ?? null }
          : m));
      } else {
        setMessages(prev => prev.map(m => m.id === placeholderId
          ? { ...m, streaming: false, text: response.text || "I couldn't process that request.", tokenInfo: response.tokenInfo ?? null }
          : m));
      }
      if (response.sessionId) setSessionId(response.sessionId);
      setIsLoading(false);
    };

    controllerClient.askAIStream(req, {
      onChunk: (delta) => {
        setMessages(prev => prev.map(m => m.id === placeholderId ? { ...m, text: m.text + delta } : m));
      },
      onOperations: (operations) => {
        console.log('[RightSidebar] onOperations called:', { currentMode, operations, operationsCount: operations.length });
        if (currentMode === 'ask') {
          console.log('[RightSidebar] Skipping operations - mode is "ask"');
          return;
        }
        if (currentMode === 'plan') {
          console.log('[RightSidebar] Skipping operations - mode is "plan"');
          return;
        }
        console.log('[RightSidebar] Executing operations:', operations);
        const descriptions = runOperations(operations);
        console.log('[RightSidebar] Operations executed, descriptions:', descriptions);
        if (descriptions.length > 0) {
          setMessages(prev => prev.map(m => m.id === placeholderId
            ? { ...m, text: m.text + `\n\n**Applied:** ${descriptions.join('; ')}` }
            : m));
        }
      },
      onPlanReady: (operations) => {
        if (currentMode !== 'plan') return;
        setMessages(prev => prev.map(m => m.id === placeholderId
          ? { ...m, pendingConfirmation: { type: 'plan_execute', operations } }
          : m));
      },
      onDone: (payload) => {
        if (payload.sessionId) setSessionId(payload.sessionId);
        setMessages(prev => prev.map(m => {
          if (m.id !== placeholderId) return m;
          const updated = { ...m, streaming: false, tokenInfo: payload.tokenInfo ?? null, text: stripOperationsBlock(m.text) };
          return updated;
        }));
        setIsLoading(false);
      },
      onError: (message) => {
        setMessages(prev => prev.map(m => m.id === placeholderId
          ? { ...m, text: `Error: ${message}`, streaming: false }
          : m));
        setIsLoading(false);
      },
    }).catch(async (err) => {
      try {
        const response = await controllerClient.askAI(req);
        applyNonStreamResponse(response);
      } catch (fallbackErr: any) {
        const msg = fallbackErr?.message || err?.message || 'Failed to connect to AI service.';
        setMessages(prev => prev.map(m => m.id === placeholderId
          ? { ...m, text: `Error: ${msg}. Make sure the controller is running (e.g. npm run dev in apps/controller-node).`, streaming: false }
          : m));
        setIsLoading(false);
      }
    });
  };

  const handleConfirmation = (
    messageId: string,
    accepted: boolean,
    actionData?: { type: 'delete_notebook'; name?: string } | { type: 'plan_execute'; operations: Array<{ type: string; params: Record<string, any> }> }
  ) => {
    setMessages(prev => prev.map(m => {
      if (m.id === messageId) {
        return { ...m, isConfirmed: accepted, pendingConfirmation: accepted ? m.pendingConfirmation : undefined };
      }
      return m;
    }));

    if (accepted && actionData) {
      if (actionData.type === 'delete_notebook') {
        onDeleteNotebook(actionData.name);
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'ai',
          text: `Notebook "${actionData.name || 'Current'}" deleted successfully.`
        }]);
      } else if (actionData.type === 'plan_execute') {
        const runOperations = (ops: Array<{ type: string; params: Record<string, any> }>): void => {
          ops.forEach((op) => {
            switch (op.type) {
              case 'create_notebook':
                onCreateNotebook(op.params.name);
                break;
              case 'add_cell': {
                const cellType = (op.params.type === 'markdown' ? 'markdown' : 'code') as 'code' | 'markdown';
                onAddCell(op.params.content ?? '', cellType);
                break;
              }
              case 'move_cell':
                onMoveCell(op.params.fromIndex, op.params.toIndex);
                break;
              case 'delete_cell':
                onDeleteCell(op.params.cellIndex);
                break;
              case 'edit_cell': {
                const editType = (op.params.type === 'markdown' ? 'markdown' : 'code') as 'code' | 'markdown' | undefined;
                onEditCell(op.params.cellIndex, op.params.content ?? '', editType);
                break;
              }
              case 'add_package':
                onAddPackages(op.params.packages || []);
                break;
              case 'delete_notebook':
                setMessages(prev => [...prev, {
                  id: (Date.now() + Math.random()).toString(),
                  role: 'ai',
                  text: `Request to DELETE notebook: "${op.params.name || 'Current Notebook'}". This action cannot be undone.`,
                  pendingConfirmation: { type: 'delete_notebook', name: op.params.name }
                }]);
                break;
            }
          });
        };
        runOperations(actionData.operations);
        setMessages(prev => prev.map(m =>
          m.id === messageId ? { ...m, text: m.text + '\n\n**Plan executed successfully.**', pendingConfirmation: undefined } : m
        ));
      }
    } else if (!accepted) {
      setMessages(prev => prev.map(m =>
        m.id === messageId ? { ...m, text: m.text + '\n\n**Plan cancelled.**', pendingConfirmation: undefined } : m
      ));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    // 1. Check for Cell Drag Data (JSON)
    const jsonData = e.dataTransfer.getData('application/json');
    if (jsonData) {
      try {
        const data = JSON.parse(jsonData);
        if (data.type === 'cell-drag') {
          const cellId = `cell-${data.index}`;
          if (attachedFiles.some(af => af.id === cellId)) return;

          setAttachedFiles(prev => [...prev, {
            id: cellId,
            name: `Cell ${data.index}`,
            content: data.content,
            type: 'cell'
          }]);
          return;
        }
      } catch (err) {
        // Not JSON or invalid format, continue to other checks
      }
    }

    // 2. Check for File Drag Data (Sim ID)
    const simFileId = e.dataTransfer.getData('application/x-sim-file-id');
    if (simFileId) {
      const file = projectFiles.find(f => f.id === simFileId);
      if (file) {
        if (attachedFiles.some(af => af.id === file.id)) return;
        let content = '';
        if (file.cells) {
          content = file.cells.map((c, i) => `[Cell ${i + 1}] (${c.type})\n${c.content}`).join('\n\n');
        } else if (file.file) {
          try {
            if (file.file.size > 1024 * 1024) {
              content = (await file.file.text()).substring(0, 5000) + "\n...(truncated)";
            } else {
              content = await file.file.text();
            }
          } catch (err) {
            content = "[Error reading file content. Binary file?]";
          }
        } else {
          content = "[Empty or Virtual File]";
        }
        setAttachedFiles(prev => [...prev, { id: file.id, name: file.name, content: content, type: 'file' }]);
      }
      return;
    }

    // 3. Fallback to Plain Text
    const text = e.dataTransfer.getData('text/plain');
    if (text) {
      setInputValue(prev => {
        const separator = prev.length > 0 ? ' ' : '';
        return prev + separator + text;
      });
    }
  };

  const removeAttachment = (id: string) => {
    setAttachedFiles(prev => prev.filter(f => f.id !== id));
  };

  return (
    <div
      className={`bg-sim-bg flex flex-col z-20 shrink-0 relative rounded-2xl border border-sim-border overflow-hidden shadow-lg
        ${isResizing ? '' : 'transition-all duration-300 ease-in-out'}
        ${isOpen ? '' : 'w-0 border-l-0 overflow-hidden'}
      `}
      style={{ width: isOpen ? `${width}px` : '0px' }}
    >
      {/* Header */}


      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 bg-black/20 space-y-5 font-mono">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-60">
            <div className="w-16 h-16 rounded-full bg-sim-red/10 flex items-center justify-center mb-6 animate-pulse">
              <Zap className="w-8 h-8 text-sim-red fill-current" />
            </div>
            <h3 className="text-white font-bold text-lg mb-2">OPREL INTELLIGENCE</h3>
            <p className="text-gray-400 text-xs leading-relaxed max-w-[280px]">
              Drag cells or files here to attach context, or ask me to perform operations on your notebook.
            </p>
            <div className="mt-8 grid grid-cols-1 gap-2 w-full max-w-[280px]">
              {[
                { icon: Plus, text: "Add a visualization cell" },
                { icon: Wrench, text: "How to fix the syntax error?" },
                { icon: Code, text: "Convert this to a pivot table" }
              ].map((s, i) => (
                <button
                  key={i}
                  onClick={() => setInputValue(s.text)}
                  className="flex items-center gap-3 bg-white/5 border border-white/5 hover:bg-white/10 p-3 rounded-xl text-[11px] text-left transition-all hover:translate-x-1"
                >
                  <s.icon className="w-3.5 h-3.5 text-sim-red" />
                  <span className="text-gray-300 truncate">{s.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col gap-2 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''} w-full`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 border mt-1
                  ${msg.role === 'ai' ? 'bg-transparent border-transparent' : 'bg-sim-red border-sim-red text-white'}
                `}>
                {msg.role === 'ai' ? (
                  <Zap className="w-3.5 h-3.5 text-sim-red fill-current" />
                ) : (
                  <User className="w-3.5 h-3.5" />
                )}
              </div>

              <div className={`flex flex-col gap-1 max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                {/* Message Attachments */}
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className={`flex flex-wrap gap-2 mb-1 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {msg.attachments.map(file => (
                      <div key={file.id} className="flex items-center gap-1.5 bg-sim-surface border border-sim-border text-[10px] font-mono text-gray-300 px-2 py-1 rounded select-none shadow-sm">
                        {file.type === 'cell' ? <Code className="w-3 h-3 text-sim-red" /> : <FileIcon className="w-3 h-3 text-sim-muted" />}
                        <span className="truncate max-w-[150px]">{file.name}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className={`text-sm leading-relaxed w-full
                    ${msg.role === 'ai'
                    ? 'text-gray-300 pl-0'
                    : 'bg-[#27272a] text-white border border-sim-border rounded-lg p-3 shadow-sm'}
                  `}>
                  {msg.role === 'ai' ? (
                    <div className="text-gray-300">
                      {/* While streaming, the markdown may be incomplete (e.g. unfinished ``` fences).
                          Rendering with syntax highlighting can break incremental updates. */}
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={msg.streaming ? [] : [rehypeHighlight]}
                        components={{
                          p: (props) => <p className="my-2 whitespace-pre-wrap" {...props} />,
                          a: (props) => <a className="text-sim-red underline" target="_blank" rel="noreferrer" {...props} />,
                          ul: (props) => <ul className="list-disc ml-5 my-2" {...props} />,
                          ol: (props) => <ol className="list-decimal ml-5 my-2" {...props} />,
                          li: (props) => <li className="my-1" {...props} />,
                          code: ({ inline, className, children, ...props }: any) => {
                            if (inline) {
                              return (
                                <code className="px-1 py-0.5 rounded bg-white/5 border border-white/10 text-[12px]" {...props}>
                                  {children}
                                </code>
                              );
                            }
                            return (
                              <code className={`${className ?? ''}`} {...props}>
                                {children}
                              </code>
                            );
                          },
                          pre: (props) => (
                            <pre className="my-3 p-3 rounded-lg bg-black/40 border border-white/10 overflow-x-auto text-[12px] leading-relaxed" {...props} />
                          ),
                          blockquote: (props) => (
                            <blockquote className="border-l-2 border-white/20 pl-3 my-2 text-white/70" {...props} />
                          ),
                          hr: (props) => <hr className="my-3 border-white/10" {...props} />,
                        }}
                      >
                        {msg.text}
                      </ReactMarkdown>
                      {msg.streaming && <span className="inline-block w-2 h-4 ml-0.5 bg-sim-red animate-pulse align-text-bottom" />}
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap">{msg.text}{msg.streaming && <span className="inline-block w-2 h-4 ml-0.5 bg-sim-red animate-pulse" />}</div>
                  )}
                </div>
                {/* Token info */}
                {msg.tokenInfo && (
                  <div className={`text-[11px] font-mono mt-1 ${msg.role === 'user' ? 'text-sim-muted text-right' : 'text-sim-muted text-left'}`}>
                    Tokens: {msg.tokenInfo.total_tokens ?? msg.tokenInfo.prompt_tokens ?? 0}
                  </div>
                )}
              </div>
            </div>

            {/* Confirmation UI Block */}
            {msg.pendingConfirmation && msg.isConfirmed === undefined && (
              <div className={`ml-10 w-[85%] rounded-lg p-3 flex flex-col gap-2 ${
                msg.pendingConfirmation.type === 'plan_execute'
                  ? 'bg-sim-surface/50 border border-white/20'
                  : 'bg-sim-surface/50 border border-sim-red/50'
              }`}>
                <div className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wider ${
                  msg.pendingConfirmation.type === 'plan_execute' ? 'text-white' : 'text-sim-red'
                }`}>
                  {msg.pendingConfirmation.type === 'plan_execute' ? (
                    <ListChecks className="w-4 h-4" />
                  ) : (
                    <AlertTriangle className="w-4 h-4" />
                  )}
                  {msg.pendingConfirmation.type === 'plan_execute' ? 'Plan Ready' : 'Confirmation Required'}
                </div>
                <p className="text-xs text-sim-muted">
                  {msg.pendingConfirmation.type === 'plan_execute'
                    ? 'Review the plan above. Execute to apply changes to your notebook, or cancel to discard.'
                    : 'Please confirm you want to proceed with this destructive action.'}
                </p>
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={() => handleConfirmation(msg.id, true, msg.pendingConfirmation)}
                    className={`flex-1 flex items-center justify-center gap-1.5 text-white text-xs font-bold py-1.5 rounded transition-colors ${
                      msg.pendingConfirmation.type === 'plan_execute'
                        ? 'bg-sim-red hover:bg-sim-redHover'
                        : 'bg-sim-red hover:bg-sim-redHover'
                    }`}
                  >
                    {msg.pendingConfirmation.type === 'plan_execute' ? (
                      <><Check className="w-3.5 h-3.5" /> EXECUTE PLAN</>
                    ) : (
                      <><Check className="w-3.5 h-3.5" /> ACCEPT</>
                    )}
                  </button>
                  <button
                    onClick={() => handleConfirmation(msg.id, false)}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-sim-surface border border-sim-border hover:bg-sim-border text-sim-muted text-xs font-bold py-1.5 rounded transition-colors"
                  >
                    {msg.pendingConfirmation.type === 'plan_execute' ? (
                      <><Ban className="w-3.5 h-3.5" /> CANCEL</>
                    ) : (
                      <><Ban className="w-3.5 h-3.5" /> REJECT</>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Post-Confirmation Status - only for delete_notebook (plan_execute updates message text) */}
            {msg.pendingConfirmation?.type === 'delete_notebook' && msg.isConfirmed !== undefined && (
              <div className={`ml-10 text-xs font-mono font-bold flex items-center gap-2 mt-1 ${msg.isConfirmed ? 'text-green-500' : 'text-sim-muted'}`}>
                {msg.isConfirmed ? <Check className="w-3 h-3" /> : <Ban className="w-3 h-3" />}
                {msg.isConfirmed ? 'ACTION AUTHORIZED' : 'ACTION REJECTED'}
              </div>
            )}
          </div>
        ))}
        {/* Removed Loading Bubble - Logic handled by input area state now */}
        <div ref={messagesEndRef} />
      </div>

      {/* Redesigned Prompt Area */}
      <div className="p-4 bg-transparent shrink-0">
        <div
          className={`
            relative flex flex-col gap-0
            bg-[#1a1a1c]/80 backdrop-blur-xl border border-white/5 rounded-2xl transition-all duration-300 shadow-2xl
            ${isDragOver ? 'ring-2 ring-sim-red/50 bg-sim-red/5' : ''}
            ${isLoading ? 'opacity-70 cursor-not-allowed' : 'focus-within:border-white/20 focus-within:bg-[#1a1a1c]'}
          `}
          onDragOver={!isLoading ? handleDragOver : undefined}
          onDragLeave={!isLoading ? handleDragLeave : undefined}
          onDrop={!isLoading ? handleDrop : undefined}
        >
          {/* Loading Overlay */}
          {isLoading && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/20 backdrop-blur-[2px] rounded-2xl">
              <div className="flex items-center gap-3 text-white text-xs font-bold tracking-tighter animate-pulse bg-sim-red/90 px-4 py-2 rounded-full shadow-lg shadow-sim-red/20 uppercase">
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing Response
              </div>
            </div>
          )}

          {/* Drag Overlay */}
          {isDragOver && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-sim-red/20 backdrop-blur-md text-white font-bold text-sm rounded-2xl border-2 border-dashed border-sim-red/50 animate-in fade-in zoom-in duration-200">
              <Paperclip className="w-8 h-8 mb-2 animate-bounce" />
              ATTACH CONTEXT
            </div>
          )}

          {/* Context Chips */}
          {(attachedFiles.length > 0 || (activeCell && !isSuggestedAttached)) && (
            <div className="flex flex-wrap gap-2 p-3 pb-0">
              {/* Active Attachments */}
              {attachedFiles.map(file => (
                <div key={file.id} className="flex items-center gap-2 bg-white/5 border border-white/10 text-[10px] font-bold text-gray-300 px-2.5 py-1.5 rounded-lg cursor-default group hover:bg-white/10 transition-all select-none shadow-sm">
                  {file.type === 'cell' ? <Code className="w-3.5 h-3.5 text-sim-red" /> : <Paperclip className="w-3.5 h-3.5 text-sim-muted" />}
                  <span className="truncate max-w-[120px]">{file.name}</span>
                  <button
                    onClick={() => removeAttachment(file.id)}
                    className="text-sim-muted hover:text-white transition-colors"
                    disabled={isLoading}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}

              {/* Active Cell Suggestion */}
              {activeCell && !isSuggestedAttached && !isLoading && (
                <button
                  onClick={addActiveCellAttachment}
                  className="flex items-center gap-2 bg-sim-red/10 border border-sim-red/20 border-dashed text-[10px] font-bold text-sim-red px-2.5 py-1.5 rounded-lg cursor-pointer hover:bg-sim-red/20 transition-all select-none hover:border-sim-red/40"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Attach Cell {activeCellIndex + 1}</span>
                </button>
              )}
            </div>
          )}

          {/* Text Input Area */}
          <div className="relative">
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              placeholder={attachedFiles.length === 0 ? "Ask OPREL anything..." : "Ask about your data..."}
              className={`w-full bg-transparent border-none text-white text-[13px] leading-relaxed p-4 focus:ring-0 resize-none placeholder-white/20 outline-none min-h-[60px] max-h-[200px] overflow-y-auto no-scrollbar ${isLoading ? 'opacity-50' : ''}`}
              rows={1}
              style={{ height: 'auto' }}
            />
          </div>

          {/* Mode selector + Action Bar */}
          <div className="flex flex-col gap-2 px-3 pb-3 select-none">
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider mr-1">Mode:</span>
              {(['ask', 'agent', 'plan'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => !isLoading && setSelectedMode(m)}
                  disabled={isLoading}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold transition-colors ${
                    selectedMode === m
                      ? 'bg-sim-red text-white'
                      : 'text-white/50 hover:text-white/80 hover:bg-white/5'
                  }`}
                  title={m === 'ask' ? 'Ask questions only, no edits' : m === 'agent' ? 'Ask when unclear, then act' : 'Show plan first, execute on confirm'}
                >
                  {m === 'ask' && <MessageCircle className="w-3 h-3" />}
                  {m === 'agent' && <Bot className="w-3 h-3" />}
                  {m === 'plan' && <ListChecks className="w-3 h-3" />}
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              {(messages.length > 0 || sessionId) && (
                <button
                  onClick={() => { setSessionId(null); setMessages([]); }}
                  disabled={isLoading}
                  className="p-1.5 text-white/30 hover:text-white/60 transition-colors"
                  title="New chat"
                >
                  <MessageSquarePlus className="w-4 h-4" />
                </button>
              )}
              <ModelSelector onOpenManage={onOpenManageModels} refreshTrigger={modelsRefreshTrigger} />
              <div className="h-4 w-[1px] bg-white/5 mx-1" />
              <button className="p-1.5 text-white/30 hover:text-white/60 transition-colors" title="Voice query (Coming Soon)">
                {/* Placeholder icon or future feature */}
              </button>
            </div>

            <button
              onClick={handleSend}
              disabled={isLoading || (!inputValue.trim() && attachedFiles.length === 0)}
              className={`flex items-center justify-center p-2 rounded-xl transition-all duration-300
                ${(inputValue.trim() || attachedFiles.length > 0) && !isLoading
                  ? 'bg-sim-red text-white shadow-lg shadow-sim-red/20 hover:scale-105 active:scale-95'
                  : 'bg-white/5 text-white/10 cursor-not-allowed'}
              `}
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
            </div>
          </div>
        </div>
        <p className="mt-3 text-[10px] text-center text-white/20 font-medium tracking-tight">
          AI generated content may contain inaccuracies.
        </p>
      </div>
    </div>
  );
};
