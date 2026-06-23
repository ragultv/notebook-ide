import { useState, useCallback, useRef, useEffect } from 'react';

export type Mode = 'ASK' | 'PLAN' | 'AGENT' | 'AGENTIC';

export interface PersistedToolCall {
  tool:   string;
  input:  unknown;
  result: unknown;
}

export interface ChatMsg {
  id:         string;
  role:       'user' | 'assistant';
  content:    string;
  timestamp:  string;
  tool_calls?: PersistedToolCall[];
  attachments?: { name: string; content: string }[];
}

export interface ToolCallState {
  id: string;
  tool: string;
  input: unknown;
  result?: unknown;
  done: boolean;
}

export interface KernelLine {
  stream: 'stdout' | 'stderr';
  text: string;
}

export interface EscalationState {
  suggest_mode: Mode;
  reason: string;
}

export interface PermissionRequest {
  action: string;
  payload: unknown;
}

export interface AttachedFile {
  id: string;
  name: string;
  content: string;
}

export interface ChatSession {
  id: string;
  title: string;
  mode: string;
  created_at: number;
  updated_at: number;
  message_count?: number;
}

export interface AgentModel {
  provider_id:   string;
  provider_name: string;
  model_id:      string;
  model_name:    string;
  source?:       string;
}

export interface ModelProvider {
  id:       string;
  name:     string;
  type:     string;
  has_key:  boolean;
  is_local: boolean;
  models:   Array<{ id: string; name: string; context: number; is_enabled?: boolean }>;
}

export interface NotebookCell {
  id: string;
  type: 'code' | 'markdown';
  source: string;
}

interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

interface UseAgentChatOptions {
  projectPath:       string;
  notebookCells:     NotebookCell[];
  notebookPath?:     string;
  onCellCreate?:     (afterCellId: string | null, cellType: 'code' | 'markdown', source: string, newCellId?: string) => void;
  onCellUpdate?:     (cellId: string, source: string) => void;
  onCellDelete?:     (cellId: string) => void;
  onNotebookCreate?: (path: string) => void;
}

export const TOOL_ACTIVITIES: Record<string, string> = {
  readFile:          'Reading file',
  readCell:          'Reading cell',
  searchNotebook:    'Exploring',
  loadMemory:        'Reading memory',
  searchEmbeddings:  'Exploring store',
  createPlan:        'Planning',
  updatePlan:        'Updating plan',
  writeFile:         'Writing file',
  createNotebook:    'Creating notebook',
  createFile:        'Creating file',
  createCell:        'Adding cell',
  updateCell:        'Updating cell',
  writeCell:         'Writing cell',
  requestDeleteCell: 'Requesting permission',
  deleteCell:        'Deleting cell',
  saveMemory:        'Indexing',
  runCell:           'Executing cell',
  runNotebook:       'Running notebook',
  createArtifact:    'Analyzing',
};

