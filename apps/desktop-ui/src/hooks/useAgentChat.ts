import { useState, useCallback, useRef, useEffect } from 'react';

export type Mode = 'ASK' | 'PLAN' | 'AGENT' | 'AGENTIC';

export interface PersistedToolCall {
  tool:   string;
  input:  unknown;
  result: unknown;
}

export type MsgSegment =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; tool: string; input: unknown; result?: unknown; done: boolean };

export interface ChatMsg {
  id:         string;
  role:       'user' | 'assistant';
  content:    string;
  timestamp:  string;
  tool_calls?: PersistedToolCall[];
  attachments?: { name: string; content: string }[];
  segments?:  MsgSegment[];
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
  path?: string; // actual OS path (available in Electron via File.path)
  cellNumber?: number;
  notebookPath?: string;
}

export interface ActivePlan {
  id: string;
  goal: string;
  tasks: Array<{ id: string; description: string; status: string }>;
  plan_path: string;
  notebook_path?: string;
  msgId?: string;
  proceeded?: boolean;
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
  projectPath:        string;
  notebookCells:      NotebookCell[];
  notebookPath?:      string;
  onCellCreate?:      (afterCellId: string | null, cellType: 'code' | 'markdown', source: string, newCellId?: string) => void;
  onCellUpdate?:      (cellId: string, source: string) => void;
  onCellDelete?:      (cellId: string) => void;
  onNotebookCreate?:  (path: string) => void;
  onOpenFile?:        (path: string) => void;
  onCellRunStart?:    (cellId: string) => void;
  onCellRunComplete?: (cellId: string, success: boolean) => void;
}

