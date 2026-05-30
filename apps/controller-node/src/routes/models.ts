/**
 * models.ts — P1-3: API key operations now persist via KeyStore (AES-256-GCM encrypted on disk).
 * On set: key is written to KeyStore AND applied to the in-memory aiService for immediate effect.
 * On startup: aiService should call KeyStore.getKey(provider) to restore keys — see AIService bootstrap.
 */

import { FastifyInstance } from 'fastify';
import { aiService } from '../core/ai/AIService.js';
import { KeyStore } from '../core/KeyStore.js';
import { z } from 'zod';

// ── Validation schemas ────────────────────────────────────────────────────────

const SetModelSchema = z.object({
    provider: z.string().min(1),
    model:    z.string().min(1),
});

const SetApiKeySchema = z.object({
    provider: z.string().min(1),
    apiKey:   z.string().min(1),
});

const ToggleModelSelectionSchema = z.object({
    provider: z.string().min(1),
    modelId:  z.string().min(1),
    selected: z.boolean(),
});

const DeleteApiKeySchema = z.object({
    provider: z.string().min(1),
});

// ── Routes ────────────────────────────────────────────────────────────────────

export async function modelsRoutes(fastify: FastifyInstance) {

    // List all available providers and models
    fastify.get('/providers', async (_request, reply) => {
        try {
            const providers = await aiService.getAvailableProviders();
            return {
                providers,
                current:        aiService.getCurrentModel(),
                selectedModels: aiService.getSelectedModels(),
                // Surface which providers have a stored key so the UI can show ✓ indicators
                storedKeys:     KeyStore.listProviders(),
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
            return { success, current: aiService.getCurrentModel() };
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return reply.code(400).send({ error: 'Invalid request', details: error.errors });
            }
            return reply.code(500).send({ error: error.message });
        }
    });

    // Get current model
    fastify.get('/current', async (_request, _reply) => {
        return aiService.getCurrentModel();
    });

    // P1-3: Set API key — persists to encrypted KeyStore AND applies to in-memory aiService immediately.
    fastify.post('/api-key', async (request, reply) => {
        try {
            const { provider, apiKey } = SetApiKeySchema.parse(request.body);

            // Persist to disk first, then apply in-memory
            KeyStore.setKey(provider, apiKey);
            const success = aiService.setApiKey(provider, apiKey);

            return { success, persisted: true };
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return reply.code(400).send({ error: 'Invalid request', details: error.errors });
            }
            return reply.code(500).send({ error: error.message });
        }
    });

    // P1-3: Delete API key — removes from KeyStore and clears from in-memory aiService.
    fastify.delete('/api-key', async (request, reply) => {
        try {
            const { provider } = DeleteApiKeySchema.parse(request.body);
            const deleted = KeyStore.deleteKey(provider);
            // Also clear from in-memory service (empty string = no key)
            if (deleted) aiService.setApiKey(provider, '');
            return { deleted };
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return reply.code(400).send({ error: 'Invalid request', details: error.errors });
            }
            return reply.code(500).send({ error: error.message });
        }
    });

    // P1-3: List which providers have a stored key (does NOT return the key itself).
    fastify.get('/api-keys', async (_request, _reply) => {
        return { providers: KeyStore.listProviders() };
    });

    // Toggle model selection for chat dropdown
    fastify.post('/toggle-selection', async (request, reply) => {
        try {
            const { provider, modelId, selected } = ToggleModelSelectionSchema.parse(request.body);
            const selectedModels = aiService.toggleModelSelection(provider, modelId, selected);
            return { success: true, selectedModels };
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return reply.code(400).send({ error: 'Invalid request', details: error.errors });
            }
            return reply.code(500).send({ error: error.message });
        }
    });

    // Get selected models
    fastify.get('/selected', async (_request, _reply) => {
        return { selectedModels: aiService.getSelectedModels() };
    });
}
