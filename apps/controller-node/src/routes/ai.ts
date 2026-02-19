import { FastifyInstance } from 'fastify';
import { aiService, AIRequest, ErrorFixRequest, GenerateStreamCallbacks } from '../core/ai/AIService.js';
import { z } from 'zod';

function writeSSE(reply: any, event: string, data: object): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    reply.raw.write(payload);
}

// Validation schemas
const AIRequestSchema = z.object({
    prompt: z.string(),
    sessionId: z.string().optional().nullable(),
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

export async function aiRoutes(fastify: FastifyInstance) {
    // AI Assistant endpoint
    fastify.post('/assist', async (request, reply) => {
        try {
            const validated = AIRequestSchema.parse(request.body);
            const result = await aiService.generate(
                validated.prompt,
                validated.context,
                undefined,
                undefined,
                validated.sessionId ?? undefined
            );
            return result;
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return reply.code(400).send({ error: 'Invalid request', details: error.errors });
            }
            return reply.code(500).send({ error: error.message });
        }
    });

    // Streaming AI Assistant endpoint (SSE)
    fastify.post('/assist/stream', async (request, reply) => {
        try {
            const validated = AIRequestSchema.parse(request.body);
            reply.raw.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            });
            reply.raw.flushHeaders?.();

            const callbacks: GenerateStreamCallbacks = {
                onChunk: (delta) => writeSSE(reply, 'chunk', { delta }),
                onOperations: (operations) => writeSSE(reply, 'operations', { operations }),
                onDone: (payload) => {
                    writeSSE(reply, 'done', payload);
                    reply.raw.end();
                },
                onError: (message) => {
                    writeSSE(reply, 'error', { message });
                    reply.raw.end();
                },
            };

            await aiService.generateStream(
                validated.prompt,
                validated.context,
                undefined,
                undefined,
                validated.sessionId ?? undefined,
                callbacks
            );
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return reply.code(400).send({ error: 'Invalid request', details: error.errors });
            }
            if (!reply.raw.headersSent) {
                reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
                reply.raw.flushHeaders?.();
            }
            if (!reply.raw.writableEnded) {
                reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
                reply.raw.end();
            }
        }
    });

    // Error fixing endpoint
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
}