export const TOOL_ACTIVITIES: Record<string, string> = {
  listProject:       'Scanning project',
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
  const [activePlan,       setActivePlan]       = useState<ActivePlan | null>(null);

  // ── Model ─────────────────────────────────────────────────────────────────
  const [currentModel,   setCurrentModel]   = useState<AgentModel | null>(null);
  const [modelProviders, setModelProviders] = useState<ModelProvider[]>([]);

  const abortRef           = useRef<AbortController | null>(null);
  const activeToolsRef     = useRef<Map<string, string>>(new Map());
  const currentAssistantId = useRef<string>('');
  const toolCallSeqRef     = useRef<number>(0);

  // Refs for callbacks — always hold the latest version, avoiding stale closures in sendMessage
  const onCellCreateRef      = useRef(opts.onCellCreate);
  const onCellUpdateRef      = useRef(opts.onCellUpdate);
  const onCellDeleteRef      = useRef(opts.onCellDelete);
  const onNotebookCreateRef  = useRef(opts.onNotebookCreate);
  const onOpenFileRef        = useRef(opts.onOpenFile);
  const onCellRunStartRef    = useRef(opts.onCellRunStart);
  const onCellRunCompleteRef = useRef(opts.onCellRunComplete);
  onCellCreateRef.current      = opts.onCellCreate;
  onCellUpdateRef.current      = opts.onCellUpdate;
  onCellDeleteRef.current      = opts.onCellDelete;
  onNotebookCreateRef.current  = opts.onNotebookCreate;
  onOpenFileRef.current        = opts.onOpenFile;
  onCellRunStartRef.current    = opts.onCellRunStart;
  onCellRunCompleteRef.current = opts.onCellRunComplete;

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
      { cache: 'no-store' }
    ).then(d => setSessions(d.sessions)).catch(() => {});
  }, [opts.projectPath]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // ── File management ───────────────────────────────────────────────────────
  const addFile = useCallback((file: File, meta?: { cellNumber?: number; notebookPath?: string }) => {
    const filePath = (file as unknown as { path?: string }).path; // Electron exposes the OS path
    const reader = new FileReader();
    reader.onload = (e) => {
      setAttachedFiles(prev => [
        ...prev,
        {
          id: `f-${Date.now()}-${file.name}`,
          name: file.name,
          content: e.target?.result as string,
          path: filePath,
          cellNumber: meta?.cellNumber,
          notebookPath: meta?.notebookPath,
        },
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
    setActivePlan(null);
  }, [createNewSession]);

  const loadSession = useCallback(async (id: string) => {
    const { session, messages: msgs } = await apiFetch<{
      session: ChatSession;
      messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; tool_calls?: PersistedToolCall[]; attachments?: { name: string; content: string }[]; segments?: unknown[]; created_at: number }>;
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
      segments:   (m.segments as MsgSegment[] | undefined) ?? [],
    })));
    setToolCalls([]);
    setKernelLines([]);
    setEscalation(null);
    setPendingPerm(null);
    setActivePlan(null);
  }, []);

  const deleteSession = useCallback(async (id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
    try {
      await apiFetch(`/api/chat/sessions/${id}`, { method: 'DELETE' });
      if (id === sessionId) {
        startNewChat();
      } else {
        loadSessions();
      }
    } catch (e) {
      console.error('Failed to delete session', e);
      loadSessions(); // Revert optimistic update on failure
    }
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
    segments?: MsgSegment[],
  ) => {
    if (!sid) return;
    try {
      await apiFetch(`/api/chat/sessions/${sid}/messages`, {
        method: 'POST',
        body:   JSON.stringify({
          messages: [
            { role: 'user',      content: userContent,      tool_calls: [], attachments: userAttachments ?? [] },
            { role: 'assistant', content: assistantContent, tool_calls: toolCallsForTurn ?? [], segments: segments ?? [] },
          ],
          mode:  currentMode,
          title: title ?? userContent.slice(0, 60),
        }),
      });
      loadSessions();
    } catch (e) {
      console.error('Failed to persist messages to DB:', e);
    }
  }, [loadSessions]);

  // ── Send message ──────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (content: string, modeOverride?: Mode, attachmentsOverride?: AttachedFile[]) => {
    const effectiveMode = modeOverride ?? mode;
    if (isLoading) return;

    // Ensure we have a session
    let sid = sessionId;
    if (!sid) {
      sid = await createNewSession();
      setSessionId(sid);
    }

    // Build content with attachments
    const currentAttachments = attachmentsOverride ?? attachedFiles;
    let fullContent = content;
    
    // Detect continue/proceed/resume
    const lowerContent = content.trim().toLowerCase();
    if (['continue', 'proceed', 'resume'].includes(lowerContent) && activePlan) {
      const done = activePlan.tasks.filter(t => t.status === 'done').map(t => t.id);
      const pending = activePlan.tasks.filter(t => t.status !== 'done').map(t => t.id);
      
      let nbPathStr = activePlan.notebook_path;
      if (!nbPathStr) {
        const planText = JSON.stringify(activePlan);
        const match = planText.match(/(?:notebooks[\/\\])?[\w-]+\.ipynb/i);
        if (match) {
          nbPathStr = match[0];
          if (!nbPathStr.startsWith('notebooks/') && !nbPathStr.startsWith('notebooks\\')) {
            nbPathStr = 'notebooks/' + nbPathStr;
          }
        }
      }

      const nbPath = nbPathStr ? `\nNotebook path: ${nbPathStr}` : '';
      const reminder = `[SYSTEM REMINDER: The user wants to resume.
Completed tasks: ${done.join(', ') || 'none'}.
Pending tasks: ${pending.join(', ') || 'none'}.${nbPath}
DO NOT restart. DO NOT re-create anything already done.
Resume from the first pending task and complete ALL remaining tasks.]\n\n`;
      fullContent = reminder + fullContent;
    }

    if (currentAttachments.length > 0) {
      const attachTexts = await Promise.all(currentAttachments.map(async f => {
        let cellNum = f.cellNumber;
        if (cellNum === undefined) {
          const m = f.name.match(/cell[-.]?(\d+)/i);
          if (m) cellNum = parseInt(m[1], 10);
        }

        if (cellNum !== undefined && !isNaN(cellNum)) {
          const nbInfo = f.notebookPath ? ` from notebook "${f.notebookPath}"` : '';
          return `\n\n[Attached Notebook Cell #${cellNum}${nbInfo}]\n\`\`\`python\n${f.content}\n\`\`\`\n(CRITICAL INSTRUCTION: The user has attached Cell #${cellNum}${nbInfo}. To run or execute this exact cell, call runCell({ cell_number: ${cellNum} }) directly. DO NOT call createCell or pass raw source.)`;
        }

        const pathLine = f.path ? `\nFile path: ${f.path}` : '';

        // If it's an in-memory file (no path, e.g. a cell drag), include its content directly
        if (!f.path) {
          return `\n\n[Attached in-memory snippet: ${f.name}]\n\`\`\`\n${f.content}\n\`\`\``;
        }

        const instruction = f.name.toLowerCase().endsWith('.ipynb')
          ? `(CRITICAL: To execute cells from this notebook, you MUST first open it in the IDE by calling the readFile tool on its path. If you get a 'Path traversal detected' error, it means the file is outside the workspace. If you get an ENOENT (file not found) error, you MUST use the listProject tool to search the workspace for the correct path to this notebook. If you still cannot find it in the workspace, tell the user it was not found.)`
          : `(Please use the readFile tool to read this file if needed. If it fails with file not found, use listProject to find its correct path.)`;
        return `\n\n[Attached file: ${f.name}]${pathLine}\n${instruction}`;
      }));
      fullContent = fullContent + attachTexts.join('');
    }

    const userMsg: ChatMsg = { id: `u-${Date.now()}`, role: 'user', content: content, attachments: currentAttachments, timestamp: new Date().toISOString() };
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
          text += m.attachments.map(f => {
            let cellNum = f.cellNumber;
            if (cellNum === undefined) {
              const match = f.name.match(/cell[-.]?(\d+)/i);
              if (match) cellNum = parseInt(match[1], 10);
            }
            if (cellNum !== undefined && !isNaN(cellNum)) {
              return `\n\n[Attached Notebook Cell #${cellNum}]\n(To run this cell, call runCell({ cell_number: ${cellNum} }))`;
            }
            return `\n\n[Attached file: ${f.name}]`;
          }).join('');
        }
        return { role: m.role, content: text, timestamp: m.timestamp };
      }),
      { role: 'user' as const, content: fullContent, timestamp: userMsg.timestamp },
    ];

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    let finalText = '';

    type SegmentEvent =
      | { kind: 'text'; text: string }
      | { kind: 'tool_start'; id: string; tool: string; input: unknown }
      | { kind: 'tool_result'; tool: string; result: unknown };

    function buildSegments(events: SegmentEvent[]): MsgSegment[] {
      const segs: MsgSegment[] = [];
      for (const ev of events) {
        if (ev.kind === 'text') {
          const last = segs[segs.length - 1];
          if (last?.kind === 'text') { last.text += ev.text; }
          else segs.push({ kind: 'text', text: ev.text });
        } else if (ev.kind === 'tool_start') {
          segs.push({ kind: 'tool', id: ev.id, tool: ev.tool, input: ev.input, done: false });
        } else if (ev.kind === 'tool_result') {
          for (let i = segs.length - 1; i >= 0; i--) {
            const s = segs[i]!;
            if (s.kind === 'tool' && s.tool === ev.tool && !s.done) {
              s.result = ev.result;
              s.done = true;
              break;
            }
          }
        }
      }
      return segs;
    }

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

      // Track tool calls for persistence and segment ordering
      const turnToolCalls: Array<{ tool: string; input: unknown; result: unknown }> = [];
      const segmentEvents: SegmentEvent[] = [];

      const handleEvent = (line: string) => {
        if (!line.startsWith('data: ')) return;
        const raw = line.slice(6).trim();
        if (!raw) return;
        let evt: AgentEvent;
        try { evt = JSON.parse(raw); } catch { return; }

        const aid = currentAssistantId.current;

        switch (evt['type']) {
          case 'text_delta': {
            const delta = evt['delta'] as string;
            finalText += delta;
            segmentEvents.push({ kind: 'text', text: delta });
            const currentSegs = buildSegments(segmentEvents);
            setMessages(prev => prev.map(m =>
              m.id === aid ? { ...m, content: m.content + delta, segments: currentSegs } : m,
            ));
            break;
          }

          case 'tool_call_start': {
            const toolName = evt['tool'] as string;
            
            // Auto-open notebook if AI reads it
            if (toolName === 'readFile' && evt['input']) {
              const p = (evt['input'] as Record<string, unknown>).path as string;
              if (p && typeof p === 'string' && p.endsWith('.ipynb')) {
                onOpenFileRef.current?.(p);
              }
            }

            const label    = TOOL_ACTIVITIES[toolName] ?? toolName;
            const seq      = ++toolCallSeqRef.current;
            const tcId     = `tc-${seq}-${toolName}`;
            activeToolsRef.current.set(tcId, label);
            setActiveActivities(Array.from(activeToolsRef.current.values()));
            setToolCalls(prev => [...prev, { id: tcId, tool: toolName, input: evt['input'], done: false }]);
            turnToolCalls.push({ tool: toolName, input: evt['input'], result: null });
            segmentEvents.push({ kind: 'tool_start', id: tcId, tool: toolName, input: evt['input'] });
            
            const currentSegs = buildSegments(segmentEvents);
            setMessages(prev => prev.map(m => m.id === aid ? { ...m, segments: currentSegs } : m));
            break;
          }

          case 'tool_call_result': {
            const toolName = evt['tool'] as string;
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
            for (let i = turnToolCalls.length - 1; i >= 0; i--) {
              if (turnToolCalls[i]!.tool === toolName && turnToolCalls[i]!.result === null) {
                turnToolCalls[i]!.result = evt['result'];
                break;
              }
            }
            segmentEvents.push({ kind: 'tool_result', tool: toolName, result: evt['result'] });

            const currentSegs = buildSegments(segmentEvents);
            setMessages(prev => prev.map(m => m.id === aid ? { ...m, segments: currentSegs } : m));
            break;
          }

          case 'kernel_output':
            setKernelLines(prev => [...prev, { stream: evt['stream'] as 'stdout' | 'stderr', text: evt['text'] as string }]);
            break;

          case 'notebook_create':
            onNotebookCreateRef.current?.(evt['path'] as string);
            break;

          case 'cell_create':
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

          case 'plan_created':
            setActivePlan({
              id:        evt['plan_id'] as string,
              goal:      evt['goal'] as string,
              tasks:     evt['tasks'] as Array<{ id: string; description: string; status: string }>,
              plan_path: evt['plan_path'] as string,
              msgId:     currentAssistantId.current,
            });
            break;

          case 'cell_run_start':
            onCellRunStartRef.current?.(evt['cell_id'] as string);
            break;

          case 'cell_run_complete':
            onCellRunCompleteRef.current?.(evt['cell_id'] as string, evt['success'] as boolean);
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

      // Build ordered segments and update the in-memory message so it renders correctly
      // before and after refresh (no longer dependent on separate toolCalls state)
      const finalSegments = buildSegments(segmentEvents);
      const aid = currentAssistantId.current;
      setMessages(prev => prev.map(m =>
        m.id === aid ? { ...m, tool_calls: turnToolCalls, segments: finalSegments } : m,
      ));

      // Persist to SQLite — include tool calls + segments for correct ordering on reload
      if (content || fullContent || finalText) {
        persistMessages(sid, content, finalText, effectiveMode, content.slice(0, 60), turnToolCalls, attachedFiles, finalSegments);
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

  const proceedWithPlan = useCallback(() => {
    if (!activePlan) return;
    const taskList = activePlan.tasks.map((t, i) => `${i + 1}. ${t.description}`).join('\n');
    const msg = `Proceed with the implementation plan.`;
    
    const planFile: AttachedFile = {
      id: `plan-${activePlan.id}`,
      name: `Plan: ${activePlan.goal.slice(0, 20)}...`,
      content: `Goal: ${activePlan.goal}\nTasks:\n${taskList}`,
      path: activePlan.plan_path
    };

    setMode('AGENT');
    void sendMessage(msg, 'AGENT', [planFile]);
    setActivePlan(prev => prev ? { ...prev, proceeded: true } : null);
  }, [activePlan, sendMessage]);

  const denyPermission    = useCallback(() => setPendingPerm(null), []);
  const dismissEscalation = useCallback(() => setEscalation(null), []);
  const clearKernelOutput = useCallback(() => setKernelLines([]), []);
  const stopGeneration    = useCallback(() => abortRef.current?.abort(), []);

  return {
    // chat
    messages, toolCalls, kernelLines, isLoading,
    activeActivities, attachedFiles, escalation, pendingPerm,
    activePlan,
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
    addFile, removeFile, proceedWithPlan,
  };
}
