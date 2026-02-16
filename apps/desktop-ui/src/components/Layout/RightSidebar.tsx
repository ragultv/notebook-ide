import React, { useState, useRef, useEffect } from 'react';
import { X, Send, User, CornerDownLeft, Zap, ChevronDown, Wrench, Paperclip, AlertTriangle, Check, Ban, File as FileIcon, Code, Plus, Loader2 } from 'lucide-react';
import { controllerClient } from '../../services/controller.client';
import { CellData, ProjectFile } from '../../types';
import { ModelSelector } from '../ModelSelector';

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

interface Message {
  id: string;
  role: 'user' | 'ai';
  text: string;
  tokenInfo?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  pendingConfirmation?: {
    type: 'delete_notebook';
    name?: string;
  };
  isConfirmed?: boolean; // true = accepted, false = rejected
  attachments?: AttachedFile[];
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
  const [messages, setMessages] = useState<Message[]>([
    // { id: '1', role: 'ai', text: 'OPREL INTELLIGENCE SYSTEM ONLINE. CONNECTED TO NVIDIA NIM.' }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

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

    try {
      // Call the backend AI service with proper request structure
      const response = await controllerClient.askAI({
        prompt: finalMessage,
        context: {
          notebookName: notebookName,
          cells: notebookCells.map(c => ({ type: c.type, content: c.content }))
        }
      });

      let addedCount = 0;
      let deletedCount = 0;
      let movedCount = 0;
      let createdCount = 0;

      // Execute operations progressively (Streaming Effect)
      if (response.operations && response.operations.length > 0) {
        for (const op of response.operations) {
          switch (op.type) {
            case 'create_notebook':
              onCreateNotebook(op.params.name);
              createdCount++;
              // Wait longer after creating notebook to ensure state is updated
              await new Promise(resolve => setTimeout(resolve, 600));
              break;
            case 'add_cell':
              onAddCell(op.params.content, op.params.type);
              addedCount++;
              // Delay between cells for visual effect
              await new Promise(resolve => setTimeout(resolve, 400));
              break;
            case 'move_cell':
              onMoveCell(op.params.fromIndex, op.params.toIndex);
              movedCount++;
              await new Promise(resolve => setTimeout(resolve, 400));
              break;
            case 'delete_cell':
              onDeleteCell(op.params.cellIndex);
              deletedCount++;
              await new Promise(resolve => setTimeout(resolve, 400));
              break;
            case 'delete_notebook':
              // Don't execute immediately; push a confirmation message
              setMessages(prev => [...prev, {
                id: (Date.now() + Math.random()).toString(),
                role: 'ai',
                text: `Request to DELETE notebook: "${op.params.name || 'Current Notebook'}". This action cannot be undone.`,
                pendingConfirmation: {
                  type: 'delete_notebook',
                  name: op.params.name
                }
              }]);
              break;
            case 'edit_cell':
              onEditCell(op.params.cellIndex, op.params.content, op.params.type);
              movedCount++; // Reusing for edits
              await new Promise(resolve => setTimeout(resolve, 400));
              break;
            case 'add_package':
              onAddPackages(op.params.packages || []);
              await new Promise(resolve => setTimeout(resolve, 400));
              break;
          }
        }
      }

      const actionSummary: string[] = [];
      if (createdCount > 0) actionSummary.push(`Created ${createdCount} notebook(s).`);
      if (addedCount > 0) actionSummary.push(`Added ${addedCount} cell(s).`);
      if (movedCount > 0) actionSummary.push(`Modified ${movedCount} cell(s).`);
      if (deletedCount > 0) actionSummary.push(`Deleted ${deletedCount} cell(s).`);

      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        text: response.text || (actionSummary.length > 0 ? "Actions executed:\n- " + actionSummary.join("\n- ") : "I couldn't process that request."),
        tokenInfo: response.tokenInfo || null,
      };

      setMessages(prev => [...prev, aiMsg]);
    } catch (error) {
      console.error('AI request failed:', error);
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        text: `Error: ${error instanceof Error ? error.message : 'Failed to connect to AI service. Make sure the backend is running.'}`
      }]);
    }

    setIsLoading(false);
  };

  const handleConfirmation = (messageId: string, accepted: boolean, actionData?: { type: 'delete_notebook', name?: string }) => {
    setMessages(prev => prev.map(m => {
      if (m.id === messageId) {
        return { ...m, isConfirmed: accepted };
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
      }
    } else if (!accepted) {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'ai',
        text: `Action cancelled.`
      }]);
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
      className={`bg-sim-bg border-sim-border flex flex-col z-20 shrink-0 relative rounded-2xl border border-sim-border overflow-hidden shadow-lg
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
                  <div className="whitespace-pre-wrap">{msg.text}</div>
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
              <div className="ml-10 w-[85%] bg-sim-surface/50 border border-sim-red/50 rounded-lg p-3 flex flex-col gap-2">
                <div className="flex items-center gap-2 text-sim-red text-xs font-bold uppercase tracking-wider">
                  <AlertTriangle className="w-4 h-4" />
                  Confirmation Required
                </div>
                <p className="text-xs text-sim-muted">
                  Please confirm you want to proceed with this destructive action.
                </p>
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={() => handleConfirmation(msg.id, true, msg.pendingConfirmation)}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-sim-red hover:bg-sim-redHover text-white text-xs font-bold py-1.5 rounded transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" /> ACCEPT
                  </button>
                  <button
                    onClick={() => handleConfirmation(msg.id, false)}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-sim-surface border border-sim-border hover:bg-sim-border text-sim-muted text-xs font-bold py-1.5 rounded transition-colors"
                  >
                    <Ban className="w-3.5 h-3.5" /> REJECT
                  </button>
                </div>
              </div>
            )}

            {/* Post-Confirmation Status */}
            {msg.pendingConfirmation && msg.isConfirmed !== undefined && (
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

          {/* Action Bar */}
          <div className="flex items-center justify-between px-3 pb-3 select-none">
            <div className="flex items-center gap-1">
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
        <p className="mt-3 text-[10px] text-center text-white/20 font-medium tracking-tight">
          AI generated content may contain inaccuracies.
        </p>
      </div>
    </div>
  );
};
