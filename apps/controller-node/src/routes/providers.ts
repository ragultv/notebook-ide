import type { FastifyInstance } from 'fastify';
import { KeyStore } from '../core/KeyStore.js';
import {
  listProviders, getProvider, upsertProvider, deleteCustomProvider,
  listProviderModels, getAllModels, getEnabledModels, upsertModels, setModelEnabled,
} from '../db/provider-db.js';

// ── Model fetcher ─────────────────────────────────────────────────────────────

async function fetchProviderModels(
  type: string,
  baseUrl: string,
  apiKey: string,
): Promise<Array<{ model_id: string; model_name: string; context_length: number }>> {
  const base = baseUrl.replace(/\/+$/, '');
  let url = `${base}/models`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (type === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (type === 'gemini') {
    url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status} ${text.slice(0, 300)}`);
  }

  const data: any = await res.json();

  // OpenAI-compatible (openai, groq, openrouter, togetherai, nvidia, deepseek, custom)
  if (Array.isArray(data?.data)) {
    return data.data.map((m: any) => ({
      model_id:       m.id ?? m.model ?? '',
      model_name:     m.id ?? m.model ?? '',
      context_length: m.context_length ?? m.context_window ?? 0,
    })).filter((m: any) => m.model_id);
  }

  // Anthropic (data.data but with display_name)
  if (data?.data?.[0]?.display_name) {
    return data.data.map((m: any) => ({
      model_id:       m.id,
      model_name:     m.display_name ?? m.id,
      context_length: 200_000,
    }));
  }

  // Gemini
  if (Array.isArray(data?.models)) {
    return data.models
      .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m: any) => ({
        model_id:       (m.name ?? '').replace('models/', ''),
        model_name:     m.displayName ?? (m.name ?? '').replace('models/', ''),
        context_length: m.inputTokenLimit ?? 0,
      }))
      .filter((m: any) => m.model_id);
  }

  return [];
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function providersRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /api/providers
   * List all providers (built-in + custom) with has_key and model_count.
   */
  app.get('/api/providers', async () => {
    return listProviders().map(p => ({
      id:          p.id,
      name:        p.name,
      type:        p.type,
      base_url:    p.base_url,
      is_builtin:  p.is_builtin === 1,
      has_key:     !!KeyStore.getKey(p.id),
      model_count: listProviderModels(p.id).length,
      enabled_count: listProviderModels(p.id).filter(m => m.is_enabled).length,
    }));
  });

  /**
   * POST /api/providers/:id/key
   * Save API key for a provider. Accepts { api_key: string }.
   */
  app.post('/api/providers/:id/key', async (req, reply) => {
    const id      = (req.params as Record<string, string>).id;
    const body    = req.body as Record<string, string>;
    const api_key = body?.api_key?.trim();

    if (!api_key) return reply.status(400).send({ error: 'api_key is required' });

    const provider = getProvider(id);
    if (!provider) return reply.status(404).send({ error: `Provider '${id}' not found` });

    KeyStore.setKey(id, api_key);
    return { success: true, provider_id: id };
  });

  /**
   * DELETE /api/providers/:id/key
   * Remove API key for a provider.
   */
  app.delete('/api/providers/:id/key', async (req, reply) => {
    const id = (req.params as Record<string, string>).id;
    const provider = getProvider(id);
    if (!provider) return reply.status(404).send({ error: `Provider '${id}' not found` });
    KeyStore.deleteKey(id);
    return { success: true };
  });

  /**
   * POST /api/providers/:id/fetch-models
   * Fetch available models from the provider's API and store them.
   */
  app.post('/api/providers/:id/fetch-models', async (req, reply) => {
    const id       = (req.params as Record<string, string>).id;
    const provider = getProvider(id);
    if (!provider) return reply.status(404).send({ error: `Provider '${id}' not found` });

    const apiKey = KeyStore.getKey(id) ?? '';
    if (!apiKey) return reply.status(400).send({ error: 'No API key saved for this provider. Save a key first.' });

    try {
      const models = await fetchProviderModels(provider.type, provider.base_url, apiKey);
      if (models.length === 0) return reply.status(502).send({ error: 'Provider returned no models' });
      upsertModels(id, models);
      return { success: true, count: models.length };
    } catch (err) {
      app.log.error({ err, providerId: id }, '[providers] fetch-models failed');
      return reply.status(502).send({ error: String(err) });
    }
  });

  /**
   * GET /api/providers/:id/models
   * List models for a specific provider.
   */
  app.get('/api/providers/:id/models', async (req, reply) => {
    const id       = (req.params as Record<string, string>).id;
    const provider = getProvider(id);
    if (!provider) return reply.status(404).send({ error: `Provider '${id}' not found` });
    return listProviderModels(id);
  });

  /**
   * GET /api/providers/models
   * List all models across all providers (for the Models page).
   */
  app.get('/api/providers/models', async () => getAllModels());

  /**
   * GET /api/providers/models/enabled
   * List only enabled models (for agent model selector + chat area).
   */
  app.get('/api/providers/models/enabled', async () => getEnabledModels());

  /**
   * POST /api/providers/models/toggle
   * Enable or disable a model. Body: { provider_id, model_id, enabled }.
   */
  app.post('/api/providers/models/toggle', async (req, reply) => {
    const { provider_id, model_id, enabled } = req.body as Record<string, any>;
    if (!provider_id || !model_id || enabled === undefined) {
      return reply.status(400).send({ error: 'provider_id, model_id, and enabled are required' });
    }
    setModelEnabled(provider_id, model_id, !!enabled);
    return { success: true };
  });

  /**
   * POST /api/providers (add custom provider)
   * Body: { id, name, type, base_url, api_key? }
   */
  app.post('/api/providers', async (req, reply) => {
    const body = req.body as Record<string, any>;
    const { id, name, type, base_url, api_key } = body ?? {};
    if (!id || !name || !base_url) {
      return reply.status(400).send({ error: 'id, name, and base_url are required' });
    }
    const provider = upsertProvider({ id, name, type: type ?? 'custom', base_url });
    if (api_key) KeyStore.setKey(id, api_key.trim());
    return { ...provider, has_key: !!KeyStore.getKey(id) };
  });

  /**
   * DELETE /api/providers/:id (delete custom provider only)
   */
  app.delete('/api/providers/:id', async (req, reply) => {
    const id       = (req.params as Record<string, string>).id;
    const provider = getProvider(id);
    if (!provider) return reply.status(404).send({ error: `Provider '${id}' not found` });
    if (provider.is_builtin) return reply.status(400).send({ error: 'Cannot delete built-in providers' });
    deleteCustomProvider(id);
    KeyStore.deleteKey(id);
    return { success: true };
  });
}
