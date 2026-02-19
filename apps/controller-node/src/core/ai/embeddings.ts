import { config } from '../../config.js';

const EMBED_MODEL = 'nomic-embed-text:latest';
const CONCURRENCY = 5;
const TIMEOUT_MS = 30000;

let baseUrl: string;

function getBaseUrl(): string {
    if (!baseUrl) {
        baseUrl = config.ollamaEmbedBaseUrl.replace(/\/$/, '');
        if (baseUrl.endsWith('/v1')) baseUrl = baseUrl.replace(/\/v1$/, '');
    }
    return baseUrl;
}

export type EmbedTaskType = 'search_document' | 'search_query';

/**
 * Embed a single text with Ollama nomic-embed-text.
 * Use search_document for indexing chunks, search_query for the user query.
 */
export async function embed(text: string, task: EmbedTaskType = 'search_document'): Promise<number[]> {
    const url = `${getBaseUrl()}/api/embeddings`;
    const body: Record<string, unknown> = {
        model: EMBED_MODEL,
        prompt: text,
    };
    // Some Ollama versions support input type for nomic
    if (task) {
        try {
            (body as any).input = task;
        } catch (_) {}
    }

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
        const t = await res.text();
        throw new Error(`Ollama embeddings failed (${res.status}): ${t}`);
    }

    const data = (await res.json()) as { embedding?: number[] };
    if (!Array.isArray(data.embedding)) {
        throw new Error('Ollama embeddings response missing embedding array');
    }
    return data.embedding;
}

/**
 * Embed multiple texts with a concurrency limit. Uses search_document for all (e.g. for indexing).
 */
export async function embedMany(texts: string[], task: EmbedTaskType = 'search_document'): Promise<number[][]> {
    if (texts.length === 0) return [];
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += CONCURRENCY) {
        const batch = texts.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(batch.map(t => embed(t, task)));
        results.push(...batchResults);
    }
    return results;
}

/**
 * Check if the embedding service is available (e.g. Ollama running with nomic-embed-text).
 */
export async function isEmbeddingAvailable(): Promise<boolean> {
    try {
        await embed('test', 'search_query');
        return true;
    } catch {
        return false;
    }
}
