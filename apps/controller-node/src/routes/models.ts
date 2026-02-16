import { FastifyInstance } from 'fastify';
import { aiService } from '../core/ai/AIService.js';
import { z } from 'zod';

// Validation schemas
const SetModelSchema = z.object({
    provider: z.string(),
    model: z.string(),
});

const SetApiKeySchema = z.object({
    provider: z.string(),
    apiKey: z.string(),
});

const ToggleModelSelectionSchema = z.object({
    provider: z.string(),
    modelId: z.string(),
    selected: z.boolean(),
});

export async function modelsRoutes(fastify: FastifyInstance) {
    // Get all available providers and models
    fastify.get('/providers', async (request, reply) => {
        try {
            const providers = await aiService.getAvailableProviders();
            return {
                providers,
                current: aiService.getCurrentModel(),
                selectedModels: aiService.getSelectedModels(),
            };
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });

    // Select a model
    fastify.post('/select', async (request, reply) => {
        try {
            const { provider, model } = SetModelSchema.parse(request.body);
            const success = aiService.setModel(provider, model);

            return {
                success,
                current: aiService.getCurrentModel(),
            };
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return reply.code(400).send({ error: 'Invalid request', details: error.errors });
            }
            return reply.code(500).send({ error: error.message });
        }
    });

    // Get current model
    fastify.get('/current', async (request, reply) => {
        return aiService.getCurrentModel();
    });

    // Set API key for a provider
    fastify.post('/api-key', async (request, reply) => {
        try {
            const { provider, apiKey } = SetApiKeySchema.parse(request.body);
            const success = aiService.setApiKey(provider, apiKey);

            return { success };
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return reply.code(400).send({ error: 'Invalid request', details: error.errors });
            }
            return reply.code(500).send({ error: error.message });
        }
    });

    // Toggle model selection for chat dropdown
    fastify.post('/toggle-selection', async (request, reply) => {
        try {
            const { provider, modelId, selected } = ToggleModelSelectionSchema.parse(request.body);
            const selectedModels = aiService.toggleModelSelection(provider, modelId, selected);

            return {
                success: true,
                selectedModels,
            };
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return reply.code(400).send({ error: 'Invalid request', details: error.errors });
            }
            return reply.code(500).send({ error: error.message });
        }
    });

    // Get selected models
    fastify.get('/selected', async (request, reply) => {
        return {
            selectedModels: aiService.getSelectedModels(),
        };
    });
}
