import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { useAgentChat } from '../../hooks/useAgentChat.js';
import type { NotebookCell } from '../../hooks/useAgentChat.js';
import { ModeSelector } from './ModeSelector.js';
import { ToolCallBlock } from './ToolCallBlock.js';
import { EscalationBanner } from './EscalationBanner.js';
import { ExecutionOutput } from './ExecutionOutput.js';

interface ChatPanelProps {
  projectPath:        string;
  sessionId:          string;
  notebookCells:      NotebookCell[];
  onCellCreate?:      (afterCellId: string | null, cellType: 'code' | 'markdown', source: string) => void;
  onCellUpdate?:      (cellId: string, source: string) => void;
  onCellDelete?:      (cellId: string) => void;
  onCellRunStart?:    (cellId: string) => void;
  onCellRunComplete?: (cellId: string, success: boolean) => void;
}

function AssistantMessage({ content }: { content: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none prose-pre:p-0 prose-pre:bg-transparent prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ children }) => (
            <pre className="rounded-md overflow-x-auto text-xs bg-gray-900 text-gray-100 p-3 my-2">{children}</pre>
          ),
          code: ({ className, children, ...props }) => {
            const isBlock = className?.startsWith('language-');
            return isBlock
              ? <code className={className} {...props}>{children}</code>
              : <code className="bg-gray-200 dark:bg-gray-700 rounded px-1 py-0.5 text-xs font-mono" {...props}>{children}</code>;
          },
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table className="text-xs border-collapse w-full">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 bg-gray-100 dark:bg-gray-700 font-semibold text-left">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border border-gray-300 dark:border-gray-600 px-2 py-1">{children}</td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

interface PlanViewerProps {
  goal: string;
  tasks: Array<{ id: string; description: string; status: string }>;
  onProceed: () => void;
}

function PlanViewer({ goal, tasks, onProceed }: PlanViewerProps) {
  const statusIcon: Record<string, string> = { done: '✓', in_progress: '◉', failed: '✗', pending: '○' };
  const statusColor: Record<string, string> = {
    done:        'text-green-600 dark:text-green-400',
    in_progress: 'text-blue-600 dark:text-blue-400',
    failed:      'text-red-600 dark:text-red-400',
    pending:     'text-gray-500 dark:text-gray-400',
  };

  return (
    <div className="mt-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-blue-600 dark:text-blue-400">📋</span>
        <span className="font-semibold text-xs text-blue-800 dark:text-blue-300 uppercase tracking-wide">Plan ready</span>
      </div>
      <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">{goal}</p>
      <ol className="space-y-1 mb-3">
        {tasks.map((t, i) => (
          <li key={t.id} className="flex items-start gap-2 text-xs">
            <span className={`mt-0.5 w-4 shrink-0 font-mono ${statusColor[t.status] ?? 'text-gray-500'}`}>
              {statusIcon[t.status] ?? '○'}
            </span>
            <span className="text-gray-700 dark:text-gray-300">{i + 1}. {t.description}</span>
          </li>
        ))}
      </ol>
      <button
        onClick={onProceed}
        className="w-full py-1.5 px-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-md transition-colors"
      >
        ▶ Proceed — switch to Agentic and implement
      </button>
    </div>
  );
}

export function ChatPanel({
  projectPath, sessionId, notebookCells,
  onCellCreate, onCellUpdate, onCellDelete,
  onCellRunStart, onCellRunComplete,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const messagesEndRef    = useRef<HTMLDivElement>(null);

  const {
    messages, toolCalls, kernelLines, escalation, isLoading, mode, activePlan,
    sendMessage, setMode, dismissEscalation, clearKernelOutput, proceedWithPlan,
  } = useAgentChat({
    projectPath, notebookCells,
    onCellCreate, onCellUpdate, onCellDelete,
    onCellRunStart, onCellRunComplete,
  });

  // "Switch & Continue" — switches mode then immediately sends a continue message
  const handleSwitchAndContinue = useCallback((newMode: typeof mode) => {
    setMode(newMode);
    dismissEscalation();
    void sendMessage('Continue. Proceed autonomously in the new mode.', newMode);
  }, [setMode, dismissEscalation, sendMessage]);

  // Track which assistant messages have a plan attached
  const planMsgId = useRef<string>('');

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // When activePlan changes, associate it with the most recent assistant message
  useEffect(() => {
    if (!activePlan) return;
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
    if (lastAssistant) planMsgId.current = lastAssistant.id;
  }, [activePlan, messages]);

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

  // Tool calls only belong to the current (last) assistant message — cleared on each new sendMessage
  const lastAssistantId = [...messages].reverse().find(m => m.role === 'assistant')?.id ?? '';

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
                'max-w-[90%] rounded-lg px-3 py-2 leading-relaxed',
                msg.role === 'user'
                  ? 'bg-blue-600 text-white whitespace-pre-wrap'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100',
              ].join(' ')}
            >
              {msg.role === 'assistant' ? (
                <AssistantMessage content={msg.content} />
              ) : (
                msg.content
              )}

              {/* Tool calls shown only on the latest assistant message (cleared each turn) */}
              {msg.role === 'assistant' && msg.id === lastAssistantId && toolCalls.map(tc => (
                <ToolCallBlock key={tc.id} toolCall={tc} />
              ))}

              {/* Plan viewer pinned to the assistant message that created it */}
              {msg.role === 'assistant' && activePlan && planMsgId.current === msg.id && (
                <PlanViewer
                  goal={activePlan.goal}
                  tasks={activePlan.tasks}
                  onProceed={proceedWithPlan}
                />
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2 text-gray-400 animate-pulse text-xs">
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
            onSwitchAndContinue={handleSwitchAndContinue}
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
