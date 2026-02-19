import Database from 'better-sqlite3';
import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../config.js';

export interface StoredMessage {
    id: number;
    session_id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    token_estimate: number | null;
    created_at: number;
}

export interface GetRecentMessagesOptions {
    limit?: number;
    maxTokens?: number;
}

const DEFAULT_MESSAGE_LIMIT = 20;
const APPROX_TOKENS_PER_CHAR = 0.25;
const SESSION_TTL_DAYS = 7;
const MAX_MESSAGES_PER_SESSION = 50;

let db: Database.Database | null = null;

function getDbPath(): string {
    const dataDir = path.isAbsolute(config.dataDir) ? config.dataDir : path.resolve(process.cwd(), config.dataDir);
    return path.join(dataDir, 'agent_memory.db');
}

function ensureDataDir(): string {
    const dbPath = getDbPath();
    const dataDir = path.dirname(dbPath);
    fs.ensureDirSync(dataDir);
    return dbPath;
}

function getDb(): Database.Database {
    if (!db) {
        const dbPath = ensureDataDir();
        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        initSchema(db);
    }
    return db;
}

function initSchema(database: Database.Database): void {
    database.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            notebook_name TEXT,
            created_at INTEGER NOT NULL,
            last_activity_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL REFERENCES sessions(id),
            role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
            content TEXT NOT NULL,
            token_estimate INTEGER,
            created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON sessions(last_activity_at);

        CREATE TABLE IF NOT EXISTS chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            source TEXT NOT NULL,
            content TEXT NOT NULL,
            embedding BLOB,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id)
        );

        CREATE INDEX IF NOT EXISTS idx_chunks_session ON chunks(session_id);
    `);

    // FTS5 virtual table for sparse search (content and session_id only; content_rowid = chunks.id)
    try {
        database.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
                content,
                session_id,
                content='chunks',
                content_rowid='id'
            );
        `);
    } catch (e) {
        // FTS5 might already exist with different options; ignore
    }

    // Triggers to keep chunks_fts in sync with chunks
    try {
        database.exec(`
            CREATE TRIGGER IF NOT EXISTS chunks_fts_insert AFTER INSERT ON chunks BEGIN
                INSERT INTO chunks_fts(rowid, content, session_id) VALUES (new.id, new.content, new.session_id);
            END;
            CREATE TRIGGER IF NOT EXISTS chunks_fts_delete AFTER DELETE ON chunks BEGIN
                INSERT INTO chunks_fts(chunks_fts, rowid, content, session_id) VALUES ('delete', old.id, old.content, old.session_id);
            END;
            CREATE TRIGGER IF NOT EXISTS chunks_fts_update AFTER UPDATE ON chunks BEGIN
                INSERT INTO chunks_fts(chunks_fts, rowid, content, session_id) VALUES ('delete', old.id, old.content, old.session_id);
                INSERT INTO chunks_fts(rowid, content, session_id) VALUES (new.id, new.content, new.session_id);
            END;
        `);
    } catch (e) {
        // Triggers may already exist
    }
}

/**
 * Get or create a session. If sessionId is provided and exists, touch last_activity_at and return it.
 * Otherwise create a new session with a UUID and return it.
 */
export function getOrCreateSession(sessionId: string | null | undefined, notebookName?: string): string {
    const database = getDb();
    const now = Math.floor(Date.now() / 1000);

    if (sessionId) {
        const row = database.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId) as { id: string } | undefined;
        if (row) {
            database.prepare('UPDATE sessions SET last_activity_at = ? WHERE id = ?').run(now, sessionId);
            return sessionId;
        }
    }

    const newId = uuidv4();
    database.prepare(
        'INSERT INTO sessions (id, notebook_name, created_at, last_activity_at) VALUES (?, ?, ?, ?)'
    ).run(newId, notebookName ?? null, now, now);
    return newId;
}

/**
 * Append a message to a session and update last_activity_at.
 */
export function appendMessage(
    sessionId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    tokenEstimate?: number
): void {
    const database = getDb();
    const now = Math.floor(Date.now() / 1000);
    database.prepare(
        'INSERT INTO messages (session_id, role, content, token_estimate, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(sessionId, role, content, tokenEstimate ?? null, now);
    database.prepare('UPDATE sessions SET last_activity_at = ? WHERE id = ?').run(now, sessionId);
}

/**
 * Get recent messages for a session in chronological order (oldest first) for building conversation.
 * Respects limit and optional maxTokens (approximates by char length if token_estimate not set).
 */
export function getRecentMessages(
    sessionId: string,
    options: GetRecentMessagesOptions = {}
): StoredMessage[] {
    const database = getDb();
    const limit = options.limit ?? DEFAULT_MESSAGE_LIMIT;
    const maxTokens = options.maxTokens;

    let rows = database.prepare(
        'SELECT id, session_id, role, content, token_estimate, created_at FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(sessionId, limit * 2) as StoredMessage[]; // fetch extra so we can trim by tokens

    rows = rows.reverse(); // chronological order

    if (!maxTokens) {
        return rows.slice(-limit);
    }

    let total = 0;
    const result: StoredMessage[] = [];
    for (let i = rows.length - 1; i >= 0 && result.length < limit; i--) {
        const msg = rows[i];
        const tokens = msg.token_estimate ?? Math.ceil((msg.content?.length ?? 0) * APPROX_TOKENS_PER_CHAR);
        if (total + tokens > maxTokens) break;
        total += tokens;
        result.unshift(msg);
    }
    return result;
}

/**
 * Run cleanup: delete sessions older than TTL, optionally trim messages per session, optionally VACUUM.
 */
export function runCleanup(options?: { sessionTtlDays?: number; trimMessagesPerSession?: number; vacuum?: boolean }): void {
    const database = getDb();
    const ttlDays = options?.sessionTtlDays ?? SESSION_TTL_DAYS;
    const cutoff = Math.floor(Date.now() / 1000) - ttlDays * 24 * 60 * 60;

    database.prepare('DELETE FROM sessions WHERE last_activity_at < ?').run(cutoff);

    if (options?.trimMessagesPerSession) {
        const maxPerSession = options.trimMessagesPerSession;
        const sessionIds = database.prepare('SELECT id FROM sessions').all() as Array<{ id: string }>;
        for (const { id } of sessionIds) {
            const toDelete = database.prepare(
                'SELECT id FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET ?'
            ).all(id, maxPerSession) as Array<{ id: number }>;
            if (toDelete.length > 0) {
                const ids = toDelete.map(r => r.id).join(',');
                database.prepare(`DELETE FROM messages WHERE id IN (${ids})`).run();
            }
        }
    }

    if (options?.vacuum) {
        database.exec('VACUUM');
    }
}

/**
 * Close the database (e.g. on shutdown). Idempotent.
 */
export function closeMemoryStore(): void {
    if (db) {
        db.close();
        db = null;
    }
}

// Export for RAGService: raw db access for chunks
export function getDbForChunks(): Database.Database {
    return getDb();
}
