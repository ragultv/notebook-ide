import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { X, Send, Square, Paperclip, ChevronRight, ChevronDown, Plus, Clock, Trash2, ChevronLeft } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAgentChat, TOOL_ACTIVITIES } from '../../hooks/useAgentChat';
import type { ActivePlan, MsgSegment } from '../../hooks/useAgentChat';
import { controllerClient } from '../../services/controller.client';
import { useProject } from '../../context/ProjectContext';
import type { CellData, ProjectFile } from '../../types';
import octomlLogo from '../../icon.png';

// ── Props ────────────────────────────────────────────────────────────────────
interface RightSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onAddCell: (content: string, type: 'code' | 'markdown', id?: string) => void;
  onDeleteCell: (index: number) => void;
  onMoveCell: (fromIndex: number, toIndex: number) => void;
  onEditCell: (index: number, content: string, type?: 'code' | 'markdown') => void;
  onAddPackages: (packages: string[]) => void;
  onCreateNotebook: (nameOrCells?: string | CellData[], initialCells?: CellData[], path?: string) => string | null;
  onNotebookCreatedByAgent?: (path: string) => void;
  updateNotebookCellsById?: (notebookId: string, cells: CellData[] | ((prev: CellData[]) => CellData[])) => void;
  onOpenFile?: (path: string) => void;
  onCellRunStart?: (cellId: string) => void;
  onCellRunComplete?: (cellId: string, success: boolean) => void;
  onDeleteNotebook: (name?: string) => void;
  notebookCells: CellData[];
  notebookName: string;
  notebookPath?: string;
  notebookId?: string;  // The notebook UUID used for the WebSocket connection
  projectFiles: ProjectFile[];
  activeCellId?: string | null;
  onOpenManageModels: () => void;
  onOpenChatHistory?: () => void;
  modelsRefreshTrigger?: number;
  width: number;
  isResizing: boolean;
  onStartResizing: () => void;
}

type Mode = 'ASK' | 'PLAN' | 'AGENT' | 'AGENTIC';

const MODE_DOT: Record<Mode, string> = {
  ASK:     'bg-blue-400',
  PLAN:    'bg-purple-400',
  AGENT:   'bg-orange-400',
  AGENTIC: 'bg-red-400',
};

const MODE_TEXT: Record<Mode, string> = {
  ASK:     'text-blue-400',
  PLAN:    'text-purple-400',
  AGENT:   'text-orange-400',
  AGENTIC: 'text-red-400',
};

const MODE_HINTS: Record<Mode, string> = {
  ASK:     'Read & explain',
  PLAN:    'Read & plan',
  AGENT:   'Read & write',
  AGENTIC: 'Full execution',
};

const ACTIVITY_ICONS: Record<string, string> = {
  'Thinking':              '💭',
  'Reading file':          '📄',
  'Reading cell':          '📋',
  'Exploring':             '🔍',
  'Reading memory':        '🧠',
  'Exploring store':       '🗄️',
  'Planning':              '📝',
  'Updating plan':         '📝',
  'Writing file':          '✏️',
  'Creating notebook':     '📓',
  'Creating file':         '📁',
  'Adding cell':           '➕',
  'Updating cell':         '✏️',
  'Writing cell':          '✏️',
  'Requesting permission': '🔐',
  'Deleting cell':         '🗑️',
  'Indexing':              '🔢',
  'Executing cell':        '▶️',
  'Analyzing':             '📊',
};

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min  = Math.floor(diff / 60_000);
  if (min < 1)  return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24)  return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

// ── Inline components ─────────────────────────────────────────────────────────

function ActivityTag({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-sim-muted animate-pulse">
      <span>{ACTIVITY_ICONS[label] ?? '⚙️'}</span>
      <span>{label}…</span>
    </span>
  );
}

