import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';

const DB_DIR  = path.join(os.homedir(), '.octoml');
const DB_PATH = path.join(DB_DIR, 'chat.db');

export interface ChatSession {
  id: string;
  project_path: string;
  title: string;
  mode: string;
  created_at: number;
  updated_at: number;
  message_count?: number;
  last_message?: string;
}

export interface ToolCallRecord {
  tool:   string;
  input:  unknown;
  result: unknown;
}

export interface ChatMessage {
  id:         string;
  session_id: string;
  role:       'user' | 'assistant';
  content:    string;
  tool_calls: ToolCallRecord[];
  attachments: { name: string; content: string }[];
  segments:   unknown[];
  created_at: number;
}

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;

  fs.mkdirSync(DB_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id           TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      title        TEXT NOT NULL DEFAULT 'New conversation',
      mode         TEXT NOT NULL DEFAULT 'ASK',
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id         TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role       TEXT NOT NULL,
      content    TEXT NOT NULL,
      tool_calls TEXT NOT NULL DEFAULT '[]',
      attachments TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project ON chat_sessions(project_path, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id, created_at ASC);
  `);

  // Migrate: add columns if they don't exist yet
  try {
    db.exec(`ALTER TABLE chat_messages ADD COLUMN tool_calls TEXT NOT NULL DEFAULT '[]'`);
  } catch { /* column already exists — safe to ignore */ }
  try {
    db.exec(`ALTER TABLE chat_messages ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'`);
  } catch { /* column already exists — safe to ignore */ }
  try {
    db.exec(`ALTER TABLE chat_messages ADD COLUMN segments TEXT NOT NULL DEFAULT '[]'`);
  } catch { /* column already exists — safe to ignore */ }

  _db = db;
  return db;
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export function createSession(projectPath: string, mode: string, title?: string): ChatSession {
  const db  = getDb();
  const now = Date.now();
  const id  = crypto.randomUUID();
  const ttl = title ?? 'New conversation';

  db.prepare(`
    INSERT INTO chat_sessions (id, project_path, title, mode, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, projectPath, ttl, mode, now, now);

  return { id, project_path: projectPath, title: ttl, mode, created_at: now, updated_at: now };
}

export function updateSession(id: string, patch: { title?: string; mode?: string }): void {
  const db = getDb();
  if (patch.title) {
    db.prepare(`UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?`)
      .run(patch.title, Date.now(), id);
  }
  if (patch.mode) {
    db.prepare(`UPDATE chat_sessions SET mode = ?, updated_at = ? WHERE id = ?`)
      .run(patch.mode, Date.now(), id);
  }
}

export function touchSession(id: string): void {
  getDb().prepare(`UPDATE chat_sessions SET updated_at = ? WHERE id = ?`).run(Date.now(), id);
}

export function listSessions(projectPath: string, limit = 50): ChatSession[] {
  return getDb().prepare(`
    SELECT
      s.id, s.project_path, s.title, s.mode, s.created_at, s.updated_at,
      COUNT(m.id)           AS message_count,
      MAX(m.content)        AS last_message
    FROM chat_sessions s
    LEFT JOIN chat_messages m ON m.session_id = s.id
    WHERE s.project_path = ?
    GROUP BY s.id
    ORDER BY s.updated_at DESC
    LIMIT ?
  `).all(projectPath, limit) as ChatSession[];
}

export function getSession(id: string): ChatSession | null {
  return getDb().prepare(`SELECT * FROM chat_sessions WHERE id = ?`).get(id) as ChatSession | null;
}

export function deleteSession(id: string): void {
  getDb().prepare(`DELETE FROM chat_sessions WHERE id = ?`).run(id);
}

// ── Messages ──────────────────────────────────────────────────────────────────

export function addMessages(
  sessionId: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string; tool_calls?: ToolCallRecord[]; attachments?: { name: string; content: string }[]; segments?: unknown[] }>,
): void {
  const db   = getDb();
  const stmt = db.prepare(`
    INSERT INTO chat_messages (id, session_id, role, content, tool_calls, attachments, segments, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAll = db.transaction((msgs: typeof messages) => {
    const now = Date.now();
    for (const m of msgs) {
      stmt.run(crypto.randomUUID(), sessionId, m.role, m.content, JSON.stringify(m.tool_calls ?? []), JSON.stringify(m.attachments ?? []), JSON.stringify(m.segments ?? []), now);
    }
  });
  insertAll(messages);
  touchSession(sessionId);
}

export function getMessages(sessionId: string): ChatMessage[] {
  const rows = getDb().prepare(`
    SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC
  `).all(sessionId) as Array<Omit<ChatMessage, 'tool_calls' | 'attachments' | 'segments'> & { tool_calls: string; attachments: string; segments: string }>;
  return rows.map(r => ({
    ...r,
    tool_calls:  (() => { try { return JSON.parse(r.tool_calls  ?? '[]'); } catch { return []; } })(),
    attachments: (() => { try { return JSON.parse(r.attachments ?? '[]'); } catch { return []; } })(),
    segments:    (() => { try { return JSON.parse(r.segments    ?? '[]'); } catch { return []; } })(),
  }));
}
