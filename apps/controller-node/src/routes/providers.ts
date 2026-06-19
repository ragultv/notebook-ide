import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { ProviderStore } from '../core/ProviderStore.js';
import { KeyStore } from '../core/KeyStore.js';

function getDynamicProviders() {
    return ProviderStore.getProviders();
}

function toDbRow(p: any) {
    return {
        id: p.id,
        name: p.name,
        type: p.type,
        api_key: p.apiKey || '',
        base_url: p.baseUrl || '',
        enabled: p.enabled,
        enabled_model_ids: p.enabledModelIds || [],
        available_model_ids: p.availableModelIds || [],
        last_fetched: p.lastFetched || null,
    };
}

export const providersRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
    fastify.get('/', async (_request, reply) => {
        try {
            const providers = getDynamicProviders();
            return reply.send(providers.map(toDbRow));
        } catch (error: any) {
            return reply.status(500).send({ detail: error.message });
        }
    });

    fastify.post('/:id', async (request: any, reply) => {
        try {
            const id = request.params.id;
            const p = request.body;
            
            const config: any = {
                id: p.id,
                name: p.name,
                type: p.type,
                apiKey: p.api_key,
                baseUrl: p.base_url,
                enabled: p.enabled,
                enabledModelIds: p.enabled_model_ids || [],
                availableModelIds: p.available_model_ids || [],
                lastFetched: p.last_fetched,
            };

            if (config.apiKey && config.apiKey.trim() !== '') {
                KeyStore.setKey(id, config.apiKey);
            } else {
                const existing = KeyStore.getKey(id);
                if (existing) {
                    config.apiKey = 'saved';
                }
            }

            ProviderStore.saveProvider(config);
            return reply.send(toDbRow(config));
        } catch (error: any) {
            return reply.status(500).send({ detail: error.message });
        }
    });

    fastify.delete('/:id', async (request: any, reply) => {
        try {
            const id = request.params.id;
            ProviderStore.deleteProvider(id);
            KeyStore.deleteKey(id);
            return reply.status(204).send();
        } catch (error: any) {
            return reply.status(500).send({ detail: error.message });
        }
    });

    fastify.get('/:id/models', async (request: any, reply) => {
        try {
            const id = request.params.id;
            const providers = ProviderStore.getProviders();
            const provider = providers.find(p => p.id === id);
            
            if (!provider) {
                return reply.status(404).send({ detail: 'Provider not found' });
            }

            let apiKey = provider.apiKey;
            if (apiKey === 'saved') {
                apiKey = KeyStore.getKey(id) || '';
            }

            if (!apiKey && provider.type !== 'openai-compatible' && provider.type !== 'nvidia') {
                return reply.status(400).send({ detail: 'API Key is missing for this provider' });
            }

            let baseUrl = provider.baseUrl;
            if (!baseUrl) {
                const defaults: any = {
                    'openai': 'https://api.openai.com/v1',
                    'gemini': 'https://generativelanguage.googleapis.com/v1beta',
                    'nvidia': 'https://integrate.api.nvidia.com/v1',
                    'groq': 'https://api.groq.com/openai/v1',
                    'openrouter': 'https://openrouter.ai/api/v1',
                    'anthropic': 'https://api.anthropic.com/v1'
                };
                baseUrl = defaults[provider.type] || '';
            }

            let fetchUrl = `${(baseUrl || '').replace(/\/+$/, '')}/models`;
            
            const headers: any = {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            };

            if (provider.type === 'anthropic') {
                headers['x-api-key'] = apiKey;
                headers['anthropic-version'] = '2023-06-01';
                delete headers['Authorization'];
            } else if (provider.type === 'gemini') {
                fetchUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
                delete headers['Authorization'];
            }

            console.log(`[Providers] Fetching models from ${fetchUrl}`);
            const response = await fetch(fetchUrl, { headers });

            if (!response.ok) {
                const err = await response.text();
                console.error(`[Providers] Model fetch error: ${err}`);
                return reply.status(response.status).send({ detail: `Failed to fetch models: ${response.statusText}` });
            }

            const data: any = await response.json();
            
            let models: string[] = [];
            if (data.data && Array.isArray(data.data)) {
                models = data.data.map((m: any) => m.id);
            } else if (data.models && Array.isArray(data.models)) {
                models = data.models.map((m: any) => m.name.replace('models/', ''));
            }

            return reply.send(models);
        } catch (error: any) {
            return reply.status(500).send({ detail: error.message });
        }
    });
};
