import type {
  OctomlState, ProjectMemory, ChatTurn, Plan, RunResult,
  EmbeddingChunk, ContextMeta, AgentRequest,
} from './types/index.js';
import { OctomlStore } from './store/octoml-store.js';
import { EmbeddingStore } from './embeddings/embedding-store.js';

const TOKEN_BUDGET  = 8_000;
const CHARS_PER_TOK = 4;

function est(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOK);
}

export interface BuiltContext {
  memory: ProjectMemory;
  state: OctomlState;
  recentChat: ChatTurn[];
  embeddingChunks: EmbeddingChunk[];
  activePlan: Plan | null;
  lastRun: RunResult | null;
  knowledgeDocs: Array<{ slug: string; content: string }>;
  contextMeta: ContextMeta;
}

export async function buildContext(request: AgentRequest): Promise<BuiltContext> {
  const store    = new OctomlStore(request.project_path);
  const embStore = new EmbeddingStore(request.project_path);
  const msgs     = request.messages;
  const lastMsg  = [...msgs].reverse().find(m => m.role === 'user')?.content ?? '';

  const [state, memory, recentChat, rawChunks, lastRun, knowledgeDocs] = await Promise.all([
    store.getState(),
    store.getMemory(),
    store.getRecentChat(20),
    embStore.search(lastMsg, 5).catch((): EmbeddingChunk[] => []),
    store.getLastRun(),
    store.getKnowledgeDocs(),
  ]);

  const activePlan = state.active_plan_id
    ? await store.getPlan(state.active_plan_id)
    : null;

  let nbPathStr = activePlan?.notebook_path;
  if (!nbPathStr && activePlan) {
    const planText = JSON.stringify(activePlan);
    const match = planText.match(/(?:notebooks[\/\\])?[\w-]+\.ipynb/i);
    if (match) {
      nbPathStr = match[0];
      if (!nbPathStr.startsWith('notebooks/') && !nbPathStr.startsWith('notebooks\\')) {
        nbPathStr = 'notebooks/' + nbPathStr;
      }
    }
  }

  // Auto-hydrate notebook context if it's missing but we know the path from the plan
  if (request.current_notebook.cells.length === 0 && nbPathStr) {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const nbPath = path.join(request.project_path, nbPathStr);
      const raw = await fs.readFile(nbPath, 'utf-8');
      const nb = JSON.parse(raw);
      if (Array.isArray(nb.cells)) {
        request.current_notebook.cells = nb.cells.map((c: any) => ({
          id: c.id ?? 'unknown',
          type: c.cell_type,
          source: Array.isArray(c.source) ? c.source.join('') : c.source,
        }));
        request.current_notebook.path = nbPathStr;
      }
    } catch {
      // Ignore — notebook might not exist physically yet or is malformed
    }
  }

  // Fixed cost: memory + plan + last run + notebook cells
  const fixedText = [
    JSON.stringify(memory),
    activePlan ? JSON.stringify(activePlan) : '',
    lastRun    ? lastRun.stdout.slice(-2_000) + lastRun.stderr.slice(-500) : '',
    request.current_notebook.cells.map(c => c.source).join('\n'),
  ].join('\n');

  let budget = TOKEN_BUDGET - est(fixedText);
  const included: string[] = ['memory', 'active_plan', 'last_run', 'notebook'];
  const dropped:  string[] = [];

  // 1. trim knowledge docs (drop first)
  const kDocs = knowledgeDocs.filter(d => {
    const cost = est(d.content);
    if (budget >= cost) { budget -= cost; included.push(`knowledge:${d.slug}`); return true; }
    dropped.push(`knowledge:${d.slug}`);
    return false;
  });

  // 2. trim embedding chunks
  const chunks = rawChunks.filter(c => {
    const cost = est(c.text);
    if (budget >= cost) { budget -= cost; included.push(`embed:${c.source}`); return true; }
    dropped.push(`embed:${c.source}`);
    return false;
  });

  // 3. trim chat history (keep min 5)
  let chat = recentChat;
  while (chat.length > 5 && est(chat.map(m => m.content).join('')) > budget) {
    const popped = chat.shift();
    if (popped) dropped.push(`chat:${popped.role}`);
  }
  included.push(`chat:${chat.length}_turns`);

  return {
    memory,
    state,
    recentChat: chat,
    embeddingChunks: chunks,
    activePlan,
    lastRun,
    knowledgeDocs: kDocs,
    contextMeta: { included, dropped, token_estimate: TOKEN_BUDGET - budget },
  };
}
