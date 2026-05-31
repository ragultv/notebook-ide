import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { PROVIDERS, DEFAULT_PROVIDER, DEFAULT_MODEL, ModelInfo } from './providers.js';
import { SYSTEM_PROMPT, ERROR_FIX_PROMPT, getSystemPrompt, AIMode } from './prompts.js';
import { getOrCreateSession, appendMessage, getRecentMessages } from './MemoryStore.js';
import { retrieve, formatRetrievedContext, indexChunks } from './RAGService.js';
import { validateOperations } from './operationsSchema.js';
import { config } from '../../config.js';

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
    sessionId?: string;
}

export interface SelectedModel {
    provider: string;
    modelId: string;
}

export interface GenerateStreamCallbacks {
    onChunk: (delta: string) => void;
    onOperations?: (operations: Array<{ type: string; params: Record<string, any> }>) => void;
    onPlanReady?: (operations: Array<{ type: string; params: Record<string, any> }>) => void;
    onDone: (payload: { sessionId: string; tokenInfo?: AIResponse['tokenInfo'] }) => void;
    onError: (message: string) => void;
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

        // Handle local providers (ollama, octopod)
        if (provider === 'ollama' || provider === 'octopod') {
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
        model?: string,
        sessionId?: string | null,
        mode?: AIMode
    ): Promise<AIResponse> {
        const useProvider = provider || this.currentProvider;
        const useModel = model || this.currentModel;
        const useMode: AIMode = mode ?? 'agent';

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

        const resolvedSessionId = getOrCreateSession(sessionId, context?.notebookName);

        const history = getRecentMessages(resolvedSessionId, {
            limit: 20,
            maxTokens: this.getModelContextReserve(useProvider, useModel),
        });

        let ragContext = '';
        try {
            const chunks = await retrieve(resolvedSessionId, prompt, { topK: 20, afterRerank: 8 });
            ragContext = formatRetrievedContext(chunks);
        } catch (e) {
            // RAG optional: continue without retrieved context
        }

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

        const systemContentBase =
            (ragContext ? ragContext + '\n' : '') +
            (useMode ? getSystemPrompt(useMode) : SYSTEM_PROMPT);

        const maxPasses = Math.max(1, config.continuation.maxPasses || 1);
        const modelContext = this.getModelContextSize(useProvider, useModel);
        const perPassTokens = Math.min(
            config.continuation.perPassTokens || 1536,
            Math.floor(modelContext * 0.35)
        );
        const boundedClient = perPassTokens > 0 ? (client as any).bind?.({ maxTokens: perPassTokens }) ?? client : client;

        let fullRawText = '';
        const allOps: Array<{ type: string; params: Record<string, any> }> = [];
        let aggregatedTokenInfo: AIResponse['tokenInfo'] | undefined;

        for (let pass = 0; pass < maxPasses; pass++) {
            const isFirstPass = pass === 0;

            const systemContent = systemContentBase;
            const parts: (HumanMessage | AIMessage | SystemMessage)[] = [
                new SystemMessage(systemContent),
                ...history.map((m) =>
                    m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
                ),
            ];

            if (isFirstPass) {
                parts.push(new HumanMessage(contextStr + prompt));
            } else {
                const tail = fullRawText.slice(-4000);
                if (tail) {
                    parts.push(new AIMessage(tail));
                }
                parts.push(
                    new HumanMessage(
                        'Continue exactly from where you stopped above. Do not repeat any previous content. If you were in the middle of a list or code block, resume it.'
                    )
                );
            }

            let response;
            try {
                response = await boundedClient.invoke(parts);
            } catch (error: any) {
                if (isFirstPass) {
                    throw new Error(`AI generation failed: ${error.message}`);
                }
                break;
            }

            const rawText = response.content.toString();
            fullRawText += rawText;

            let segmentOps: Array<{ type: string; params: Record<string, any> }> = [];
            if (useMode !== 'ask') {
                let operations = this.extractOperations(rawText);
                operations = this.normalizeRawOperations(operations);
                const validated = validateOperations(operations);
                if (validated.success && validated.data.length > 0) {
                    segmentOps = validated.data.map((op) => ({ type: op.type, params: op.params }));
                    allOps.push(...segmentOps);
                }
            }

            const meta = (response.response_metadata as any) ?? {};
            const usage = meta.tokenUsage ?? meta.usage;
            if (usage) {
                const current = {
                    prompt_tokens: usage.promptTokens ?? usage.prompt_tokens,
                    completion_tokens: usage.completionTokens ?? usage.completion_tokens,
                    total_tokens: usage.totalTokens ?? usage.total_tokens,
                };
                if (!aggregatedTokenInfo) {
                    aggregatedTokenInfo = { ...current };
                } else {
                    aggregatedTokenInfo.prompt_tokens =
                        (aggregatedTokenInfo.prompt_tokens || 0) + (current.prompt_tokens || 0);
                    aggregatedTokenInfo.completion_tokens =
                        (aggregatedTokenInfo.completion_tokens || 0) + (current.completion_tokens || 0);
                    aggregatedTokenInfo.total_tokens =
                        (aggregatedTokenInfo.total_tokens || 0) + (current.total_tokens || 0);
                }
            }

            const truncated = this.isLikelyTruncated(
                rawText,
                meta as Record<string, unknown>,
                modelContext,
                perPassTokens
            );

            if (!truncated) {
                break;
            }
            console.info(
                `[AIService.generate] continuation pass ${pass + 1} for provider=${useProvider}, model=${useModel}, session=${resolvedSessionId}`
            );
        }

        // Final scan of fullRawText to catch any operations that might span multiple passes
        if (useMode !== 'ask') {
            const finalOps = this.extractOperations(fullRawText);
            const normalizedFinalOps = this.normalizeRawOperations(finalOps);
            const validatedFinalOps = validateOperations(normalizedFinalOps);
            if (validatedFinalOps.success && validatedFinalOps.data.length > 0) {
                const newOps = validatedFinalOps.data
                    .map((op) => ({ type: op.type, params: op.params }))
                    .filter((op) => {
                        // Avoid duplicates: check if this operation is already in allOps
                        return !allOps.some((existing) => {
                            if (existing.type !== op.type) return false;
                            return JSON.stringify(existing.params) === JSON.stringify(op.params);
                        });
                    });
                allOps.push(...newOps);
            }
        }

        let text = fullRawText.replace(/```(?:json|operations)?\s*\n([\s\S]*?)\n```/g, '').trim();
        if (allOps.length > 0 && text.match(/\[\s*\{[\s\S]*?\}\s*\]/)) {
            text = text.replace(/\[\s*\{[\s\S]*?\}\s*\]/g, '').trim();
        }

        appendMessage(resolvedSessionId, 'user', contextStr + prompt);
        appendMessage(resolvedSessionId, 'assistant', fullRawText);

        try {
            await indexChunks(resolvedSessionId, 'message', contextStr + prompt, { embed: true });
            await indexChunks(resolvedSessionId, 'message', fullRawText, { embed: true });
        } catch (_) {
            // Indexing optional
        }

        return {
            text,
            operations: useMode === 'ask' ? [] : allOps,
            tokenInfo: aggregatedTokenInfo,
            sessionId: resolvedSessionId,
        };
    }

