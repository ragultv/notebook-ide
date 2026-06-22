import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { OctomlStore } from '../core/ai-agents/store/octoml-store.js';
import { getProvider, getEnabledModels, listProviders, listProviderModels } from '../db/provider-db.js';
import { KeyStore } from '../core/KeyStore.js';

const SelectModelSchema = z.object({
  project_path: z.string().optional(),
  provider_id:  z.string().min(1),
  model_id:     z.string().min(1),
});

export async function agentModelsRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /api/agent/models
   * Returns all providers + their models for the agent model selector.
   * Only providers with an API key and at least one fetched model are useful.
   */
  app.get('/api/agent/models', async (_req: FastifyRequest, _reply: FastifyReply) => {
    const providers = listProviders().map(p => {
      const models  = listProviderModels(p.id);
      const has_key = !!KeyStore.getKey(p.id);
      return {
        id:       p.id,
        name:     p.name,
        type:     p.type,
        has_key,
        is_local: false,
        models:   models.map(m => ({
          id:         m.model_id,
          name:       m.model_name,
          context:    m.context_length,
          is_enabled: m.is_enabled === 1,
        })),
      };
    }).filter(p => p.models.length > 0);

    return { providers };
  });

  /**
   * GET /api/agent/model?project_path=...
   * Returns the currently active model using this priority:
   *  1. OctomlStore project-level override
   *  2. First enabled model in the provider DB
   */
  app.get('/api/agent/model', async (req: FastifyRequest, _reply: FastifyReply) => {
    const { project_path } = req.query as Record<string, string>;

    // 1. Project-level override
    if (project_path) {
      const store = new OctomlStore(project_path);
      const state = await store.getState();
      if (state.active_provider && state.active_model_id) {
        const prov = getProvider(state.active_provider);
        return {
          provider_id:   state.active_provider,
          provider_name: prov?.name ?? state.active_provider,
          model_id:      state.active_model_id,
          model_name:    state.active_model_id,
          source:        'project',
        };
      }
    }

    // 2. First enabled model in provider DB
    const enabled = getEnabledModels();
    if (enabled.length > 0) {
      const m = enabled[0];
      return {
        provider_id:   m.provider_id,
        provider_name: m.provider_name,
        model_id:      m.model_id,
        model_name:    m.model_name,
        source:        'enabled',
      };
    }

    return { provider_id: null, provider_name: null, model_id: null, model_name: null, source: 'none' };
  });

  /**
   * POST /api/agent/model
   * Set the active model for a project (stored in OctomlStore).
   * Body: { project_path?, provider_id, model_id }
   */
  app.post('/api/agent/model', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = SelectModelSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });

    const { project_path, provider_id, model_id } = parsed.data;
    const prov = getProvider(provider_id);

    if (project_path) {
      const store = new OctomlStore(project_path);
      await store.setState({ active_provider: provider_id, active_model_id: model_id });
    }

    return {
      success:       true,
      provider_id,
      provider_name: prov?.name ?? provider_id,
      model_id,
      model_name:    model_id,
    };
  });
}
