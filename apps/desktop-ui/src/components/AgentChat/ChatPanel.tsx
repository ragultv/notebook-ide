import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { useAgentChat } from '../../hooks/useAgentChat.js';
import type { NotebookCell } from '../../hooks/useAgentChat.js';
import { CodeCanvas } from '../shared/CodeCanvas.js';
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
    <div className="prose prose-sm dark:prose-invert max-w-none text-[13px] leading-relaxed prose-p:my-3.5 prose-p:leading-relaxed prose-headings:mt-5 prose-headings:mb-3 prose-ul:my-3.5 prose-ul:space-y-2 prose-ol:my-3.5 prose-ol:space-y-2 prose-li:my-1 prose-pre:p-0 prose-pre:bg-transparent prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || '');
            const isBlock = Boolean(match) || String(children).includes('\n');
            if (isBlock) {
              const codeText = String(children).replace(/\n$/, '');
              return <CodeCanvas language={match ? match[1] : undefined} code={codeText} />;
            }
            return <code className="bg-gray-200 dark:bg-gray-700 rounded px-1 py-0.5 text-xs font-mono" {...props}>{children}</code>;
          },
          h1: ({ children, ...props }) => (
            <h1 className="text-[18px] font-bold text-gray-900 dark:text-white mt-7 mb-3.5 tracking-tight border-b border-gray-200 dark:border-white/10 pb-2" {...props}>{children}</h1>
          ),
          h2: ({ children, ...props }) => (
            <h2 className="text-[16px] font-bold text-gray-900 dark:text-white mt-6 mb-3 tracking-tight" {...props}>{children}</h2>
          ),
          h3: ({ children, ...props }) => (
            <h3 className="text-[14.5px] font-bold text-gray-900 dark:text-white mt-6 mb-3 tracking-tight" {...props}>{children}</h3>
          ),
          h4: ({ children, ...props }) => (
            <h4 className="text-[13.5px] font-bold text-gray-900 dark:text-white mt-5 mb-2.5 tracking-tight" {...props}>{children}</h4>
          ),
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#141416] shadow-sm not-prose">
              <table className="w-full text-left border-collapse text-[12.5px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-gray-200 dark:border-white/10 bg-gray-100 dark:bg-white/5 px-3.5 py-2.5 font-bold text-gray-900 dark:text-zinc-100 whitespace-nowrap text-[12px] uppercase tracking-wider">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border-b border-gray-200 dark:border-white/5 px-3.5 py-2.5 text-gray-700 dark:text-zinc-300 leading-relaxed break-words">{children}</td>
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
        className="w-full py-2 px-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-medium rounded-lg shadow-md shadow-blue-500/20 hover:shadow-blue-500/30 border border-blue-400/30 transition-all duration-150 flex items-center justify-center gap-1.5"
      >
        <span>▶</span>
        <span>Proceed — switch to Agentic and implement</span>
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      const timeoutId = setTimeout(() => {
        if (document.activeElement !== inputRef.current) {
          inputRef.current?.focus();
        }
      }, 50);
      return () => clearTimeout(timeoutId);
    }
  }, []);

  const {
    messages, toolCalls, kernelLines, escalation, isLoading, mode, activePlan,
    sendMessage, setMode, dismissEscalation, clearKernelOutput, proceedWithPlan,
  } = useAgentChat({
    projectPath, notebookCells,
    onCellCreate, onCellUpdate, onCellDelete,
    onCellRunStart, onCellRunComplete,
  });



  // "Switch & Continue" — switches mode then sends explicit instruction to execute the next step without repeating explanation
  const handleSwitchAndContinue = useCallback((newMode: typeof mode) => {
    setMode(newMode);
    dismissEscalation();
    const prompt = `We have switched to ${newMode} mode. Based on your previous analysis and recommendations, immediately execute the next concrete step or action (such as creating/editing cells, running code, or implementing pending plan tasks). Do NOT repeat or summarize the previous explanation—proceed directly with implementation.`;
    void sendMessage(prompt, newMode);
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
          ref={inputRef}
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
