import { FastifyInstance } from 'fastify';
import { aiService, AIRequest, ErrorFixRequest } from '../core/ai/AIService.js';
import { z } from 'zod';

// Validation schemas
const AIRequestSchema = z.object({
    prompt: z.string(),
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
            const result = await aiService.generate(validated.prompt, validated.context);
            return result;
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return reply.code(400).send({ error: 'Invalid request', details: error.errors });
            }
            return reply.code(500).send({ error: error.message });
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
