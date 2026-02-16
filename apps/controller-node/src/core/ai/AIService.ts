import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { PROVIDERS, DEFAULT_PROVIDER, DEFAULT_MODEL, ProviderConfig, ModelInfo } from './providers.js';
import { SYSTEM_PROMPT, ERROR_FIX_PROMPT } from './prompts.js';

export interface AIRequest {
    prompt: string;
    context?: {
        notebookName?: string;
        cells?: Array<{ type: string; content: string }>;
    };
}

export interface ErrorFixRequest {
    cellIndex: number;
    error: string;
    cellContent: string;
    context?: {
        notebookName?: string;
        cells?: Array<{ type: string; content: string }>;
    };
}

export interface AIResponse {
    text: string;
    operations?: Array<{
        type: string;
        params: Record<string, any>;
    }>;
    tokenInfo?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
    };
}

export interface SelectedModel {
    provider: string;
    modelId: string;
}

export class AIService {
    private currentProvider: string = DEFAULT_PROVIDER;
    private currentModel: string = DEFAULT_MODEL;
    private clients: Map<string, ChatOpenAI> = new Map();
    private selectedModels: SelectedModel[] = [];
    private apiKeys: Map<string, string> = new Map();

    constructor() {
        this.initializeApiKeys();
        this.initDefaultClient();
    }

    private initializeApiKeys() {
        // Load API keys from environment
        for (const [provider, config] of Object.entries(PROVIDERS)) {
            if (config.apiKey) {
                this.apiKeys.set(provider, config.apiKey);
            }
        }
    }

    private initDefaultClient() {
        const providerConfig = PROVIDERS[DEFAULT_PROVIDER];
        if (providerConfig && providerConfig.apiKey) {
            try {
                const client = new ChatOpenAI({
                    modelName: DEFAULT_MODEL,
                    temperature: 0.2,
                    apiKey: providerConfig.apiKey,  // Use 'apiKey' for compatibility
                    configuration: {
                        baseURL: providerConfig.baseUrl,
                    },
                });
                this.clients.set(`${DEFAULT_PROVIDER}:${DEFAULT_MODEL}`, client);
            } catch (error) {
                console.error('Failed to initialize default AI client:', error);
            }
        } else {
            console.warn(`No API key configured for default provider: ${DEFAULT_PROVIDER}`);
        }
    }

    private async getClient(provider: string, model: string): Promise<ChatOpenAI | null> {
        const cacheKey = `${provider}:${model}`;

        if (this.clients.has(cacheKey)) {
            return this.clients.get(cacheKey)!;
        }

        // Handle local providers (ollama, oprel)
        if (provider === 'ollama' || provider === 'oprel') {
            try {
                const providerConfig = PROVIDERS[provider];
                let baseUrl = providerConfig.baseUrl;

                // Normalize base URL
                baseUrl = baseUrl.replace(/\/v1$/, '');
                if (baseUrl.endsWith('/')) {
                    baseUrl = baseUrl.slice(0, -1);
                }

                // Probe for /v1 endpoint support
                let clientBase = `${baseUrl}/v1`;
                try {
                    const response = await fetch(`${baseUrl}/v1/models`, {
                        method: 'GET',
                        signal: AbortSignal.timeout(1000),
                    });
                    if (!response.ok) {
                        clientBase = baseUrl;
                    }
                } catch {
                    // If probe fails, assume /v1 is available
                    clientBase = `${baseUrl}/v1`;
                }

                const client = new ChatOpenAI({
                    modelName: model,
                    temperature: 0.2,
                    apiKey: 'local', // Local servers don't need real API key
                    configuration: {
                        baseURL: clientBase,
                    },
                });

                this.clients.set(cacheKey, client);
                return client;
            } catch (error) {
                console.error(`Error creating ${provider} client for ${model}:`, error);
                return null;
            }
        }

        // Handle cloud providers
        const providerConfig = PROVIDERS[provider];
        if (!providerConfig) {
            return null;
        }

        const apiKey = this.apiKeys.get(provider) || providerConfig.apiKey;
        if (!apiKey) {
            return null;
        }

        try {
            const client = new ChatOpenAI({
                modelName: model,
                temperature: 0.2,
                apiKey: apiKey,  // Use 'apiKey' instead of 'openAIApiKey' for compatibility
                configuration: {
                    baseURL: providerConfig.baseUrl,
                },
            });

            this.clients.set(cacheKey, client);
            return client;
        } catch (error) {
            console.error(`Error creating ${provider} client:`, error);
            return null;
        }
    }