    /**
     * Stream the assistant response and emit chunks + operations when a complete operations block is detected.
     */
    public async generateStream(
        prompt: string,
        context: any,
        provider: string | undefined,
        model: string | undefined,
        sessionId: string | null | undefined,
        callbacks: GenerateStreamCallbacks,
        mode?: AIMode
    ): Promise<void> {
        const useProvider = provider || this.currentProvider;
        const useModel = model || this.currentModel;
        const useMode: AIMode = mode ?? 'agent';

        const client = await this.getClient(useProvider, useModel);
        if (!client) {
            const providerConfig = PROVIDERS[useProvider];
            if (!providerConfig) {
                callbacks.onError(`Unknown AI provider: ${useProvider}`);
                return;
            }
            if (!providerConfig.apiKey && !providerConfig.isLocal) {
                callbacks.onError(`No API key configured for provider: ${useProvider}`);
                return;
            }
            callbacks.onError(`Failed to create AI client for ${useProvider}:${useModel}`);
            return;
        }

        const resolvedSessionId = getOrCreateSession(sessionId, context?.notebookName);
        const history = getRecentMessages(resolvedSessionId, {
            limit: 20,
            maxTokens: this.getModelContextReserve(useProvider, useModel),
        });

        let ragContext = '';
        try {
            const chunks = await retrieve(resolvedSessionId, prompt, { topK: 20, afterRerank: 8 });
            ragContext = formatRetrievedContext(chunks);
        } catch (_) {}

        let contextStr = '';
        if (context?.notebookName) contextStr += `Notebook: ${context.notebookName}\n\n`;
        if (context?.cells?.length) {
            contextStr += 'Current cells:\n';
            context.cells.forEach((cell: any, idx: number) => {
                contextStr += `Cell ${idx + 1} (${cell.type}):\n${cell.content}\n\n`;
            });
        }

        const systemContentBase =
            (ragContext ? ragContext + '\n' : '') +
            (useMode ? getSystemPrompt(useMode) : SYSTEM_PROMPT);

        const maxPasses = Math.max(1, config.continuation.maxPasses || 1);
        const modelContext = this.getModelContextSize(useProvider, useModel);
        const perPassTokens = Math.min(
            config.continuation.perPassTokens || 1536,
            Math.floor(modelContext * 0.35)
        );
        const boundedClient = perPassTokens > 0 ? (client as any).bind?.({ maxTokens: perPassTokens }) ?? client : client;

        let globalBuffer = '';
        let lastEmittedOpsEndIndex = -1; // Position in globalBuffer
        let tokenInfo: AIResponse['tokenInfo'] | undefined;
        let truncated = false;
        const emittedOpsSignatures = new Set<string>(); // Track emitted operations to avoid duplicates

        // Helper to detect and emit operations from accumulated buffer
        const detectAndEmitOperations = (text: string, startOffset: number = 0, currentPass: number = 0) => {
            if (useMode === 'ask') return;
            
            // Try to extract JSON array from various formats
            const extractJsonArray = (matchText: string): string | null => {
                // Format 1: Code block with ```json or ```operations
                const codeBlockMatch = matchText.match(/```(?:json|operations)?\s*\n([\s\S]*?)\n```/);
                if (codeBlockMatch) {
                    return codeBlockMatch[1].trim();
                }
                
                // Format 2: "operations": [ ... ]
                const inlineMatch = matchText.match(/"operations"\s*:\s*(\[[\s\S]*?\])/);
                if (inlineMatch) {
                    return inlineMatch[1].trim();
                }
                
                // Format 3: operations": [ ... ] (without quotes)
                const unquotedMatch = matchText.match(/operations"\s*:\s*(\[[\s\S]*?\])/);
                if (unquotedMatch) {
                    return unquotedMatch[1].trim();
                }
                
                // Format 4: Just a JSON array [ ... ]
                const arrayMatch = matchText.match(/(\[[\s\S]*?\])/);
                if (arrayMatch) {
                    const candidate = arrayMatch[1].trim();
                    // Check if it looks like an operations array (has "type" and "params")
                    if (candidate.includes('"type"') && candidate.includes('"params"')) {
                        return candidate;
                    }
                }
                
                return null;
            };
            
            // Pattern 1: Code blocks
            const codeBlockRegex = /```(?:json|operations)?\s*\n[\s\S]*?\n```/g;
            let match;
            let foundBlocks = 0;
            const processedRanges: Array<{ start: number; end: number }> = [];
            
            // First, try code blocks
            while ((match = codeBlockRegex.exec(text)) !== null) {
                foundBlocks++;
                const blockStartInText = match.index;
                const blockEndInText = match.index + match[0].length;
                const blockStartInGlobal = startOffset + blockStartInText;
                const blockEndInGlobal = startOffset + blockEndInText;
                
                processedRanges.push({ start: blockStartInGlobal, end: blockEndInGlobal });
                
                console.log(`[AIService.generateStream] Found code block at global pos ${blockStartInGlobal}-${blockEndInGlobal}, lastEmitted=${lastEmittedOpsEndIndex}`);
                
                if (blockEndInGlobal > lastEmittedOpsEndIndex) {
                    const jsonStr = extractJsonArray(match[0]);
                    if (jsonStr) {
                        try {
                            const parsed = JSON.parse(jsonStr);
                            console.log(`[AIService.generateStream] Parsed JSON: ${Array.isArray(parsed) ? `${parsed.length} operations` : 'not an array'}`);
                            if (Array.isArray(parsed)) {
                                const operations = this.normalizeRawOperations(parsed);
                                const validated = validateOperations(operations);
                                console.log(`[AIService.generateStream] Validation result: ${validated.success ? 'success' : 'failed'}, ${validated.success ? validated.data.length : 0} valid operations`);
                                if (validated.success && validated.data.length > 0) {
                                    const ops = validated.data
                                        .map((op) => ({
                                            type: op.type,
                                            params: op.params,
                                        }))
                                        .filter((op) => {
                                            // Deduplicate: create signature from type + params
                                            const sig = `${op.type}:${JSON.stringify(op.params)}`;
                                            const isDuplicate = emittedOpsSignatures.has(sig);
                                            if (!isDuplicate) {
                                                emittedOpsSignatures.add(sig);
                                            }
                                            return !isDuplicate;
                                        });
                                    
                                    console.log(`[AIService.generateStream] After deduplication: ${ops.length} operations (from ${validated.data.length} total)`);
                                    
                                    if (ops.length > 0) {
                                        console.log(`[AIService.generateStream] Emitting ${ops.length} operations (mode=${useMode}, pass=${currentPass + 1})`, ops.map(op => `${op.type}(${JSON.stringify(op.params).slice(0, 50)}...)`));
                                        if (useMode === 'plan') {
                                            if (callbacks.onPlanReady) {
                                                callbacks.onPlanReady(ops);
                                            }
                                        } else if (callbacks.onOperations) {
                                            callbacks.onOperations(ops);
                                        }
                                        lastEmittedOpsEndIndex = blockEndInGlobal;
                                        console.log(`[AIService.generateStream] Updated lastEmittedOpsEndIndex to ${lastEmittedOpsEndIndex}`);
                                    } else {
                                        console.log(`[AIService.generateStream] All operations filtered out as duplicates (mode=${useMode}, pass=${currentPass + 1})`);
                                    }
                                } else if (!validated.success) {
                                    console.log(`[AIService.generateStream] Validation failed:`, validated.errors);
                                }
                            }
                        } catch (parseErr: any) {
                            console.log(`[AIService.generateStream] JSON parse error:`, parseErr.message, `\nTrying to extract JSON from:`, jsonStr.slice(0, 200));
                        }
                    }
                } else {
                    console.log(`[AIService.generateStream] Skipping block - already emitted (blockEnd=${blockEndInGlobal} <= lastEmitted=${lastEmittedOpsEndIndex})`);
                }
            }
            
            // Pattern 2: Inline "operations": [ ... ] format (not in code blocks)
            // Find all occurrences of "operations": [ or operations": [
            const inlinePattern = /"?operations"?\s*:\s*\[/g;
            let inlineMatch;
            while ((inlineMatch = inlinePattern.exec(text)) !== null) {
                const arrayStartPos = inlineMatch.index + inlineMatch[0].length - 1; // Position of '['
                const blockStartInGlobal = startOffset + inlineMatch.index;
                
                // Skip if this range was already processed as a code block
                const alreadyProcessed = processedRanges.some(r => 
                    blockStartInGlobal >= r.start && blockStartInGlobal <= r.end
                );
                if (alreadyProcessed) continue;
                
                // Find the matching closing bracket by counting brackets
                let bracketCount = 0;
                let arrayEndPos = arrayStartPos;
                let foundEnd = false;
                
                for (let i = arrayStartPos; i < text.length; i++) {
                    if (text[i] === '[') bracketCount++;
                    if (text[i] === ']') bracketCount--;
                    if (bracketCount === 0) {
                        arrayEndPos = i;
                        foundEnd = true;
                        break;
                    }
                }
                
                if (!foundEnd) {
                    console.log(`[AIService.generateStream] Could not find closing bracket for inline operations array starting at ${blockStartInGlobal}`);
                    continue;
                }
                
                const blockEndInGlobal = startOffset + arrayEndPos + 1;
                
                console.log(`[AIService.generateStream] Found inline operations at global pos ${blockStartInGlobal}-${blockEndInGlobal}, lastEmitted=${lastEmittedOpsEndIndex}`);
                
                if (blockEndInGlobal > lastEmittedOpsEndIndex) {
                    try {
                        // Extract the JSON array (from the opening '[' to the closing ']')
                        const jsonStr = text.slice(arrayStartPos, arrayEndPos + 1);
                        
                        const parsed = JSON.parse(jsonStr);
                        console.log(`[AIService.generateStream] Parsed inline JSON: ${Array.isArray(parsed) ? `${parsed.length} operations` : 'not an array'}`);
                        if (Array.isArray(parsed)) {
                            const operations = this.normalizeRawOperations(parsed);
                            const validated = validateOperations(operations);
                            console.log(`[AIService.generateStream] Validation result: ${validated.success ? 'success' : 'failed'}, ${validated.success ? validated.data.length : 0} valid operations`);
                            if (validated.success && validated.data.length > 0) {
                                const ops = validated.data
                                    .map((op) => ({
                                        type: op.type,
                                        params: op.params,
                                    }))
                                    .filter((op) => {
                                        const sig = `${op.type}:${JSON.stringify(op.params)}`;
                                        const isDuplicate = emittedOpsSignatures.has(sig);
                                        if (!isDuplicate) {
                                            emittedOpsSignatures.add(sig);
                                        }
                                        return !isDuplicate;
                                    });
                                
                                if (ops.length > 0) {
                                    console.log(`[AIService.generateStream] Emitting ${ops.length} inline operations (mode=${useMode}, pass=${currentPass + 1})`);
                                    if (useMode === 'plan') {
                                        if (callbacks.onPlanReady) {
                                            callbacks.onPlanReady(ops);
                                        }
                                    } else if (callbacks.onOperations) {
                                        callbacks.onOperations(ops);
                                    }
                                    lastEmittedOpsEndIndex = blockEndInGlobal;
                                }
                            }
                        }
                    } catch (parseErr: any) {
                        console.log(`[AIService.generateStream] Inline JSON parse error:`, parseErr.message);
                    }
                }
            }
        };

        for (let pass = 0; pass < maxPasses; pass++) {
            const isFirstPass = pass === 0;
            const globalBufferStartLength = globalBuffer.length;

            if (!isFirstPass && truncated) {
                callbacks.onChunk('\n\n*(continuing...)*\n\n');
            }

            const parts: (HumanMessage | AIMessage | SystemMessage)[] = [
                new SystemMessage(systemContentBase),
                ...history.map((m) =>
                    m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
                ),
            ];

            if (isFirstPass) {
                parts.push(new HumanMessage(contextStr + prompt));
            } else {
                const tail = globalBuffer.slice(-4000);
                if (tail) {
                    parts.push(new AIMessage(tail));
                }
                parts.push(
                    new HumanMessage(
                        'Continue exactly from where you stopped above. Do not repeat any previous content. If you were in the middle of a list or code block, resume it.'
                    )
                );
            }

            let buffer = '';
            let lastChunk: any;

            try {
                const stream = await boundedClient.stream(parts);
                for await (const chunk of stream) {
                    lastChunk = chunk;
                    const content = chunk.content;
                    const delta =
                        typeof content === 'string'
                            ? content
                            : Array.isArray(content)
                            ? (content as any[])
                                  .map((c) =>
                                      typeof c === 'string' ? c : (c as any)?.text ?? ''
                                  )
                                  .join('')
                            : String(content ?? '');
                    if (!delta) continue;
                    buffer += delta;
                    globalBuffer += delta;
                    callbacks.onChunk(delta);

                    // Detect operations in the current pass's buffer (for immediate emission)
                    // Calculate position in globalBuffer: where this buffer starts + position in buffer
                    detectAndEmitOperations(buffer, globalBufferStartLength, pass);
                }

                // After pass completes, scan globalBuffer from lastEmittedOpsEndIndex to catch any missed blocks
                if (globalBuffer.length > lastEmittedOpsEndIndex) {
                    const remainingText = globalBuffer.slice(lastEmittedOpsEndIndex);
                    detectAndEmitOperations(remainingText, lastEmittedOpsEndIndex, pass);
                }

                const usage =
                    lastChunk?.response_metadata?.tokenUsage ?? lastChunk?.usage;
                if (usage) {
                    const current = {
                        prompt_tokens: usage.promptTokens ?? usage.prompt_tokens,
                        completion_tokens:
                            usage.completionTokens ?? usage.completion_tokens,
                        total_tokens: usage.totalTokens ?? usage.total_tokens,
                    };
                    if (!tokenInfo) {
                        tokenInfo = { ...current };
                    } else {
                        tokenInfo.prompt_tokens =
                            (tokenInfo.prompt_tokens || 0) +
                            (current.prompt_tokens || 0);
                        tokenInfo.completion_tokens =
                            (tokenInfo.completion_tokens || 0) +
                            (current.completion_tokens || 0);
                        tokenInfo.total_tokens =
                            (tokenInfo.total_tokens || 0) +
                            (current.total_tokens || 0);
                    }
                }

                const meta = (lastChunk?.response_metadata ?? {}) as Record<string, unknown>;
                truncated = this.isLikelyTruncated(
                    buffer,
                    meta,
                    modelContext,
                    perPassTokens
                );

                if (!truncated) {
                    break;
                }
                console.info(
                    `[AIService.generateStream] continuation pass ${pass + 1} for provider=${useProvider}, model=${useModel}, session=${resolvedSessionId}`
                );
            } catch (err: any) {
                if (isFirstPass) {
                    callbacks.onError(err?.message ?? 'Stream failed');
                    return;
                }
                break;
            }
        }

        // Final scan of entire globalBuffer to catch any operations we might have missed
        if (useMode !== 'ask' && globalBuffer.length > lastEmittedOpsEndIndex) {
            const remainingText = globalBuffer.slice(lastEmittedOpsEndIndex);
            detectAndEmitOperations(remainingText, lastEmittedOpsEndIndex, maxPasses - 1);
        }

        appendMessage(resolvedSessionId, 'user', contextStr + prompt);
        appendMessage(resolvedSessionId, 'assistant', globalBuffer);
        try {
            await indexChunks(resolvedSessionId, 'message', contextStr + prompt, {
                embed: true,
            });
            await indexChunks(resolvedSessionId, 'message', globalBuffer, { embed: true });
        } catch (_) {}

        callbacks.onDone({ sessionId: resolvedSessionId, tokenInfo });
    }

    private getModelContextReserve(provider: string, model: string): number {
        const providerConfig = PROVIDERS[provider];
        if (!providerConfig?.models?.length) return 4096;
        const info = providerConfig.models.find((m) => m.id === model);
        const context = info?.context ?? 4096;
        return Math.floor(context * 0.4);
    }

    private getModelContextSize(provider: string, model: string): number {
        const providerConfig = PROVIDERS[provider];
        if (!providerConfig?.models?.length) return 8192;
        const info = providerConfig.models.find((m) => m.id === model);
        return info?.context ?? 8192;
    }

    /** Detect if response was likely truncated (context limit, max_tokens, or abrupt cut). */
    private isLikelyTruncated(
        text: string,
        meta: Record<string, unknown>,
        _modelContextSize: number,
        perPassTokens: number
    ): boolean {
        const finishReason =
            (meta.finish_reason as string) ??
            (meta.finishReason as string) ??
            (meta.finish_reasons as string);
        if (finishReason === 'length' || finishReason === 'max_tokens' || finishReason === 'context_length_exceeded') {
            return true;
        }
        const usage = (meta.tokenUsage as any) ?? meta.usage;
        const completionTokens = usage?.completionTokens ?? usage?.completion_tokens;
        if (typeof completionTokens === 'number' && completionTokens >= perPassTokens * 0.9) {
            return true;
        }
        if (text.length < 80) return false;
        const trimmed = text.trimEnd();
        if ((trimmed.match(/```/g) || []).length % 2 !== 0) return true;
        const last80 = trimmed.slice(-80);
        if (!/[.!?]\s*$/.test(trimmed) && !/\n\n/.test(last80) && trimmed.length > 400) {
            return true;
        }
        return false;
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

    private normalizeRawOperations(ops: Array<{ type?: string; params?: Record<string, any> }>): Array<{ type: string; params: Record<string, any> }> {
        // Helper to convert escape sequences in strings to actual characters
        // When JSON.parse processes a JSON string like "line1\\nline2", it correctly
        // converts \\n to \n (a string containing backslash-n). We need to convert
        // that literal backslash-n to an actual newline character.
        const unescapeString = (str: string): string => {
            if (typeof str !== 'string') return str;
            // Simple approach: replace literal \n, \t, \r with actual characters
            // This handles the common case where JSON.parse gave us literal escape sequences
            return str
                .replace(/\\n/g, '\n')      // \n -> newline
                .replace(/\\t/g, '\t')      // \t -> tab
                .replace(/\\r/g, '\r')      // \r -> carriage return
                .replace(/\\\\/g, '\\');    // \\ -> single backslash (handle escaped backslashes last)
        };

        return ops.filter((o) => o && typeof o.type === 'string' && o.params && typeof o.params === 'object').map((o) => {
            const type = String(o.type).toLowerCase().trim();
            const params = { ...o.params } as Record<string, any>;
            if (type === 'add_cell' || type === 'edit_cell') {
                if (params.type !== undefined) params.type = String(params.type).toLowerCase().trim() === 'markdown' ? 'markdown' : 'code';
                if (params.content !== undefined) {
                    // Convert escape sequences in content to actual characters
                    params.content = unescapeString(String(params.content));
                } else {
                    params.content = '';
                }
            }
            if (type === 'edit_cell' || type === 'delete_cell') {
                if (params.cellIndex !== undefined) params.cellIndex = Number(params.cellIndex);
            }
            if (type === 'create_notebook' && params.name !== undefined) params.name = String(params.name).trim();
            if (type === 'add_package' && !Array.isArray(params.packages)) params.packages = params.packages != null ? [String(params.packages)] : [];
            return { type, params };
        });
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
                    if (key === 'octopod') {
                        models = await this.fetchOctopodModels(config.baseUrl);
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

    private async fetchOctopodModels(baseUrl: string): Promise<ModelInfo[]> {
        try {
            // Octopod specific endpoint
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
