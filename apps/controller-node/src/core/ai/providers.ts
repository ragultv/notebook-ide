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
    ollama: {
        name: 'Ollama (Local)',
        models: [],
        apiKey: '',
        baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
        dynamic: true,
        isLocal: true,
    },
    octopod: {
        name: 'Octopod (Local)',
        models: [],
        apiKey: '',
        baseUrl: process.env.OCTOPOD_BASE_URL || 'http://localhost:11435',
        dynamic: true,
        isLocal: true,
    },
};

export const DEFAULT_PROVIDER = 'nvidia';
export const DEFAULT_MODEL = 'meta/llama-3.1-405b-instruct';