    public async generate(
        prompt: string,
        context?: any,
        provider?: string,
        model?: string
    ): Promise<AIResponse> {
        const useProvider = provider || this.currentProvider;
        const useModel = model || this.currentModel;

        const client = await this.getClient(useProvider, useModel);
        if (!client) {
            const providerConfig = PROVIDERS[useProvider];
            if (!providerConfig) {
                throw new Error(`Unknown AI provider: ${useProvider}`);
            }
            if (!providerConfig.apiKey && !providerConfig.isLocal) {
                throw new Error(
                    `No API key configured for provider: ${useProvider}. ` +
                    `Please set the API key via /ai/models/api-key endpoint or environment variable.`
                );
            }
            throw new Error(`Failed to create AI client for ${useProvider}:${useModel}`);
        }

        // Build context string
        let contextStr = '';
        if (context?.notebookName) {
            contextStr += `Notebook: ${context.notebookName}\n\n`;
        }
        if (context?.cells && context.cells.length > 0) {
            contextStr += 'Current cells:\n';
            context.cells.forEach((cell: any, idx: number) => {
                contextStr += `Cell ${idx + 1} (${cell.type}):\n${cell.content}\n\n`;
            });
        }

        const messages = [
            new SystemMessage(SYSTEM_PROMPT),
            new HumanMessage(contextStr + prompt),
        ];

        try {
            const response = await client.invoke(messages);
            const rawText = response.content.toString();

            // Extract operations from response
            const operations = this.extractOperations(rawText);

            // Clean text by removing operations block to hide raw JSON from user
            let text = rawText.replace(/```(?:json|operations)?\s*\n([\s\S]*?)\n```/g, '').trim();

            // Also remove isolated JSON arrays if they look like operations
            // (Only if they are large multiline blocks, to avoid removing inline code examples)
            if (operations.length > 0 && text.match(/\[\s*\{[\s\S]*?\}\s*\]/)) {
                text = text.replace(/\[\s*\{[\s\S]*?\}\s*\]/g, '').trim();
            }

            return {
                text,
                operations,
                tokenInfo: {
                    prompt_tokens: (response.response_metadata as any)?.tokenUsage?.promptTokens,
                    completion_tokens: (response.response_metadata as any)?.tokenUsage?.completionTokens,
                    total_tokens: (response.response_metadata as any)?.tokenUsage?.totalTokens,
                },
            };
        } catch (error: any) {
            throw new Error(`AI generation failed: ${error.message}`);
        }
    }

    public async fixError(request: ErrorFixRequest): Promise<AIResponse> {
        const client = await this.getClient(this.currentProvider, this.currentModel);
        if (!client) {
            throw new Error(`Failed to create client for ${this.currentProvider}:${this.currentModel}`);
        }

        // Build context
        let contextStr = `Cell ${request.cellIndex} failed with error:\n${request.error}\n\nCell content:\n${request.cellContent}\n\n`;

        if (request.context?.cells) {
            contextStr += 'All cells:\n';
            request.context.cells.forEach((cell: any, idx: number) => {
                contextStr += `Cell ${idx + 1} (${cell.type}):\n${cell.content}\n\n`;
            });
        }

        const messages = [
            new SystemMessage(ERROR_FIX_PROMPT),
            new HumanMessage(contextStr),
        ];

        try {
            const response = await client.invoke(messages);
            const rawText = response.content.toString();

            // Should not find operations anymore, but we'll leave it in case of diverse model behavior
            const operations = this.extractOperations(rawText);

            // Clean text: remove markdown code blocks ticks if present
            // We expect the AI to return JUST code or code inside markdown.
            // If inside markdown, we want the content inside.
            let text = rawText.trim();
            const codeBlockMatch = text.match(/```(?:python)?\s*([\s\S]*?)```/);
            if (codeBlockMatch) {
                text = codeBlockMatch[1].trim();
            }

            return {
                text,
                operations, // Should be empty or ignored
            };
        } catch (error: any) {
            throw new Error(`Error fixing failed: ${error.message}`);
        }
    }

    private extractOperations(text: string): Array<{ type: string; params: Record<string, any> }> {
        // Try to extract JSON operations from code blocks
        const jsonBlockMatch = text.match(/```(?:json|operations)?\s*\n([\s\S]*?)\n```/);
        if (jsonBlockMatch) {
            try {
                const operations = JSON.parse(jsonBlockMatch[1]);
                if (Array.isArray(operations)) {
                    return operations;
                }
            } catch (e) {
                // Failed to parse, continue
            }
        }

        // Try to find JSON array directly
        const arrayMatch = text.match(/\[\s*\{[\s\S]*?\}\s*\]/);
        if (arrayMatch) {
            try {
                const operations = JSON.parse(arrayMatch[0]);
                if (Array.isArray(operations)) {
                    return operations;
                }
            } catch (e) {
                // Failed to parse
            }
        }

        return [];
    }