function ToolBlock({ tool, input, result, done }: {
  tool: string; input: unknown; result?: unknown; done: boolean;
}) {
  const [open, setOpen] = useState(false);
  const label = TOOL_ACTIVITIES[tool] ?? tool;
  return (
    <div className="my-1 text-xs font-mono text-sim-text">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-sim-muted hover:text-sim-text transition-colors w-full text-left"
      >
        <span className="text-sim-muted/50">{open ? '▾' : '▸'}</span>
        <span>{label}</span>
        {done
          ? <span className="ml-auto text-green-500 text-[10px]">✓</span>
          : <span className="ml-auto w-2.5 h-2.5 border border-sim-border border-t-sim-text rounded-full animate-spin flex-shrink-0" />
        }
      </button>
      {open && (
        <div className="mt-1 pl-3 space-y-1 border-l border-sim-border">
          {input !== undefined && (
            <pre className="text-sim-muted bg-sim-bg/50 border border-sim-border rounded-lg p-2 whitespace-pre-wrap break-all leading-relaxed">
              {JSON.stringify(input, null, 2)}
            </pre>
          )}
          {done && result !== undefined && (
            <>
              <div className="text-sim-muted/50 text-[10px]">result</div>
              <pre className="text-sim-muted bg-sim-bg/50 border border-sim-border rounded-lg p-2 whitespace-pre-wrap break-all leading-relaxed">
                {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const MD_PROSE = `
  prose dark:prose-invert max-w-none
  prose-p:leading-relaxed prose-p:my-1.5 prose-p:text-sim-text/90
  prose-pre:bg-sim-bg prose-pre:border prose-pre:border-sim-border prose-pre:rounded-xl prose-pre:p-3 prose-pre:shadow-lg prose-pre:text-[11.5px]
  prose-code:bg-sim-border/70 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:text-[11px] prose-code:font-mono
  prose-code:text-sim-red prose-code:before:content-none prose-code:after:content-none
  prose-headings:text-sim-text/90 prose-headings:font-semibold prose-headings:tracking-tight prose-headings:mb-1.5 prose-headings:mt-3
  prose-h1:text-lg prose-h2:text-base prose-h3:text-[13px]
  prose-a:text-sim-red hover:prose-a:text-sim-redHover prose-a:transition-colors
  prose-blockquote:border-l-2 prose-blockquote:border-sim-red/40 prose-blockquote:bg-sim-red/5 prose-blockquote:py-0.5 prose-blockquote:px-3 prose-blockquote:rounded-r prose-blockquote:text-sim-text/70
  prose-ul:my-2 prose-ul:list-disc prose-ul:pl-4
  prose-ol:my-2 prose-ol:list-decimal prose-ol:pl-4
  prose-li:my-0.5 prose-li:text-sim-text/80 prose-li:marker:text-sim-text/40
  prose-strong:text-sim-text prose-strong:font-semibold
  prose-em:text-sim-text/70
  prose-table:text-[11.5px] prose-table:w-full prose-table:border-collapse
  prose-th:border-b prose-th:border-sim-border prose-th:p-1.5 prose-th:text-left prose-th:text-sim-text/90
  prose-td:border-b prose-td:border-sim-border prose-td:p-1.5 prose-td:text-sim-text/70
`.trim();

function MarkdownBlock({ text }: { text: string }) {
  return (
    <div style={{ fontSize: '12px', lineHeight: '1.6' }} className={MD_PROSE}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function ThinkingAccordion({ text, defaultOpen = false }: { text: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!text.trim()) return null;
  return (
    <div className="my-2 border border-sim-border rounded-lg overflow-hidden bg-transparent">
      <button 
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-transparent hover:bg-sim-border/50 transition-colors text-left"
      >
        <ChevronRight size={12} className={`text-sim-muted transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="text-[10px] font-medium text-sim-muted uppercase tracking-wider">Agent Thinking</span>
      </button>
      {open && (
        <div className="px-3 pb-2 pt-1 bg-transparent border-t border-sim-border">
          <MarkdownBlock text={text} />
        </div>
      )}
    </div>
  );
}

function AssistantMessage({ content, isStreaming, activities, msgToolCalls, segments, activePlan, onOpenPlan, onProceedWithPlan, isLast, msgId }: {
  content: string;
  isStreaming: boolean;
  activities: string[];
  msgToolCalls: Array<{ id: string; tool: string; input: unknown; result?: unknown; done: boolean }>;
  segments?: MsgSegment[];
  activePlan?: ActivePlan | null;
  onOpenPlan?: (path: string) => void;
  onProceedWithPlan?: () => void;
  isLast: boolean;
  msgId: string;
}) {
  const showThinking = isStreaming && !content && activities.length === 0 && msgToolCalls.length === 0;
  const useSegments  = segments && segments.length > 0;

  return (
    <div className="py-2.5">
      {(showThinking || activities.length > 0) && (
        <div className="flex flex-wrap gap-3 mb-2">
          {showThinking && <ActivityTag label="Thinking" />}
          {activities.map((a, i) => <ActivityTag key={`act-${i}-${a}`} label={a} />)}
        </div>
      )}

      {useSegments ? (
        // Render segments in insertion order — text and tool calls interleaved correctly
        segments!.map((seg, i) => {
          if (seg.kind === 'text') {
            return <MarkdownBlock key={i} text={seg.text} />;
          }
          return <ToolBlock key={seg.id} tool={seg.tool} input={seg.input} result={seg.result} done={seg.done} />;
        })
      ) : (
        // Fallback: tools first then text (live streaming or old messages without segments)
        <>
          {msgToolCalls.map(tc => (
            <ToolBlock key={tc.id} tool={tc.tool} input={tc.input} result={tc.result} done={tc.done} />
          ))}
          {content && <MarkdownBlock text={content} />}
        </>
      )}

      {isStreaming && content && (
        <span className="inline-block w-0.5 h-3 bg-white/30 ml-0.5 animate-pulse rounded-sm align-middle" />
      )}
      {!isStreaming && activePlan && activePlan.msgId === msgId && !activePlan.proceeded && onProceedWithPlan && (
        <PlanShortcut plan={activePlan} onOpen={onOpenPlan} onProceed={onProceedWithPlan} />
      )}
    </div>
  );
}

// ── Model Selector Dropdown ───────────────────────────────────────────────────
const MODEL_SELECTOR_API = 'http://localhost:3001';

interface FetchedModel { id: string; name: string; provider_id: string; provider_name: string }

function ModelSelector({
  currentModel, onSelect,
}: {
  currentModel: { provider_id: string; model_id: string; model_name: string; provider_name: string } | null;
  onSelect: (providerId: string, modelId: string) => void;
}) {
  const [open,    setOpen]    = useState(false);
  const [search,  setSearch]  = useState('');
  const [models,  setModels]  = useState<FetchedModel[]>([]);
  const [loading, setLoading] = useState(false);
  const ref                   = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setSearch(''); }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Fetch fresh enabled models whenever dropdown opens
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch(`${MODEL_SELECTOR_API}/api/providers/models/enabled`)
      .then(r => r.ok ? r.json() : [])
      .then((rows: Array<{ provider_id: string; provider_name: string; model_id: string; model_name: string }>) => {
        setModels(rows.map(r => ({
          id:            r.model_id,
          name:          r.model_name || r.model_id,
          provider_id:   r.provider_id,
          provider_name: r.provider_name,
        })));
      })
      .catch(() => setModels([]))
      .finally(() => setLoading(false));
  }, [open]);

  const filtered = models.filter(m =>
    !search ||
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.provider_name.toLowerCase().includes(search.toLowerCase()),
  );

  // Group by provider for display
  const grouped = filtered.reduce<Record<string, { name: string; models: FetchedModel[] }>>((acc, m) => {
    if (!acc[m.provider_id]) acc[m.provider_id] = { name: m.provider_name, models: [] };
    acc[m.provider_id].models.push(m);
    return acc;
  }, {});

  const hasModel = !!currentModel?.model_id;
  const modelLabel = currentModel?.model_name || currentModel?.model_id || '';
  const displayName = hasModel
    ? (modelLabel.length > 26 ? modelLabel.slice(0, 25) + '…' : modelLabel)
    : 'No model configured';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 text-[11px] transition-colors bg-sim-bg border border-sim-border hover:bg-sim-border/50 rounded-lg px-2 py-1 max-w-[180px] ${
          hasModel ? 'text-sim-muted hover:text-sim-text' : 'text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300'
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${hasModel ? 'bg-green-500' : 'bg-amber-500'}`} />
        <span className="truncate">{displayName}</span>
        <ChevronDown size={9} className="text-sim-muted flex-shrink-0 ml-auto" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1.5 bg-sim-surface rounded-xl border border-sim-border shadow-2xl z-50 flex flex-col" style={{ width: 280, maxHeight: 360 }}>
          <div className="p-2 border-b border-sim-border">
            <input autoFocus placeholder="Search models…" value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-sim-bg border border-sim-border rounded-lg px-2.5 py-1.5 text-xs text-sim-text placeholder-sim-muted outline-none" />
          </div>

          <div className="overflow-y-auto flex-1">
            {loading ? (
              <div className="text-center py-6 text-[11px] text-white/25">Loading…</div>
            ) : Object.keys(grouped).length === 0 ? (
              <div className="text-center py-6">
                <p className="text-[11px] text-white/25">No enabled models</p>
                <p className="text-[10px] text-white/15 mt-1">Open Settings → Models and enable some models</p>
              </div>
            ) : Object.entries(grouped).map(([providerId, group]) => (
              <div key={providerId}>
                <div className="px-3 pt-2.5 pb-1 sticky top-0 bg-sim-surface">
                  <span className="text-[10px] font-semibold text-sim-muted uppercase tracking-wider">{group.name}</span>
                </div>
                {group.models.map(m => {
                  const isActive = currentModel?.model_id === m.id && currentModel?.provider_id === m.provider_id;
                  return (
                    <button key={m.id}
                      onClick={() => { onSelect(m.provider_id, m.id); setOpen(false); setSearch(''); }}
                      className={`w-full text-left px-3 py-2 text-xs transition-colors flex items-center gap-2 ${
                        isActive ? 'text-sim-text bg-sim-selection font-semibold' : 'text-sim-text/80 hover:text-sim-text hover:bg-sim-selection/50'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isActive ? 'bg-blue-400' : 'bg-green-400/40'}`} />
                      <span className="flex-1 truncate">{m.name}</span>
                      {isActive && <span className="text-[9px] text-blue-400/70 flex-shrink-0">active</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Plan Shortcut ─────────────────────────────────────────────────────────────
function PlanShortcut({ plan, onOpen, onProceed }: {
  plan: ActivePlan;
  onOpen?: (path: string) => void;
  onProceed: () => void;
}) {
  const label = plan.goal.length > 36 ? plan.goal.slice(0, 35) + '…' : plan.goal;
  return (
    <div className="mt-3 flex items-center gap-2 flex-wrap">
      <button
        onClick={() => onOpen?.(plan.plan_path)}
        title="Open plan in editor"
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#2d1b4e] border border-[#4c2d82] text-xs text-[#d1b3ff] hover:bg-[#3b2366] transition-colors font-medium shadow-sm"
      >
        <span>📋</span>
        <span className="max-w-[200px] truncate">{label}</span>
        <span className="opacity-50 ml-1">↗</span>
      </button>
      {!plan.proceeded && (
        <button
          onClick={onProceed}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#4a2615] border border-[#7a3d21] text-xs text-[#ffb088] hover:bg-[#5c2f1a] transition-colors font-medium shadow-sm"
        >
          <span>▶</span>
          <span>Proceed in Agent</span>
        </button>
      )}
    </div>
  );
}

// ── Chat History Panel ────────────────────────────────────────────────────────
function HistoryPanel({
  sessions, onLoad, onDelete, onBack,
}: {
  sessions: Array<{ id: string; title: string; mode: string; updated_at: number; message_count?: number }>;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-sim-border">
        <button onClick={onBack} className="text-sim-muted hover:text-sim-text transition-colors p-0.5">
          <ChevronLeft size={14} />
        </button>
        <span className="text-[11px] font-semibold tracking-widest text-sim-muted uppercase">Chat History</span>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 py-16 text-sim-muted">
            <Clock size={24} className="opacity-40" />
            <p className="text-xs">No conversations yet</p>
          </div>
        ) : (
          <div className="py-2">
            {sessions.map(s => (
              <div
                key={s.id}
                onClick={() => onLoad(s.id)}
                className="group flex items-start gap-3 px-4 py-3 hover:bg-sim-border cursor-pointer transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-sim-text truncate leading-snug">{s.title || 'New conversation'}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-[10px] font-medium ${
                      s.mode === 'ASK' ? 'text-blue-500' :
                      s.mode === 'PLAN' ? 'text-purple-500' :
                      s.mode === 'AGENT' ? 'text-orange-500' : 'text-red-500'
                    }`}>{s.mode}</span>
                    <span className="text-[10px] text-sim-muted">{relativeTime(s.updated_at)}</span>
                    {s.message_count !== undefined && (
                      <span className="text-[10px] text-sim-muted">{Math.floor(s.message_count / 2)} turns</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); onDelete(s.id); }}
                  className="opacity-0 group-hover:opacity-100 p-1 text-sim-muted hover:text-red-500 transition-all rounded flex-shrink-0"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export const RightSidebar: React.FC<RightSidebarProps> = ({
  isOpen, onClose,
  onAddCell, onEditCell,
  onNotebookCreatedByAgent,
  notebookCells, notebookName, notebookPath: notebookPathProp,
  activeCellId,
  modelsRefreshTrigger,
  width, isResizing, onStartResizing,
  onOpenFile, onCellRunStart, onCellRunComplete, notebookId: notebookFileId,
}) => {
  const { project } = useProject();

    // The notebook path sent to the agent. Prefer the real file ID (matches WebSocket /ws/<id>),
    // then the explicit path prop, then derive from name.
    const notebookPath = notebookFileId
      ?? notebookPathProp
      ?? (notebookName
        ? `notebooks/${notebookName.endsWith('.ipynb') ? notebookName : notebookName + '.ipynb'}`
        : undefined);

  const agentCells = useMemo(() =>
    notebookCells.map(c => ({ id: c.id, type: c.type as 'code' | 'markdown', source: c.content })),
    [notebookCells],
  );

  const {
    messages, toolCalls, kernelLines, escalation, pendingPerm,
    isLoading, mode, activeActivities, attachedFiles,
    sessions, currentModel, modelProviders,
    activePlan,
    sendMessage, setMode, dismissEscalation,
    confirmPermission, denyPermission, stopGeneration,
    addFile, removeFile, selectModel, loadModels,
    startNewChat, loadSession, deleteSession,
    proceedWithPlan,
  } = useAgentChat({
    projectPath:        project?.path ?? '',
    notebookCells:      agentCells,
    notebookPath,
    onCellCreate:       (_afterId, cellType, source, newCellId) => onAddCell(source, cellType, newCellId),
    onCellUpdate:       (cellId, source) => {
      const idx = notebookCells.findIndex(c => c.id === cellId);
      if (idx >= 0) onEditCell(idx, source);
    },
    onCellDelete:       () => {},
    onNotebookCreate:   onNotebookCreatedByAgent,
    onOpenFile,
    onCellRunStart,
    onCellRunComplete,
  });

  const [input,       setInput]       = useState('');
  const [isDragOver,  setIsDragOver]  = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [kernelOpen,  setKernelOpen]  = useState(false);

  const bottomRef    = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef     = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      const timeoutId = setTimeout(() => {
        if (document.activeElement !== inputRef.current) {
          inputRef.current?.focus();
        }
      }, 50);
      return () => clearTimeout(timeoutId);
    }
  }, [isOpen]);

  // Reload models whenever the settings page changes model selection
  useEffect(() => {
    if (modelsRefreshTrigger) loadModels();
  }, [modelsRefreshTrigger, loadModels]);

  useEffect(() => {
    if (!showHistory) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, activeActivities.length, showHistory]);

  // Active cell — show as chip
  const activeCell = useMemo(() =>
    activeCellId ? notebookCells.find(c => c.id === activeCellId) : undefined,
    [activeCellId, notebookCells],
  );

  const includeCellChip = useCallback(() => {
    if (!activeCell) return;
    const nbName = notebookName ? notebookName.replace('.ipynb', '') : 'notebook';
    addFile(new File([activeCell.content], `${nbName}.${activeCell.id}.${activeCell.type === 'code' ? 'py' : 'md'}`, { type: 'text/plain' }));
  }, [activeCell, addFile, notebookName]);

  const handleSend = useCallback(() => {
    const t = input.trim();
    if (!t && attachedFiles.length === 0) return;
    setInput('');
    sendMessage(t);
  }, [input, attachedFiles.length, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    // 1. Native OS files
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      Array.from(e.dataTransfer.files).forEach(f => addFile(f));
      return;
    }

    // 2. Cell drag
    try {
      const cellDataStr = e.dataTransfer.getData('application/json');
      if (cellDataStr) {
        const data = JSON.parse(cellDataStr);
        if (data.type === 'cell-drag' && data.content) {
          const ext = data.cellType === 'code' ? 'py' : 'md';
          const fileName = data.notebookId && data.cellId ? `${data.notebookId}.${data.cellId}.${ext}` : `cell.${ext}`;
          const file = new File([data.content], fileName, { type: 'text/plain' });
          addFile(file);
          return;
        }
      }
    } catch (err) {
      // ignore parse errors
    }

    // 3. File Explorer drag (virtual path)
    const path = e.dataTransfer.getData('text/plain');
    if (path && path.startsWith('/')) {
      try {
        const { content } = await controllerClient.readFile(path);
        const fileName = path.split('/').pop() || 'file';
        const file = new File([content], fileName, { type: 'text/plain' });
        addFile(file);
      } catch (err) {
        console.error("Failed to read dropped file from explorer", err);
      }
    }
  }, [addFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    Array.from(e.target.files ?? []).forEach(f => addFile(f));
    e.target.value = '';
  }, [addFile]);

  const handleLoadSession = useCallback(async (id: string) => {
    await loadSession(id);
    setShowHistory(false);
  }, [loadSession]);

  if (!isOpen) return null;

  // Which tool calls belong to the last assistant message
  const assistantIds = messages.filter(m => m.role === 'assistant').map(m => m.id);
  const lastAid = assistantIds[assistantIds.length - 1];

  return (
    <div
      className="relative flex flex-col h-full overflow-hidden flex-shrink-0 rounded-2xl border border-sim-border bg-sim-surface text-sim-text shadow-lg"
      style={{ width, userSelect: isResizing ? 'none' : undefined }}
    >
      {/* Resize strip (invisible but draggable) */}
      <div
        onMouseDown={onStartResizing}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10"
      />

      {showHistory ? (
        <HistoryPanel
          sessions={sessions}
          onLoad={handleLoadSession}
          onDelete={deleteSession}
          onBack={() => setShowHistory(false)}
        />
      ) : (
        <>
          {/* ── Header ───────────────────────────────────────────────────── */}
          <div className="flex items-center px-4 py-2.5 flex-shrink-0">
            <span className="text-[10px] font-semibold tracking-[0.15em] text-sim-muted uppercase flex-1 select-none">
              OctoML Agent
            </span>
            <div className="flex items-center gap-0.5">
              <button
                onClick={startNewChat}
                title="New chat"
                className="w-7 h-7 flex items-center justify-center text-sim-muted hover:text-sim-text rounded-lg hover:bg-sim-border transition-colors"
              >
                <Plus size={14} />
              </button>
              <button
                onClick={() => setShowHistory(true)}
                title="Chat history"
                className="w-7 h-7 flex items-center justify-center text-sim-muted hover:text-sim-text rounded-lg hover:bg-sim-border transition-colors"
              >
                <Clock size={13} />
              </button>
              <button
                onClick={onClose}
                className="w-7 h-7 flex items-center justify-center text-sim-muted hover:text-sim-text rounded-lg hover:bg-sim-border transition-colors"
              >
                <X size={13} />
              </button>
            </div>
          </div>

          {/* ── Mode tabs ─────────────────────────────────────────────────── */}
          <div className="flex items-center gap-0.5 px-3 pb-2 flex-shrink-0">
            {(['ASK', 'PLAN', 'AGENT', 'AGENTIC'] as Mode[]).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                title={MODE_HINTS[m]}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                  mode === m
                    ? `bg-sim-selection text-sim-text font-semibold`
                    : 'text-sim-muted hover:text-sim-text hover:bg-sim-selection/50'
                }`}
              >
                {mode === m && <span className={`w-1.5 h-1.5 rounded-full ${MODE_DOT[m]} flex-shrink-0`} />}
                {m}
              </button>
            ))}
          </div>

          {/* ── Messages ──────────────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto px-4 min-h-0">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 pb-16">
                <div className="w-20 h-20 rounded-2xl bg-sim-bg border border-sim-border flex items-center justify-center select-none overflow-hidden">
                  <img src={octomlLogo} alt="OctoML Logo" className="w-18 h-18 object-contain opacity-90" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sim-text/60 text-sm">Ask OctoML anything</p>
                  <p className="text-sim-muted text-xs">{MODE_HINTS[mode]}</p>
                </div>
              </div>
            ) : (
              messages.map(msg => {
                if (msg.role === 'user') {
                  return (
                    <div key={msg.id} className="py-2 flex justify-end">
                      <div className="max-w-[88%] flex flex-col items-end gap-1.5">
                        {msg.content && (
                          <div className="text-[11.5px] text-sim-text leading-relaxed bg-sim-bg border border-sim-border rounded-2xl rounded-tr-sm px-3 py-2 whitespace-pre-wrap break-words">
                            {msg.content}
                          </div>
                        )}
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="flex flex-wrap justify-end gap-1.5 mt-0.5">
                            {msg.attachments.map((f, i) => (
                              <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] bg-sim-border/50 border border-sim-border text-sim-text">
                                <span>{f.name.endsWith('.py') ? '🐍' : f.name.endsWith('.csv') ? '📊' : f.name.endsWith('.json') ? '{}' : '📄'}</span>
                                <span className="max-w-[110px] truncate">{f.name}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }
                const isLast        = msg.id === lastAid;
                const isCurrentlyStreaming = isLast && isLoading;
                // During live streaming: use in-memory toolCalls (shown above text as they arrive).
                // After streaming or on reload: use historicCalls only as fallback when segments absent.
                const historicCalls = (msg.tool_calls ?? []).map((tc, i) => ({
                  id:     `hist-${msg.id}-${i}`,
                  tool:   tc.tool,
                  input:  tc.input,
                  result: tc.result,
                  done:   true,
                }));
                const msgToolCalls = isCurrentlyStreaming ? toolCalls : historicCalls;
                return (
                  <AssistantMessage
                    key={msg.id}
                    content={msg.content}
                    isStreaming={isCurrentlyStreaming}
                    activities={isLast ? activeActivities : []}
                    msgToolCalls={msgToolCalls}
                    segments={msg.segments}
                    isLast={isLast}
                    msgId={msg.id}
                    activePlan={activePlan?.msgId === msg.id ? activePlan : null}
                    onOpenPlan={onOpenFile}
                    onProceedWithPlan={isLast ? proceedWithPlan : undefined}
                  />
                );
              })
            )}
            <div ref={bottomRef} />
          </div>

          {/* ── Kernel output ─────────────────────────────────────────────── */}
          {kernelLines.length > 0 && (
            <div className="flex-shrink-0 max-h-40 border-t border-white/5">
              <button
                onClick={() => setKernelOpen(o => !o)}
                className="flex items-center gap-2 w-full px-4 py-1.5 text-[11px] text-white/25 hover:text-white/50 transition-colors"
              >
                {kernelOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                <span>Kernel · {kernelLines.length} lines</span>
              </button>
              {kernelOpen && (
                <div className="overflow-y-auto max-h-28 px-4 pb-2 font-mono text-[11px] space-y-0.5">
                  {kernelLines.map((l, i) => (
                    <div key={i} className={l.stream === 'stderr' ? 'text-red-400/70' : 'text-green-400/60'}>{l.text}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Escalation banner ─────────────────────────────────────────── */}
          {escalation && (
            <div className="mx-3 mb-1.5 flex-shrink-0 px-3 py-2 rounded-xl bg-yellow-500/10 dark:bg-yellow-500/8 border border-yellow-500/20 text-xs flex items-start gap-2">
              <span className="text-yellow-500 dark:text-yellow-400 mt-0.5 flex-shrink-0">⚡</span>
              <div className="flex-1 min-w-0">
                <p className="text-yellow-800 dark:text-yellow-300/80 font-semibold">{escalation.suggest_mode} suggested</p>
                <p className="text-yellow-700/80 dark:text-yellow-300/50 text-[11px] mt-0.5">{escalation.reason}</p>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button
                  onClick={() => {
                    const lastUserMsg = messages.filter(m => m.role === 'user').at(-1)?.content ?? '';
                    const targetMode  = escalation.suggest_mode;
                    setMode(targetMode);
                    dismissEscalation();
                    if (lastUserMsg) sendMessage(lastUserMsg, targetMode);
                  }}
                  className="px-2 py-0.5 rounded-lg bg-yellow-500/20 text-yellow-800 dark:text-yellow-300/80 hover:bg-yellow-500/30 transition-colors text-[11px] font-medium"
                >Switch &amp; continue</button>
                <button onClick={dismissEscalation} className="px-2 py-0.5 rounded-lg hover:bg-sim-border text-sim-muted transition-colors text-[11px]">✕</button>
              </div>
            </div>
          )}

          {/* ── Permission banner ─────────────────────────────────────────── */}
          {pendingPerm && (
            <div className="mx-3 mb-1.5 flex-shrink-0 px-3 py-2 rounded-xl bg-red-500/10 dark:bg-red-500/8 border border-red-500/20 text-xs flex items-start gap-2">
              <Trash2 size={11} className="text-red-500 dark:text-red-400/70 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-red-800 dark:text-red-300/80 font-semibold">Permission required</p>
                <p className="text-red-700/80 dark:text-red-300/50 text-[11px] mt-0.5">
                  {pendingPerm.action === 'delete_cell'
                    ? `Delete cell ${(pendingPerm.payload as Record<string, unknown>)['cell_id']}`
                    : pendingPerm.action}
                </p>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button onClick={confirmPermission} className="px-2 py-0.5 rounded-lg bg-red-500/20 text-red-800 dark:text-red-300/80 hover:bg-red-500/30 transition-colors text-[11px] font-medium">Confirm</button>
                <button onClick={denyPermission} className="px-2 py-0.5 rounded-lg hover:bg-sim-border text-sim-muted transition-colors text-[11px]">Cancel</button>
              </div>
            </div>
          )}

          {/* ── Input area ────────────────────────────────────────────────── */}
          <div className="px-3 pb-3 pt-1 flex-shrink-0">
            {/* Chips row */}
            {(attachedFiles.length > 0 || activeCell) && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {/* Active cell chip */}
                {activeCell && !attachedFiles.some(f => f.name.includes(`.${activeCell.id}.`)) && (
                  <button
                    onClick={includeCellChip}
                    title="Include active cell in message"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] bg-sim-bg border border-sim-border text-sim-muted hover:text-sim-text hover:bg-sim-border/50 transition-colors"
                  >
                    <span>📋</span>
                    <span className="max-w-[150px] truncate font-mono">
                      {notebookName ? notebookName.replace('.ipynb', '') : 'notebook'}.{activeCell.id}.{activeCell.type === 'code' ? 'py' : 'md'}
                    </span>
                    <span className="text-sim-muted opacity-60">+ include</span>
                  </button>
                )}
                {/* File chips */}
                {attachedFiles.map(f => (
                  <span key={f.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] bg-sim-border/50 border border-sim-border text-sim-text">
                    <span>{f.name.endsWith('.py') ? '🐍' : f.name.endsWith('.csv') ? '📊' : f.name.endsWith('.json') ? '{}' : '📄'}</span>
                    <span className="max-w-[110px] truncate">{f.name}</span>
                    <button onClick={() => removeFile(f.id)} className="hover:text-sim-text transition-colors flex-shrink-0">
                      <X size={9} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Textarea container */}
            <div
              className={`rounded-2xl transition-all ${
                isDragOver ? 'ring-1 ring-blue-400/30 bg-blue-400/5' : 'bg-sim-bg border border-sim-border hover:bg-sim-surface/50 transition-colors'
              }`}
              onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
            >
              {isDragOver && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                  <span className="text-xs text-sim-muted bg-sim-bg px-3 py-1.5 rounded-full">Drop to attach</span>
                </div>
              )}
              <textarea
                autoFocus
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Ask OctoML…  ↵ send  ⇧↵ newline`}
                rows={3}
                className="w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-sm text-sim-text placeholder-sim-muted outline-none leading-relaxed"
              />

              {/* Bottom toolbar */}
              <div className="flex items-center px-2 pb-2 gap-2">
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileInput} />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    title="Attach files (or drag & drop)"
                    className="p-1.5 text-sim-muted hover:text-sim-text transition-colors rounded-lg hover:bg-sim-border/50"
                  >
                    <Paperclip size={13} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <ModelSelector
                      currentModel={currentModel}
                      onSelect={selectModel}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {isLoading && (
                    <button onClick={stopGeneration} title="Stop" className="p-1.5 text-sim-muted hover:text-sim-text rounded-lg hover:bg-sim-border transition-colors">
                      <Square size={12} />
                    </button>
                  )}
                  <button
                    onClick={handleSend}
                    disabled={isLoading || (!input.trim() && attachedFiles.length === 0)}
                    className="w-7 h-7 flex items-center justify-center rounded-xl bg-sim-border hover:bg-sim-selection text-sim-text transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                  >
                    <Send size={12} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