const API = 'http://localhost:3001';

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export function useAgentChat(opts: UseAgentChatOptions) {
  // ── Session ──────────────────────────────────────────────────────────────
  const [sessionId,   setSessionId]   = useState<string>('');
  const [sessions,    setSessions]    = useState<ChatSession[]>([]);

  // ── Messages ─────────────────────────────────────────────────────────────
  const [messages,   setMessages]   = useState<ChatMsg[]>([]);
  const [toolCalls,  setToolCalls]  = useState<ToolCallState[]>([]);
  const [kernelLines, setKernelLines] = useState<KernelLine[]>([]);

  // ── State ─────────────────────────────────────────────────────────────────
  const [escalation,       setEscalation]       = useState<EscalationState | null>(null);
  const [pendingPerm,      setPendingPerm]       = useState<PermissionRequest | null>(null);
  const [isLoading,        setIsLoading]        = useState(false);
  const [mode,             setMode]             = useState<Mode>('ASK');
  const [activeActivities, setActiveActivities] = useState<string[]>([]);
  const [attachedFiles,    setAttachedFiles]    = useState<AttachedFile[]>([]);

  // ── Model ─────────────────────────────────────────────────────────────────
  const [currentModel,   setCurrentModel]   = useState<AgentModel | null>(null);
  const [modelProviders, setModelProviders] = useState<ModelProvider[]>([]);

  const abortRef           = useRef<AbortController | null>(null);
  const activeToolsRef     = useRef<Map<string, string>>(new Map());
  const currentAssistantId = useRef<string>('');
  const toolCallSeqRef     = useRef<number>(0);

  // Refs for callbacks — always hold the latest version, avoiding stale closures in sendMessage
  const onCellCreateRef     = useRef(opts.onCellCreate);
  const onCellUpdateRef     = useRef(opts.onCellUpdate);
  const onCellDeleteRef     = useRef(opts.onCellDelete);
  const onNotebookCreateRef = useRef(opts.onNotebookCreate);
  onCellCreateRef.current     = opts.onCellCreate;
  onCellUpdateRef.current     = opts.onCellUpdate;
  onCellDeleteRef.current     = opts.onCellDelete;
  onNotebookCreateRef.current = opts.onNotebookCreate;

  // ── Load model info ───────────────────────────────────────────────────────
  const loadModels = useCallback(() => {
    if (!opts.projectPath) return;
    apiFetch<{ providers: ModelProvider[] }>('/api/agent/models')
      .then(d => setModelProviders(d.providers))
      .catch(() => {});
    apiFetch<AgentModel>(`/api/agent/model?project_path=${encodeURIComponent(opts.projectPath)}`)
      .then(m => setCurrentModel(m))
      .catch(() => {});
  }, [opts.projectPath]);

  useEffect(() => { loadModels(); }, [loadModels]);

  // ── Load sessions ─────────────────────────────────────────────────────────
  const loadSessions = useCallback(() => {
    if (!opts.projectPath) return;
    apiFetch<{ sessions: ChatSession[] }>(
      `/api/chat/sessions?project_path=${encodeURIComponent(opts.projectPath)}`,
    ).then(d => setSessions(d.sessions)).catch(() => {});
  }, [opts.projectPath]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // ── File management ───────────────────────────────────────────────────────
  const addFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      setAttachedFiles(prev => [
        ...prev,
        { id: `f-${Date.now()}-${file.name}`, name: file.name, content: e.target?.result as string },
      ]);
    };
    reader.readAsText(file);
  }, []);

  const removeFile = useCallback((id: string) => {
    setAttachedFiles(prev => prev.filter(f => f.id !== id));
  }, []);

  // ── Model selection ───────────────────────────────────────────────────────
  const selectModel = useCallback(async (providerId: string, modelId: string) => {
    const result = await apiFetch<AgentModel>('/api/agent/model', {
      method: 'POST',
      body: JSON.stringify({ project_path: opts.projectPath, provider_id: providerId, model_id: modelId }),
    });
    setCurrentModel(result);
  }, [opts.projectPath]);

  // ── Session management ────────────────────────────────────────────────────
  const createNewSession = useCallback(async (): Promise<string> => {
    if (!opts.projectPath) return crypto.randomUUID();
    const { session } = await apiFetch<{ session: ChatSession }>('/api/chat/sessions', {
      method: 'POST',
      body:   JSON.stringify({ project_path: opts.projectPath, mode }),
    });
    loadSessions();
    return session.id;
  }, [opts.projectPath, mode, loadSessions]);

  const startNewChat = useCallback(async () => {
    const id = await createNewSession();
    setSessionId(id);
    setMessages([]);
    setToolCalls([]);
    setKernelLines([]);
    setEscalation(null);
    setPendingPerm(null);
    setActiveActivities([]);
  }, [createNewSession]);

  const loadSession = useCallback(async (id: string) => {
    const { session, messages: msgs } = await apiFetch<{
      session: ChatSession;
      messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; tool_calls?: PersistedToolCall[]; attachments?: { name: string; content: string }[]; created_at: number }>;
    }>(`/api/chat/sessions/${id}`);

    setSessionId(id);
    setMode(session.mode as Mode);
    setMessages(msgs.map(m => ({
      id:         m.id,
      role:       m.role,
      content:    m.content,
      timestamp:  new Date(m.created_at).toISOString(),
      tool_calls: m.tool_calls ?? [],
      attachments: m.attachments ?? [],
    })));
    setToolCalls([]);
    setKernelLines([]);
    setEscalation(null);
    setPendingPerm(null);
  }, []);

  const deleteSession = useCallback(async (id: string) => {
    await apiFetch(`/api/chat/sessions/${id}`, { method: 'DELETE' });
    loadSessions();
    if (id === sessionId) startNewChat();
  }, [loadSessions, sessionId, startNewChat]);

  // ── Persist exchange to SQLite after streaming ────────────────────────────
  const persistMessages = useCallback(async (
    sid: string,
    userContent: string,
    assistantContent: string,
    currentMode: Mode,
    title?: string,
    toolCallsForTurn?: Array<{ tool: string; input: unknown; result: unknown }>,
    userAttachments?: Array<{ name: string; content: string }>,
  ) => {
    if (!sid) return;
    await apiFetch(`/api/chat/sessions/${sid}/messages`, {
      method: 'POST',
      body:   JSON.stringify({
        messages: [
          { role: 'user',      content: userContent,      tool_calls: [], attachments: userAttachments ?? [] },
          { role: 'assistant', content: assistantContent, tool_calls: toolCallsForTurn ?? [] },
        ],
        mode:  currentMode,
        title: title ?? userContent.slice(0, 60),
      }),
    });
    loadSessions();
  }, [loadSessions]);

  // ── Send message ──────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (content: string, modeOverride?: Mode) => {
    const effectiveMode = modeOverride ?? mode;
    if (isLoading) return;

    // Ensure we have a session
    let sid = sessionId;
    if (!sid) {
      sid = await createNewSession();
      setSessionId(sid);
    }

    // Build content with attachments
    let fullContent = content;
    if (attachedFiles.length > 0) {
      const attachText = attachedFiles
        .map(f => `\n\n[Attached: ${f.name}]\n\`\`\`\n${f.content.slice(0, 4000)}\n\`\`\``)
        .join('');
      fullContent = content + attachText;
    }

    const userMsg: ChatMsg = { id: `u-${Date.now()}`, role: 'user', content: content, attachments: attachedFiles, timestamp: new Date().toISOString() };
    const assistantMsg: ChatMsg = { id: `a-${Date.now()}`, role: 'assistant', content: '', timestamp: new Date().toISOString() };

    currentAssistantId.current = assistantMsg.id;
    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setIsLoading(true);
    setAttachedFiles([]);
    setToolCalls([]);
    setActiveActivities([]);
    activeToolsRef.current.clear();

    const allMsgs = [
      ...messages.map(m => {
        let text = m.content;
        if (m.attachments && m.attachments.length > 0) {
          text += m.attachments.map(f => `\n\n[Attached: ${f.name}]\n\`\`\`\n${f.content.slice(0, 4000)}\n\`\`\``).join('');
        }
        return { role: m.role, content: text, timestamp: m.timestamp };
      }),
      { role: 'user' as const, content: fullContent, timestamp: userMsg.timestamp },
    ];

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    let finalText = '';

    try {
      const res = await fetch(`${API}/api/agent`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          messages:         allMsgs,
          mode:             effectiveMode,
          project_path:     opts.projectPath,
          current_notebook: { cells: opts.notebookCells, path: opts.notebookPath },
          session_id:       sid,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const dec    = new TextDecoder();
      let   buf    = '';

      // Track tool calls for this turn (for Bug 4 persistence)
      const turnToolCalls: Array<{ tool: string; input: unknown; result: unknown }> = [];

      const handleEvent = (line: string) => {
        if (!line.startsWith('data: ')) return;
        const raw = line.slice(6).trim();
        if (!raw) return;
        let evt: AgentEvent;
        try { evt = JSON.parse(raw); } catch { return; }

        const aid = currentAssistantId.current;

        switch (evt['type']) {
          case 'text_delta':
            finalText += evt['delta'] as string;
            setMessages(prev => prev.map(m =>
              m.id === aid ? { ...m, content: m.content + (evt['delta'] as string) } : m,
            ));
            break;

          case 'tool_call_start': {
            const toolName = evt['tool'] as string;
            const label    = TOOL_ACTIVITIES[toolName] ?? toolName;
            const seq      = ++toolCallSeqRef.current;
            const tcId     = `tc-${seq}-${toolName}`;
            // Use seq as map key so multiple concurrent same-named tools don't collide
            activeToolsRef.current.set(tcId, label);
            setActiveActivities(Array.from(activeToolsRef.current.values()));
            setToolCalls(prev => [...prev, { id: tcId, tool: toolName, input: evt['input'], done: false }]);
            turnToolCalls.push({ tool: toolName, input: evt['input'], result: null });
            break;
          }

          case 'tool_call_result': {
            const toolName = evt['tool'] as string;
            // Find and remove the in-progress entry for this tool (first undone match)
            const keyToRemove = [...activeToolsRef.current.entries()].find(
              ([k]) => k.endsWith(`-${toolName}`)
            )?.[0];
            if (keyToRemove) activeToolsRef.current.delete(keyToRemove);
            setActiveActivities(Array.from(activeToolsRef.current.values()));
            setToolCalls(prev => {
              let marked = false;
              return prev.map(tc => {
                if (!marked && tc.tool === toolName && !tc.done) {
                  marked = true;
                  return { ...tc, result: evt['result'], done: true };
                }
                return tc;
              });
            });
            // Fix: iterate in reverse to find the last pending entry and mutate it in-place
            for (let i = turnToolCalls.length - 1; i >= 0; i--) {
              if (turnToolCalls[i]!.tool === toolName && turnToolCalls[i]!.result === null) {
                turnToolCalls[i]!.result = evt['result'];
                break;
              }
            }
            break;
          }

          case 'kernel_output':
            setKernelLines(prev => [...prev, { stream: evt['stream'] as 'stdout' | 'stderr', text: evt['text'] as string }]);
            break;

          case 'notebook_create':
            onNotebookCreateRef.current?.(evt['path'] as string);
            break;

          case 'cell_create':
            // Use ref so we always call the latest callback even if active notebook changed
            onCellCreateRef.current?.(
              evt['after_cell_id'] as string | null,
              evt['cell_type'] as 'code' | 'markdown',
              evt['source'] as string,
              evt['new_cell_id'] as string | undefined,
            );
            break;

          case 'cell_update':
            onCellUpdateRef.current?.(evt['cell_id'] as string, evt['source'] as string);
            break;

          case 'cell_delete':
            onCellDeleteRef.current?.(evt['cell_id'] as string);
            break;

          case 'escalation':
            setEscalation({ suggest_mode: evt['suggest_mode'] as Mode, reason: evt['reason'] as string });
            break;

          case 'permission_request':
            setPendingPerm({ action: evt['action'] as string, payload: evt['payload'] });
            break;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) handleEvent(line);
      }

      // Persist to SQLite — include tool calls for this turn
      if (content || fullContent || finalText) {
        persistMessages(sid, content, finalText, effectiveMode, content.slice(0, 60), turnToolCalls, attachedFiles);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const aid = currentAssistantId.current;
        setMessages(prev => prev.map(m =>
          m.id === aid ? { ...m, content: m.content + `\n\n[Error: ${String(err)}]` } : m,
        ));
      }
    } finally {
      setIsLoading(false);
      setActiveActivities([]);
      activeToolsRef.current.clear();
    }
  }, [isLoading, messages, mode, opts, attachedFiles, sessionId, createNewSession, persistMessages]);

  const confirmPermission = useCallback(() => {
    const perm = pendingPerm;
    setPendingPerm(null);
    if (!perm) return;
    const text = perm.action === 'delete_cell'
      ? `Yes confirmed. Delete cell ${(perm.payload as Record<string, unknown>)['cell_id']}.`
      : 'Yes, confirmed. Please proceed.';
    sendMessage(text);
  }, [pendingPerm, sendMessage]);

  const denyPermission    = useCallback(() => setPendingPerm(null), []);
  const dismissEscalation = useCallback(() => setEscalation(null), []);
  const clearKernelOutput = useCallback(() => setKernelLines([]), []);
  const stopGeneration    = useCallback(() => abortRef.current?.abort(), []);

  return {
    // chat
    messages, toolCalls, kernelLines, isLoading,
    activeActivities, attachedFiles, escalation, pendingPerm,
    // mode
    mode, setMode,
    // session
    sessions, sessionId,
    startNewChat, loadSession, deleteSession,
    // model
    currentModel, modelProviders, selectModel, loadModels,
    // actions
    sendMessage, dismissEscalation, clearKernelOutput,
    confirmPermission, denyPermission, stopGeneration,
    addFile, removeFile,
  };
}
