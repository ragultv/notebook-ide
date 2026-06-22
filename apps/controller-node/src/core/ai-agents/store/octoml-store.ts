import fs from 'fs/promises';
import path from 'path';
import type {
  OctomlState,
  ProjectMemory,
  ChatTurn,
  Plan,
  RunResult,
  LogEntry,
} from '../types/index.js';

const DEFAULT_STATE: OctomlState = {
  mode: 'ASK',
  session_id: `session-${Date.now()}`,
  active_plan_id: null,
  last_run_id: null,
};

export class OctomlStore {
  private readonly root: string;

  constructor(projectPath: string) {
    this.root = path.join(projectPath, '.octoml');
  }

  private resolve(...parts: string[]): string {
    return path.join(this.root, ...parts);
  }

  private async ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }

  private async readJson<T>(filePath: string, fallback: T): Promise<T> {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private async writeJson(filePath: string, data: unknown): Promise<void> {
    await this.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async getState(): Promise<OctomlState> {
    return this.readJson(this.resolve('state.json'), { ...DEFAULT_STATE });
  }

  async setState(patch: Partial<OctomlState>): Promise<void> {
    const current = await this.getState();
    await this.writeJson(this.resolve('state.json'), { ...current, ...patch });
  }

  async getMemory(): Promise<ProjectMemory> {
    return this.readJson<ProjectMemory>(this.resolve('memory', 'project.json'), {});
  }

  async saveMemory(memory: ProjectMemory): Promise<void> {
    await this.writeJson(this.resolve('memory', 'project.json'), memory);
  }

  async getRecentChat(n: number): Promise<ChatTurn[]> {
    const state = await this.getState();
    const file = this.resolve('chat-history', `${state.session_id}.jsonl`);
    try {
      const raw = await fs.readFile(file, 'utf-8');
      const lines = raw.trim().split('\n').filter(Boolean);
      return lines.slice(-n).map(l => JSON.parse(l) as ChatTurn);
    } catch {
      return [];
    }
  }

  async appendChat(turn: ChatTurn): Promise<void> {
    const state = await this.getState();
    const file = this.resolve('chat-history', `${state.session_id}.jsonl`);
    await this.ensureDir(path.dirname(file));
    await fs.appendFile(file, JSON.stringify(turn) + '\n', 'utf-8');
  }

  async getPlan(planId: string): Promise<Plan | null> {
    return this.readJson<Plan | null>(
      this.resolve('plans', `${planId}.json`),
      null,
    );
  }

  async savePlan(plan: Plan): Promise<void> {
    await this.writeJson(this.resolve('plans', `${plan.id}.json`), plan);
  }

  async getLastRun(): Promise<RunResult | null> {
    const state = await this.getState();
    if (!state.last_run_id) return null;
    return this.readJson<RunResult | null>(
      this.resolve('runs', state.last_run_id, 'run.json'),
      null,
    );
  }

  async saveRun(run: RunResult): Promise<void> {
    const dir = this.resolve('runs', run.id);
    await this.ensureDir(dir);
    await this.writeJson(path.join(dir, 'run.json'), run);
    await fs.writeFile(path.join(dir, 'stdout.txt'), run.stdout, 'utf-8');
    await fs.writeFile(path.join(dir, 'stderr.txt'), run.stderr, 'utf-8');
    await this.writeJson(path.join(dir, 'prompt.json'), run.prompt);
    await this.writeJson(path.join(dir, 'executed_cells.json'), run.executed_cells);
  }

  async appendLog(entry: LogEntry): Promise<void> {
    const file = this.resolve('logs', 'agent.jsonl');
    await this.ensureDir(path.dirname(file));
    await fs.appendFile(file, JSON.stringify(entry) + '\n', 'utf-8');
  }

  async getCached(hash: string): Promise<string | null> {
    const file = this.resolve('cache', `${hash}.json`);
    try {
      const raw = await fs.readFile(file, 'utf-8');
      const data = JSON.parse(raw) as { response: string; created_at: string };
      const age = Date.now() - new Date(data.created_at).getTime();
      if (age > 3_600_000) {
        await fs.unlink(file).catch(() => undefined);
        return null;
      }
      return data.response;
    } catch {
      return null;
    }
  }

  async setCache(hash: string, response: string): Promise<void> {
    await this.writeJson(this.resolve('cache', `${hash}.json`), {
      prompt_hash: hash,
      response,
      created_at: new Date().toISOString(),
    });
  }

  async getKnowledgeDocs(): Promise<Array<{ slug: string; content: string }>> {
    const dir = this.resolve('knowledge');
    try {
      const files = await fs.readdir(dir);
      const docs = await Promise.all(
        files
          .filter(f => f.endsWith('.md'))
          .map(async f => ({
            slug: f.replace('.md', ''),
            content: await fs.readFile(path.join(dir, f), 'utf-8'),
          })),
      );
      return docs;
    } catch {
      return [];
    }
  }

  getEmbeddingsDir(): string {
    return this.resolve('embeddings');
  }

  getRunArtifactsDir(runId: string): string {
    return this.resolve('runs', runId, 'artifacts');
  }
}
