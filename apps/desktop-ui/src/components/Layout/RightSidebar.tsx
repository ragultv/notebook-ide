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
}

interface Message {
  id: string;
  role: 'user' | 'ai';
  text: string;
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
  modelsRefreshTrigger
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
          // Artificial delay to simulate streaming
          await new Promise(resolve => setTimeout(resolve, 400));

          switch (op.type) {
            case 'create_notebook':
              onCreateNotebook(op.params.name);
              createdCount++;
              break;
            case 'add_cell':
              onAddCell(op.params.content, op.params.type);
              addedCount++;
              break;
            case 'move_cell':
              onMoveCell(op.params.fromIndex, op.params.toIndex);
              movedCount++;
              break;
            case 'delete_cell':
              onDeleteCell(op.params.cellIndex);
              deletedCount++;
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
              break;
            case 'add_package':
              onAddPackages(op.params.packages || []);
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
        text: response.text || (actionSummary.length > 0 ? "Actions executed:\n- " + actionSummary.join("\n- ") : "I couldn't process that request.")
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
      className={`bg-sim-bg border-l border-sim-border flex flex-col transition-all duration-300 ease-in-out shadow-2xl z-20
        ${isOpen ? 'w-[450px] translate-x-0' : 'w-0 translate-x-full hidden'}
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-sim-border bg-sim-surface shrink-0">
        <div className="flex items-center gap-2 text-sim-red">
          <Zap className="w-4 h-4 fill-current" />
          <span className="font-mono font-bold tracking-wider text-white text-sm">OPREL AI</span>
        </div>
        <button onClick={onClose} className="text-sim-muted hover:text-white rounded p-1 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 bg-black/20 space-y-5 font-mono">
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

      {/* Input Area */}
      <div className="p-4 bg-sim-surface border-t border-sim-border shrink-0">
        <div
          className={`
            relative flex flex-col gap-0
            bg-[#09090b] border transition-colors rounded-lg
            ${isDragOver ? 'border-sim-red bg-sim-red/5' : ''}
            ${isLoading ? 'border-sim-border opacity-70 cursor-not-allowed' : 'border-sim-border focus-within:border-sim-muted'}
          `}
          onDragOver={!isLoading ? handleDragOver : undefined}
          onDragLeave={!isLoading ? handleDragLeave : undefined}
          onDrop={!isLoading ? handleDrop : undefined}
        >
          {/* Loading Overlay */}
          {isLoading && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-[1px] rounded-lg">
              <div className="flex items-center gap-2 text-sim-muted text-xs font-mono animate-pulse bg-[#09090b] px-3 py-1.5 rounded-full border border-sim-border shadow-lg">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-sim-red" />
                PROCESSING...
              </div>
            </div>
          )}

          {/* Drag Overlay */}
          {isDragOver && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-sm text-sim-red font-mono text-sm font-medium rounded-lg">
              <CornerDownLeft className="w-5 h-5 mr-2" />
              DROP TO ATTACH CONTEXT
            </div>
          )}

          {/* Context Chips (Including Suggestion) */}
          {(attachedFiles.length > 0 || (activeCell && !isSuggestedAttached)) && (
            <div className="flex flex-wrap gap-2 p-2 pb-0 pt-2">
              {/* Active Attachments */}
              {attachedFiles.map(file => (
                <div key={file.id} className="flex items-center gap-1.5 bg-[#27272a] border border-sim-border text-[11px] font-mono text-gray-300 px-2 py-1 rounded cursor-default group hover:border-sim-muted transition-colors select-none">
                  {file.type === 'cell' ? <Code className="w-3 h-3 text-sim-red" /> : <Paperclip className="w-3 h-3 text-sim-muted" />}
                  <span className="truncate max-w-[150px]">{file.name}</span>
                  <button
                    onClick={() => removeAttachment(file.id)}
                    className="text-sim-muted hover:text-white ml-1"
                    disabled={isLoading}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}

              {/* Active Cell Suggestion */}
              {activeCell && !isSuggestedAttached && !isLoading && (
                <button
                  onClick={addActiveCellAttachment}
                  className="flex items-center gap-1.5 bg-sim-red/10 border border-sim-red/30 border-dashed text-[11px] font-mono text-sim-red px-2 py-1 rounded cursor-pointer hover:bg-sim-red/20 transition-colors select-none"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add Cell {activeCellIndex + 1}</span>
                </button>
              )}
            </div>
          )}

          {/* Text Input */}
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            placeholder={attachedFiles.length === 0 ? "Ask a question or drag files/cells for context..." : "Ask a question about these items..."}
            className={`w-full bg-transparent border-none text-gray-200 text-sm font-mono p-3 focus:ring-0 resize-none placeholder-sim-muted/50 outline-none ${isLoading ? 'text-gray-500' : ''}`}
            rows={Math.max(2, inputValue.split('\n').length)}
            style={{ scrollbarWidth: 'none' }}
          />

          {/* Footer Bar */}
          <div className="flex items-center justify-between px-2 pb-2 mt-1 select-none relative">
            <div className="flex items-center gap-2">
              <ModelSelector onOpenManage={onOpenManageModels} refreshTrigger={modelsRefreshTrigger} />
            </div>

            <button
              onClick={handleSend}
              disabled={isLoading || (!inputValue.trim() && attachedFiles.length === 0)}
              className={`p-1.5 rounded transition-all flex items-center justify-center w-7 h-7 ${(inputValue.trim() || attachedFiles.length > 0) && !isLoading
                  ? 'bg-white text-black hover:bg-gray-200'
                  : 'bg-[#27272a] text-sim-muted cursor-not-allowed'
                }`}
            >
              {isLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
