import { FastifyInstance } from 'fastify';
import { aiService, AIRequest, ErrorFixRequest, GenerateStreamCallbacks } from '../core/ai/AIService.js';
import { notebookAgentAdapter } from '../core/ai/NotebookAgentAdapter.js';
import { getAllSessions, getAllMessagesForSession, getSessionStats } from '../core/ai/MemoryStore.js';
import { z } from 'zod';
import type { AgentMode } from 'no-rag-notebook-agent';

function writeSSE(reply: any, event: string, data: object): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    reply.raw.write(payload);
}

// Validation schemas
const AIRequestSchema = z.object({
    prompt: z.string(),
    sessionId: z.string().optional().nullable(),
    mode: z.enum(['ask', 'agent', 'plan']).optional(),
    context: z.object({
        notebookName: z.string().optional(),
        cells: z.array(z.object({
            type: z.string(),
            content: z.string(),
        })).optional(),
    }).optional(),
});

const ErrorFixRequestSchema = z.object({
    cellIndex: z.number(),
    error: z.string(),
    cellContent: z.string(),
    context: z.object({
        notebookName: z.string().optional(),
        cells: z.array(z.object({
            type: z.string(),
            content: z.string(),
        })).optional(),
    }).optional(),
});

/** Map sidebar mode string to agent AgentMode enum */
function toAgentMode(mode?: string): AgentMode {
    switch (mode) {
        case 'plan': return 'PLAN';
        case 'agent': return 'AGENT';
        case 'ask':
        default: return 'ASK';
    }
}

export async function aiRoutes(fastify: FastifyInstance) {
    // AI Assistant endpoint (non-streaming) — routed through NotebookAgentAdapter
    fastify.post('/assist', async (request, reply) => {
        try {
            const validated = AIRequestSchema.parse(request.body);
            const sessionId = validated.sessionId ?? 'default';
            const agentMode = toAgentMode(validated.mode);

            // Route through the no-RAG agent (state + memory + mode-aware)
            const agentResponse = await notebookAgentAdapter.processMessage(
                sessionId,
                validated.prompt,
                validated.context,
                agentMode,
            );

            // Map AgentResponse → the AIResponse shape the frontend expects
            const operations = (agentResponse.metadata as any)?.operations ?? [];
            return {
                text: agentResponse.content,
                operations,
                sessionId,
                mode: validated.mode ?? 'ask',
                type: agentResponse.type,
            };
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return reply.code(400).send({ error: 'Invalid request', details: error.errors });
            }
            return reply.code(500).send({ error: error.message });
        }
    });

    // Streaming AI Assistant endpoint (SSE) — routed through NotebookAgentAdapter
    fastify.post('/assist/stream', async (request, reply) => {
        const originHeader = (request.headers.origin as string | undefined) ?? '*';
        try {
            const validated = AIRequestSchema.parse(request.body);
            const sessionId = validated.sessionId ?? 'default';
            const agentMode = toAgentMode(validated.mode);

            reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
            reply.raw.setHeader('Connection', 'keep-alive');
            reply.raw.setHeader('X-Accel-Buffering', 'no');
            reply.raw.setHeader('Access-Control-Allow-Origin', originHeader);
            reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
            reply.raw.flushHeaders?.();

            // Process via agent (blocking, not streaming at agent level)
            // We stream the response back as SSE chunks once we have it
            let agentResponse;
            try {
                agentResponse = await notebookAgentAdapter.processMessage(
                    sessionId,
                    validated.prompt,
                    validated.context,
                    agentMode,
                );
            } catch (agentErr: any) {
                writeSSE(reply, 'error', { message: agentErr.message });
                reply.raw.end();
                return;
            }

            const operations = (agentResponse.metadata as any)?.operations ?? [];
            const content = agentResponse.content ?? '';

            // Stream content as word chunks for the UI animation
            const words = content.split(/(?<=\s)/);
            for (const word of words) {
                if (word) {
                    writeSSE(reply, 'chunk', { delta: word });
                    await new Promise(r => setTimeout(r, 20)); // typing delay
                }
            }

            // Emit operations / plan_ready depending on mode
            if (operations.length > 0) {
                if (agentMode === 'PLAN') {
                    writeSSE(reply, 'plan_ready', { operations });
                } else {
                    writeSSE(reply, 'operations', { operations });
                }
            }

            writeSSE(reply, 'done', {
                text: content,
                operations,
                sessionId,
                mode: validated.mode ?? 'ask',
                type: agentResponse.type,
            });
            reply.raw.end();

        } catch (error: any) {
            if (error.name === 'ZodError') {
                if (!reply.raw.headersSent) {
                    reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
                    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
                    reply.raw.setHeader('Connection', 'keep-alive');
                    reply.raw.setHeader('X-Accel-Buffering', 'no');
                    reply.raw.setHeader('Access-Control-Allow-Origin', originHeader);
                    reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
                    reply.raw.flushHeaders?.();
                }
                if (!reply.raw.writableEnded) {
                    writeSSE(reply, 'error', { message: 'Invalid request' });
                    reply.raw.end();
                }
                return;
            }
            if (!reply.raw.headersSent) {
                reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
                reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
                reply.raw.setHeader('Connection', 'keep-alive');
                reply.raw.setHeader('X-Accel-Buffering', 'no');
                reply.raw.setHeader('Access-Control-Allow-Origin', originHeader);
                reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
                reply.raw.flushHeaders?.();
            }
            if (!reply.raw.writableEnded) {
                writeSSE(reply, 'error', { message: error.message });
                reply.raw.end();
            }
        }
    });

    // Error fixing endpoint — kept on direct AIService (no agent needed)
    fastify.post('/fix_error', async (request, reply) => {
        try {
            const validated = ErrorFixRequestSchema.parse(request.body);
            const result = await aiService.fixError(validated as ErrorFixRequest);
            return result;
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return reply.code(400).send({ error: 'Invalid request', details: error.errors });
            }
            return reply.code(500).send({ error: error.message });
        }
    });

    // Chat history endpoints
    fastify.get('/chat/sessions', async (request, reply) => {
        try {
            const sessions = getAllSessions();
            const sessionsWithStats = sessions.map(session => {
                const stats = getSessionStats(session.id);
                return { ...session, messageCount: stats.messageCount };
            });
            return { sessions: sessionsWithStats };
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });

    fastify.get('/chat/sessions/:sessionId/messages', async (request, reply) => {
        try {
            const { sessionId } = request.params as { sessionId: string };
            const messages = getAllMessagesForSession(sessionId);
            return { messages };
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });

    // Agent state/mode endpoints
    fastify.get('/agent/state/:sessionId', async (request, reply) => {
        try {
            const { sessionId } = request.params as { sessionId: string };
            return notebookAgentAdapter.getAgentState(sessionId);
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });

    fastify.post('/agent/mode', async (request, reply) => {
        try {
            const { sessionId, mode } = request.body as { sessionId: string; mode: AgentMode };
            await notebookAgentAdapter.setMode(sessionId, mode);
            return { success: true, mode };
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });
}
