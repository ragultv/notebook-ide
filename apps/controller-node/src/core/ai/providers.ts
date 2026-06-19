// AI Provider Configurations
export interface ModelInfo {
    id: string;
    name: string;
    context: number;
}

export interface ProviderConfig {
    name: string;
    models: ModelInfo[];
    apiKey: string;
    baseUrl: string;
    dynamic?: boolean;
    isLocal?: boolean;
}

export const PROVIDERS: Record<string, ProviderConfig> = {
    nvidia: {
        name: 'NVIDIA NIM',
        models: [
            { id: 'meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B Instruct', context: 8192 },
            { id: 'meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B Instruct', context: 8192 },
            { id: 'meta/llama-3.1-405b-instruct', name: 'Llama 3.1 405B Instruct', context: 8192 },
            { id: 'mistralai/mixtral-8x7b-instruct-v0.1', name: 'Mixtral 8x7B', context: 32768 },
            { id: 'moonshotai/kimi-k2-instruct', name: 'Kimi-2', context: 85000 },
            { id: 'microsoft/phi-3-mini-128k-instruct', name: 'Phi-3 Mini 128K', context: 128000 },
        ],
        apiKey: "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",
        baseUrl: 'https://integrate.api.nvidia.com/v1',
    },
    groq: {
        name: 'Groq',
        models: [
            { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', context: 128000 },
            { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', context: 128000 },
            { id: 'llama3-70b-8192', name: 'Llama 3 70B', context: 8192 },
            { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', context: 32768 },
            { id: 'gemma2-9b-it', name: 'Gemma 2 9B', context: 8192 },
        ],
        apiKey: process.env.GROQ_API_KEY || '',
        baseUrl: 'https://api.groq.com/openai/v1',
    },
    gemini: {
        name: 'Google Gemini',
        models: [
            { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', context: 1000000 },
            { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', context: 2000000 },
            { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', context: 1000000 },
        ],
        apiKey: process.env.GEMINI_API_KEY || '',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    },
    openai: {
        name: 'OpenAI',
        models: [
            { id: 'gpt-4o', name: 'GPT-4o', context: 128000 },
            { id: 'gpt-4o-mini', name: 'GPT-4o Mini', context: 128000 },
            { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', context: 128000 },
            { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', context: 16385 },
        ],
        apiKey: process.env.OPENAI_API_KEY || '',
        baseUrl: 'https://api.openai.com/v1',
    },
    anthropic: {
        name: 'Anthropic',
        models: [
            { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet', context: 200000 },
            { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku', context: 200000 },
            { id: 'claude-3-opus-latest', name: 'Claude 3 Opus', context: 200000 },
        ],
        apiKey: process.env.ANTHROPIC_API_KEY || '',
        baseUrl: '', // Used by @langchain/anthropic natively
    },
    grok: {
        name: 'xAI Grok',
        models: [
            { id: 'grok-2-latest', name: 'Grok 2', context: 131072 },
            { id: 'grok-2-vision-latest', name: 'Grok 2 Vision', context: 8192 },
        ],
        apiKey: process.env.XAI_API_KEY || '',
        baseUrl: 'https://api.x.ai/v1',
    },
    openrouter: {
        name: 'OpenRouter',
        models: [
            { id: 'openrouter/auto', name: 'Auto Route', context: 8192 },
            { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet (OR)', context: 200000 },
            { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B (OR)', context: 8192 },
            { id: 'google/gemini-pro-1.5', name: 'Gemini 1.5 Pro (OR)', context: 2000000 },
        ],
        apiKey: process.env.OPENROUTER_API_KEY || '',
        baseUrl: 'https://openrouter.ai/api/v1',
    },
    togetherai: {
        name: 'Together AI',
        models: [
            { id: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', name: 'Llama 3.1 70B Turbo', context: 131072 },
            { id: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', name: 'Llama 3.1 8B Turbo', context: 131072 },
            { id: 'mistralai/Mixtral-8x7B-Instruct-v0.1', name: 'Mixtral 8x7B', context: 32768 },
        ],
        apiKey: process.env.TOGETHER_API_KEY || '',
        baseUrl: 'https://api.together.xyz/v1',
    },
    deepseek: {
        name: 'DeepSeek',
        models: [
            { id: 'deepseek-chat', name: 'DeepSeek Chat (V3)', context: 65536 },
            { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner (R1)', context: 65536 },
        ],
        apiKey: process.env.DEEPSEEK_API_KEY || '',
        baseUrl: 'https://api.deepseek.com',
    },
    mistralai: {
        name: 'Mistral AI',
        models: [
            { id: 'mistral-large-latest', name: 'Mistral Large', context: 131000 },
            { id: 'open-mixtral-8x22b', name: 'Mixtral 8x22B', context: 65536 },
            { id: 'mistral-small-latest', name: 'Mistral Small', context: 32768 },
        ],
        apiKey: process.env.MISTRAL_API_KEY || '',
        baseUrl: 'https://api.mistral.ai/v1',
    },
    ollama: {
        name: 'Ollama (Local)',
        models: [],
        apiKey: '',
        baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
        dynamic: true,
        isLocal: true,
    },
    octoml: {
        name: 'OctoML (Local)',
        models: [],
        apiKey: '',
        baseUrl: process.env.OCTOML_BASE_URL || 'http://localhost:11435',
        dynamic: true,
        isLocal: true,
    },
};

export const DEFAULT_PROVIDER = 'nvidia';
export const DEFAULT_MODEL = 'meta/llama-3.1-405b-instruct';
