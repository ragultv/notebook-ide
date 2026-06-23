import React, { useState, useRef, useEffect } from 'react';
import { useAgentChat } from '../../hooks/useAgentChat.js';
import type { NotebookCell } from '../../hooks/useAgentChat.js';
import { ModeSelector } from './ModeSelector.js';
import { ToolCallBlock } from './ToolCallBlock.js';
import { EscalationBanner } from './EscalationBanner.js';
import { ExecutionOutput } from './ExecutionOutput.js';

interface ChatPanelProps {
  projectPath:   string;
  sessionId:     string;
  notebookCells: NotebookCell[];
  onCellCreate?: (afterCellId: string | null, cellType: 'code' | 'markdown', source: string) => void;
  onCellUpdate?: (cellId: string, source: string) => void;
  onCellDelete?: (cellId: string) => void;
}

export function ChatPanel({
  projectPath, sessionId, notebookCells,
  onCellCreate, onCellUpdate, onCellDelete,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const messagesEndRef    = useRef<HTMLDivElement>(null);

  const {
    messages, toolCalls, kernelLines, escalation, isLoading, mode,
    sendMessage, setMode, dismissEscalation, clearKernelOutput,
  } = useAgentChat({
    projectPath, sessionId, notebookCells,
    onCellCreate, onCellUpdate, onCellDelete,
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    void sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Associate tool calls with the preceding assistant message by index
  const msgToolCalls = (msgId: string) =>
    toolCalls.filter(tc => tc.id.startsWith(`tc-`) && messages.find(m => m.id === msgId));

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 text-sm">
      {/* Mode selector */}
      <div className="p-2 border-b border-gray-200 dark:border-gray-700">
        <ModeSelector mode={mode} onChange={setMode} />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={[
                'max-w-[85%] rounded-lg px-3 py-2 whitespace-pre-wrap leading-relaxed',
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100',
              ].join(' ')}
            >
              {msg.content}
              {/* Render tool calls that arrived with this assistant message */}
              {msg.role === 'assistant' && msgToolCalls(msg.id).map(tc => (
                <ToolCallBlock key={tc.id} toolCall={tc} />
              ))}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2 text-gray-400 animate-pulse">
              OctoML is thinking…
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Execution output */}
      <ExecutionOutput lines={kernelLines} onClear={clearKernelOutput} />

      {/* Escalation banner */}
      {escalation && (
        <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700">
          <EscalationBanner
            escalation={escalation}
            onSwitch={setMode}
            onDismiss={dismissEscalation}
          />
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-gray-200 dark:border-gray-700 p-2 flex gap-2">
        <textarea
          ref={(el) => {
            if (el) {
              setTimeout(() => {
                if (document.activeElement !== el) el.focus();
              }, 50);
            }
          }}
          autoFocus
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Ask OctoML (${mode} mode)…`}
          rows={2}
          disabled={isLoading}
          className="flex-1 resize-none text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={isLoading || !input.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed self-end"
        >
          Send
        </button>
      </div>
    </div>
  );
}
