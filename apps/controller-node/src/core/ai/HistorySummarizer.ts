import { getRecentMessages } from './MemoryStore.js';
import { PROVIDERS } from './providers.js';

/**
 * Very lightweight history summarizer.
 * Currently it does NOT call an LLM; it just compacts old messages into a short textual summary.
 * This can be extended later to use a dedicated summarization model.
 */
export function summarizeHistory(sessionId: string, targetTokenApprox: number = 1024): string {
    const recent = getRecentMessages(sessionId, {
        limit: 50,
        maxTokens: targetTokenApprox,
    });

    if (!recent.length) return '';

    const summaryLines: string[] = [];
    for (const m of recent) {
        const role = m.role === 'assistant' ? 'AI' : 'User';
        const content = m.content.replace(/\s+/g, ' ').slice(0, 200);
        summaryLines.push(`${role}: ${content}${m.content.length > 200 ? '...' : ''}`);
        if (summaryLines.length >= 16) break;
    }

    return `Conversation summary:\n` + summaryLines.join('\n');
}

