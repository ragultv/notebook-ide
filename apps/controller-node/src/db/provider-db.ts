import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';

const DB_PATH = path.join(os.homedir(), '.octoml', 'providers.db');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Provider {
  id: string;
  name: string;
  type: string;
  base_url: string;
  is_builtin: number;
  created_at: number;
}

export interface ProviderModel {
  id: number;
  provider_id: string;
  model_id: string;
  model_name: string;
  context_length: number;
  is_enabled: number;
}

export interface EnabledModel extends ProviderModel {
  provider_name: string;
}

// ── Built-in providers (seeded once on first run) ─────────────────────────────

const BUILTIN: Array<{ id: string; name: string; type: string; base_url: string }> = [
  { id: 'nvidia',     name: 'NVIDIA NIM',    type: 'nvidia',     base_url: 'https://integrate.api.nvidia.com/v1' },
  { id: 'groq',       name: 'Groq',          type: 'groq',       base_url: 'https://api.groq.com/openai/v1' },
  { id: 'openai',     name: 'OpenAI',        type: 'openai',     base_url: 'https://api.openai.com/v1' },
  { id: 'anthropic',  name: 'Anthropic',     type: 'anthropic',  base_url: 'https://api.anthropic.com/v1' },
  { id: 'gemini',     name: 'Google Gemini', type: 'gemini',     base_url: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { id: 'deepseek',   name: 'DeepSeek',      type: 'deepseek',   base_url: 'https://api.deepseek.com/v1' },
  { id: 'openrouter', name: 'OpenRouter',    type: 'openrouter', base_url: 'https://openrouter.ai/api/v1' },
  { id: 'togetherai', name: 'Together AI',   type: 'togetherai', base_url: 'https://api.together.xyz/v1' },
  { id: 'cerebras', name: 'Cerebras', type: 'cerebras', base_url: 'https://api.cerebras.ai/v1' },
];

// ── DB singleton ──────────────────────────────────────────────────────────────

let _db: Database.Database | null = null;

export function getProviderDb(): Database.Database {
  if (_db) return _db;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS providers (
      id          TEXT    PRIMARY KEY,
      name        TEXT    NOT NULL,
      type        TEXT    NOT NULL,
      base_url    TEXT    NOT NULL DEFAULT '',
      is_builtin  INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS provider_models (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id    TEXT    NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      model_id       TEXT    NOT NULL,
      model_name     TEXT    NOT NULL DEFAULT '',
      context_length INTEGER NOT NULL DEFAULT 0,
      is_enabled     INTEGER NOT NULL DEFAULT 0,
      UNIQUE(provider_id, model_id)
    );
  `);

  // Seed built-in providers (idempotent — ignored if they already exist)
  const seed = _db.prepare(
    'INSERT OR IGNORE INTO providers (id, name, type, base_url, is_builtin) VALUES (?, ?, ?, ?, 1)',
  );
  for (const p of BUILTIN) seed.run(p.id, p.name, p.type, p.base_url);

  return _db;
}

// ── Provider CRUD ─────────────────────────────────────────────────────────────

export function listProviders(): Provider[] {
  return getProviderDb()
    .prepare('SELECT * FROM providers ORDER BY is_builtin DESC, name ASC')
    .all() as Provider[];
}

export function getProvider(id: string): Provider | undefined {
  return getProviderDb()
    .prepare('SELECT * FROM providers WHERE id = ?')
    .get(id) as Provider | undefined;
}

export function upsertProvider(p: {
  id: string; name: string; type: string; base_url: string;
}): Provider {
  const db = getProviderDb();
  db.prepare(`
    INSERT INTO providers (id, name, type, base_url, is_builtin)
    VALUES (?, ?, ?, ?, 0)
    ON CONFLICT(id) DO UPDATE SET
      name     = excluded.name,
      type     = excluded.type,
      base_url = excluded.base_url
  `).run(p.id, p.name, p.type, p.base_url);
  return db.prepare('SELECT * FROM providers WHERE id = ?').get(p.id) as Provider;
}

export function deleteCustomProvider(id: string): void {
  getProviderDb()
    .prepare('DELETE FROM providers WHERE id = ? AND is_builtin = 0')
    .run(id);
}

// ── Model CRUD ────────────────────────────────────────────────────────────────

export function listProviderModels(providerId: string): ProviderModel[] {
  return getProviderDb()
    .prepare('SELECT * FROM provider_models WHERE provider_id = ? ORDER BY model_id ASC')
    .all(providerId) as ProviderModel[];
}

export function getAllModels(): Array<ProviderModel & { provider_name: string }> {
  return getProviderDb().prepare(`
    SELECT pm.*, p.name AS provider_name
    FROM   provider_models pm
    JOIN   providers p ON p.id = pm.provider_id
    ORDER  BY p.name ASC, pm.model_id ASC
  `).all() as Array<ProviderModel & { provider_name: string }>;
}

export function getEnabledModels(): EnabledModel[] {
  return getProviderDb().prepare(`
    SELECT pm.*, p.name AS provider_name
    FROM   provider_models pm
    JOIN   providers p ON p.id = pm.provider_id
    WHERE  pm.is_enabled = 1
    ORDER  BY p.name ASC, pm.model_id ASC
  `).all() as EnabledModel[];
}

export function upsertModels(
  providerId: string,
  models: Array<{ model_id: string; model_name: string; context_length?: number }>,
): void {
  const db   = getProviderDb();
  const stmt = db.prepare(`
    INSERT INTO provider_models (provider_id, model_id, model_name, context_length)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(provider_id, model_id) DO UPDATE SET
      model_name     = excluded.model_name,
      context_length = excluded.context_length
  `);
  db.transaction(() => {
    for (const m of models) stmt.run(providerId, m.model_id, m.model_name, m.context_length ?? 0);
  })();
}

export function setModelEnabled(providerId: string, modelId: string, enabled: boolean): void {
  getProviderDb()
    .prepare('UPDATE provider_models SET is_enabled = ? WHERE provider_id = ? AND model_id = ?')
    .run(enabled ? 1 : 0, providerId, modelId);
}
