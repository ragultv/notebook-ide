import { getDbForChunks } from './MemoryStore.js';
import { embed, embedMany } from './embeddings.js';

const SPARSE_TOP_N = 15;
const DENSE_TOP_N = 15;
const MERGE_TOP_K = 20;
const AFTER_RERANK = 8;
const RRF_K = 60; // constant for reciprocal rank fusion
const CHUNK_MAX_CHARS = 1200;

export interface RetrievalOptions {
    topK?: number;
    afterRerank?: number;
}

export interface RetrievedChunk {
    id: number;
    content: string;
    session_id: string;
    source: string;
    score?: number;
}

function float32ArrayToBuffer(arr: number[]): Buffer {
    const buf = Buffer.allocUnsafe(arr.length * 4);
    for (let i = 0; i < arr.length; i++) {
        buf.writeFloatLE(arr[i], i * 4);
    }
    return buf;
}

function bufferToFloat32Array(buf: Buffer): number[] {
    const arr: number[] = [];
    for (let i = 0; i < buf.length; i += 4) {
        arr.push(buf.readFloatLE(i));
    }
    return arr;
}

function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
}

/**
 * Chunk long text into smaller pieces for indexing (by size).
 */
function chunkText(text: string, maxChars: number = CHUNK_MAX_CHARS): string[] {
    if (text.length <= maxChars) return [text];
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
        let end = Math.min(start + maxChars, text.length);
        if (end < text.length) {
            const lastSpace = text.lastIndexOf(' ', end);
            if (lastSpace > start) end = lastSpace + 1;
        }
        chunks.push(text.slice(start, end).trim());
        start = end;
    }
    return chunks.filter(Boolean);
}

/**
 * Index content into chunks table and optionally embed it. If embedding fails, chunk is still stored (sparse-only).
 */
export async function indexChunks(
    sessionId: string,
    source: 'message' | 'cell' | 'attachment',
    content: string,
    options?: { embed?: boolean }
): Promise<void> {
    const db = getDbForChunks();
    const now = Math.floor(Date.now() / 1000);
    const texts = chunkText(content);

    if (texts.length === 0) return;

    let embeddings: number[][] = [];
    if (options?.embed !== false) {
        try {
            embeddings = await embedMany(texts, 'search_document');
        } catch (e) {
            console.warn('RAG index: embedding failed, storing chunks without embeddings:', (e as Error).message);
        }
    }

    const insert = db.prepare(
        'INSERT INTO chunks (session_id, source, content, embedding, created_at) VALUES (?, ?, ?, ?, ?)'
    );

    for (let i = 0; i < texts.length; i++) {
        const emb = embeddings[i];
        const blob = emb ? float32ArrayToBuffer(emb) : null;
        insert.run(sessionId, source, texts[i], blob, now);
    }
}

/**
 * Sparse retrieval via FTS5. Returns chunk rowids and a simple rank (1 = best).
 */
function sparseSearch(sessionId: string, query: string, topN: number): Array<{ id: number; rank: number }> {
    const db = getDbForChunks();
    const q = query.trim();
    if (!q) return [];

    try {
        const rows = db.prepare(
            `SELECT rowid as id FROM chunks_fts WHERE chunks_fts MATCH ? AND session_id = ? ORDER BY rank LIMIT ?`
        ).all(q, sessionId, topN) as Array<{ id: number }>;
        return rows.map((r, i) => ({ id: r.id, rank: i + 1 }));
    } catch {
        return [];
    }
}

/**
 * Dense retrieval: embed query, load session chunks with embeddings, cosine similarity, top-N.
 */
async function denseSearch(sessionId: string, query: string, topN: number): Promise<Array<{ id: number; score: number }>> {
    const db = getDbForChunks();
    let queryEmbedding: number[];
    try {
        queryEmbedding = await embed(query, 'search_query');
    } catch {
        return [];
    }

    const rows = db.prepare('SELECT id, embedding FROM chunks WHERE session_id = ? AND embedding IS NOT NULL').all(sessionId) as Array<{ id: number; embedding: Buffer }>;
    const withScore = rows.map(r => ({
        id: r.id,
        score: cosineSimilarity(queryEmbedding, bufferToFloat32Array(r.embedding)),
    }));
    withScore.sort((a, b) => b.score - a.score);
    return withScore.slice(0, topN);
}

/**
 * Reciprocal rank fusion: merge sparse and dense rankings.
 */
function rrfMerge(
    sparse: Array<{ id: number; rank: number }>,
    dense: Array<{ id: number; score: number }>
): Map<number, number> {
    const scores = new Map<number, number>();
    const add = (id: number, rank: number) => {
        scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank));
    };
    sparse.forEach((r, i) => add(r.id, i + 1));
    dense.forEach((r, i) => add(r.id, i + 1));
    return scores;
}

/**
 * Re-rank by combined score (heuristic) and return top-M chunk contents.
 */
function rerankAndFetch(chunkIdsByScore: Map<number, number>, topM: number): RetrievedChunk[] {
    const db = getDbForChunks();
    const sorted = [...chunkIdsByScore.entries()].sort((a, b) => b[1] - a[1]).slice(0, topM);
    if (sorted.length === 0) return [];

    const ids = sorted.map(([id]) => id);
    const placeholders = ids.map(() => '?').join(',');
    const rows = db.prepare(
        `SELECT id, content, session_id, source FROM chunks WHERE id IN (${placeholders})`
    ).all(...ids) as RetrievedChunk[];
    const byId = new Map(rows.map(r => [r.id, r]));
    return sorted.map(([id]) => byId.get(id)!).filter(Boolean);
}

/**
 * Hybrid retrieve: FTS5 + vector, merge with RRF, re-rank, return top-M chunks for context injection.
 */
export async function retrieve(
    sessionId: string,
    query: string,
    options: RetrievalOptions = {}
): Promise<RetrievedChunk[]> {
    const topK = options.topK ?? MERGE_TOP_K;
    const afterRerank = options.afterRerank ?? AFTER_RERANK;

    const [sparseResults, denseResults] = await Promise.all([
        Promise.resolve(sparseSearch(sessionId, query, SPARSE_TOP_N)),
        denseSearch(sessionId, query, DENSE_TOP_N),
    ]);

    const merged = rrfMerge(sparseResults, denseResults);
    return rerankAndFetch(merged, afterRerank);
}

/**
 * Build a single "Retrieved context" string from chunks for prepending to the system message.
 */
export function formatRetrievedContext(chunks: RetrievedChunk[]): string {
    if (chunks.length === 0) return '';
    return [
        '=== RETRIEVED CONTEXT (from memory) ===',
        ...chunks.map((c, i) => `[${i + 1}] (${c.source}):\n${c.content}`),
        '=== END RETRIEVED CONTEXT ===\n',
    ].join('\n');
}