    // Model management methods
    public async getAvailableProviders(): Promise<Record<string, any>> {
        const providers: Record<string, any> = {};

        for (const [key, config] of Object.entries(PROVIDERS)) {
            let models = config.models;

            // Fetch dynamic models for local providers
            if (config.dynamic && config.isLocal) {
                try {
                    if (key === 'oprel') {
                        models = await this.fetchOprelModels(config.baseUrl);
                    } else if (key === 'ollama') {
                        models = await this.fetchOllamaModels(config.baseUrl);
                    } else {
                        models = await this.fetchLocalModels(config.baseUrl);
                    }
                } catch (error) {
                    console.error(`Failed to fetch models from ${key}:`, error);
                    models = [];
                }
            }

            providers[key] = {
                name: config.name,
                models,
                available: config.isLocal ? models.length > 0 : !!this.apiKeys.get(key),
                isLocal: config.isLocal || false,
            };
        }

        return providers;
    }

    private async fetchOprelModels(baseUrl: string): Promise<ModelInfo[]> {
        try {
            // Oprel specific endpoint
            const response = await fetch(`${baseUrl}/models`, {
                signal: AbortSignal.timeout(2000),
            });

            if (!response.ok) return [];

            const data = await response.json();

            // Handle various likely response formats
            let modelsList: any[] = [];
            if (Array.isArray(data)) {
                modelsList = data;
            } else if (data.models && Array.isArray(data.models)) {
                modelsList = data.models;
            } else if (data.data && Array.isArray(data.data)) {
                modelsList = data.data;
            }

            return modelsList.map((m: any) => ({
                id: m.id || m.name,
                name: m.name || m.id,
                context: m.context_length || m.context_window || 4096,
            }));
        } catch (error) {
            return [];
        }
    }

    private async fetchOllamaModels(baseUrl: string): Promise<ModelInfo[]> {
        // Prepare base URL, removing trailing /v1 if present
        let cleanUrl = baseUrl.replace(/\/v1$/, '');
        if (cleanUrl.endsWith('/')) cleanUrl = cleanUrl.slice(0, -1);

        return this.fetchLocalModels(cleanUrl);
    }

    private async fetchLocalModels(baseUrl: string): Promise<ModelInfo[]> {
        try {
            // Ensure we hit /v1/models
            let url = baseUrl;
            if (!url.endsWith('/v1')) {
                url = `${url}/v1`;
            }

            const response = await fetch(`${url}/models`, {
                signal: AbortSignal.timeout(2000),
            });

            if (!response.ok) {
                return [];
            }

            const data = await response.json();
            if (data.data && Array.isArray(data.data)) {
                return data.data.map((model: any) => ({
                    id: model.id,
                    name: model.id,
                    context: model.context_length || 4096,
                }));
            }

            return [];
        } catch (error) {
            return [];
        }
    }

    public setModel(provider: string, model: string): boolean {
        if (!PROVIDERS[provider]) {
            return false;
        }

        this.currentProvider = provider;
        this.currentModel = model;
        return true;
    }

    public getCurrentModel(): { provider: string; model: string } {
        return {
            provider: this.currentProvider,
            model: this.currentModel,
        };
    }

    public setApiKey(provider: string, apiKey: string): boolean {
        if (!PROVIDERS[provider]) {
            return false;
        }

        this.apiKeys.set(provider, apiKey);
        // Clear cached clients for this provider
        for (const key of this.clients.keys()) {
            if (key.startsWith(`${provider}:`)) {
                this.clients.delete(key);
            }
        }

        return true;
    }

    public toggleModelSelection(provider: string, modelId: string, selected: boolean): SelectedModel[] {
        const existing = this.selectedModels.findIndex(
            (m) => m.provider === provider && m.modelId === modelId
        );

        if (selected && existing === -1) {
            this.selectedModels.push({ provider, modelId });
        } else if (!selected && existing !== -1) {
            this.selectedModels.splice(existing, 1);
        }

        return this.selectedModels;
    }

    public getSelectedModels(): SelectedModel[] {
        return this.selectedModels;
    }
}

// Singleton instance
export const aiService = new AIService();
