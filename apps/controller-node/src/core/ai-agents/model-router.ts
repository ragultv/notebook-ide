import { createAnthropic }           from '@ai-sdk/anthropic';
import { createOpenAI }              from '@ai-sdk/openai';
import { createGroq }                from '@ai-sdk/groq';
import { createGoogleGenerativeAI }  from '@ai-sdk/google';
import { createDeepSeek }            from '@ai-sdk/deepseek';
import type { LanguageModel }        from 'ai';
import { KeyStore }                  from '../KeyStore.js';
import { OctomlStore }               from './store/octoml-store.js';
import { getProvider, getEnabledModels } from '../../db/provider-db.js';

// ── Build a Vercel AI SDK LanguageModel from a provider + model ID ────────────

function buildModel(providerId: string, modelId: string): LanguageModel {
  const apiKey  = KeyStore.getKey(providerId) ?? '';
  const provRow = getProvider(providerId);
  const baseUrl = provRow?.base_url ?? '';
  const type    = provRow?.type    ?? providerId;

  switch (type) {
    case 'anthropic': {
      if (!apiKey) throw new Error(`No API key for Anthropic`);
      return createAnthropic({ apiKey })(modelId);
    }
    case 'openai': {
      if (!apiKey) throw new Error(`No API key for OpenAI`);
      return createOpenAI({ apiKey }).chat(modelId);
    }
    case 'groq': {
      if (!apiKey) throw new Error(`No API key for Groq`);
      return createGroq({ apiKey })(modelId);
    }
    case 'gemini': {
      if (!apiKey) throw new Error(`No API key for Google Gemini`);
      return createGoogleGenerativeAI({ apiKey })(modelId);
    }
    case 'deepseek': {
      if (!apiKey) throw new Error(`No API key for DeepSeek`);
      return createDeepSeek({ apiKey })(modelId);
    }
    case 'cerebras': {
      if (!apiKey) throw new Error(`No API key for Cerebras`);
      return createOpenAI({
        apiKey,
        baseURL: 'https://api.cerebras.ai/v1',
      }).chat(modelId);
    }
    default: {
      // nvidia, openrouter, togetherai, custom — all OpenAI-compatible
      return createOpenAI({
        apiKey:  apiKey || 'local',
        baseURL: baseUrl,
      }).chat(modelId);
    }
  }
}

/**
 * Resolve the LanguageModel for an agent run.
 *
 * Priority (first wins):
 *  1. Project-level override stored in .octoml/state.json
 *  2. First enabled model from the provider DB  (Settings → Models → toggle on)
 */
export async function resolveModel(projectPath: string): Promise<LanguageModel> {
  // 1. Project-level override
  const store = new OctomlStore(projectPath);
  const state = await store.getState();
  if (state.active_provider && state.active_model_id) {
    return buildModel(state.active_provider, state.active_model_id);
  }

  // 2. First enabled model from the provider DB
  const enabled = getEnabledModels();
  if (enabled.length > 0) {
    return buildModel(enabled[0].provider_id, enabled[0].model_id);
  }

  throw new Error(
    'No model configured. Go to Settings → Connect Provider, add an API key, ' +
    'fetch models, then enable at least one model in Settings → Models.',
  );
}
