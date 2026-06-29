import { streamText, stepCountIs } from 'ai';
import type { ModelMessage, LanguageModel, Tool } from 'ai';
import crypto from 'crypto';
import type {
  AgentRequest, AgentEvent, ChatMessage, ToolEntry, ToolExecutionContext, RuntimeCell,
} from './types/index.js';
import { buildContext } from './context-builder.js';
import { buildSystemPrompt } from './system-prompt.js';
import { checkEscalation } from './escalation.js';
import { resolveModel } from './model-router.js';
import { getPermittedTools, getKernelBridge } from './tool-registry/index.js';
import { OctomlStore } from './store/octoml-store.js';

function lastOf<T>(arr: T[], pred: (v: T) => boolean): T | undefined {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i]!)) return arr[i];
  }
  return undefined;
}

function toModelMessages(msgs: ChatMessage[]): ModelMessage[] {
  return msgs
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
}

function buildHash(systemPrompt: string, lastMsg: string, modelId: string): string {
  return crypto.createHash('sha256').update(`${systemPrompt}||${lastMsg}||${modelId}`).digest('hex');
}

function getModelId(model: LanguageModel): string {
  // LanguageModel exposes modelId in most providers; fall back to provider string
  return (model as unknown as { modelId?: string }).modelId ?? String(model);
}

type AnyTool = Tool<Record<string, unknown>, unknown>;

function buildVercelTools(entries: ToolEntry[], ctx: ToolExecutionContext): Record<string, AnyTool> {
  const result: Record<string, AnyTool> = {};
  for (const entry of entries) {
    // Cast via unknown to satisfy strict Tool<never,never> inference
    result[entry.definition.name] = {
      description: entry.definition.description,
      inputSchema: entry.definition.inputSchema,
      execute:     async (input: Record<string, unknown>) => entry.execute(input, ctx),
    } as unknown as AnyTool;
  }
  return result;
}

export class AgentRuntime {
  constructor(private readonly store: OctomlStore) {}

  async *invoke(request: AgentRequest): AsyncGenerator<AgentEvent> {
    const ctx = await buildContext(request);

    let model: LanguageModel;
    try {
      model = await resolveModel(request.project_path);
    } catch (err) {
      yield { type: 'text_delta', delta: `[Error resolving model: ${String(err)}]` };
      yield { type: 'done' };
      return;
    }

    const permittedTools = getPermittedTools(request.mode);

    const systemPrompt = buildSystemPrompt({
      mode:               request.mode,
      memory:             ctx.memory,
      activePlan:         ctx.activePlan,
      lastRun:            ctx.lastRun,
      embeddingChunks:    ctx.embeddingChunks,
      permittedToolNames: permittedTools.map(t => t.definition.name),
    });

    const lastUserMsg = lastOf(request.messages, m => m.role === 'user')?.content ?? '';
    const cacheHash   = buildHash(systemPrompt, lastUserMsg, getModelId(model));
    const cached      = await this.store.getCached(cacheHash);
    if (cached) {
      yield { type: 'text_delta', delta: cached };
      yield { type: 'done' };
      return;
    }

    const pendingEvents: AgentEvent[] = [];
    const runId = `run-${Date.now()}`;

    const mutableCtx = {
      notebookPath: request.current_notebook.path ?? null,
      cellCounter:  request.current_notebook.cells.length,
      runtimeCells: new Map<number, RuntimeCell>(),
    };

    if (mutableCtx.notebookPath) {
      const bridge = getKernelBridge();
      if (bridge) await bridge.updateBroadcastId(mutableCtx.notebookPath);
    }

    const toolCtx: ToolExecutionContext = {
      project_path:     request.project_path,
      current_notebook: request.current_notebook,
      session_id:       request.session_id,
      mode:             request.mode,
      run_id:           runId,
      emit:             evt => pendingEvents.push(evt),
      mutableCtx,
    };

    const messages = toModelMessages(request.messages);
    let fullText    = '';
    let anyOutput   = false;  // track whether the stream produced anything useful

    try {
      const stream = streamText({
        model,
        system:   systemPrompt,
        messages,
        // Double-cast: our dynamic tools can't satisfy Tool<never,never> structurally
        tools:    buildVercelTools(permittedTools, toolCtx) as unknown as Record<string, Tool<never, never>>,
        stopWhen: stepCountIs(40),
      });

      for await (const chunk of stream.fullStream) {
        if (chunk.type === 'text-delta') {
          fullText  += chunk.text;
          anyOutput  = true;
          yield { type: 'text_delta', delta: chunk.text };
        } else if (chunk.type === 'tool-call') {
          anyOutput = true;
          yield { type: 'tool_call_start', tool: chunk.toolName, input: chunk.input };
        } else if (chunk.type === 'tool-result') {
          while (pendingEvents.length > 0) yield pendingEvents.shift()!;
          const result = 'result' in chunk ? chunk.result : ('output' in chunk ? chunk.output : undefined);
          yield { type: 'tool_call_result', tool: chunk.toolName, result };
        } else if (chunk.type === 'finish') {
          while (pendingEvents.length > 0) yield pendingEvents.shift()!;
        } else if (chunk.type === 'error') {
          // Surface API errors (rate limits, provider failures) rather than silently dropping them
          anyOutput = true;
          const err = (chunk as unknown as { error: unknown }).error;
          let msg = '';
          if (err instanceof Error) {
            msg = err.message;
          } else if (typeof err === 'object' && err !== null) {
            msg = (err as any).message || JSON.stringify(err);
          } else {
            msg = String(err);
          }
          yield { type: 'text_delta', delta: `[Model error: ${msg}]` };
        }
      }

      // If the stream closed with no output, surface the finish reason so the user sees something
      if (!anyOutput) {
        try {
          const reason = await stream.finishReason;
          yield { type: 'text_delta', delta: `[No response from model (finish: ${reason ?? 'unknown'}). The API may be rate-limiting — please try again in a moment.]` };
        } catch {
          yield { type: 'text_delta', delta: '[No response from model. Please try again in a moment.]' };
        }
      }

      if (fullText) await this.store.setCache(cacheHash, fullText);
    } catch (err) {
      yield { type: 'text_delta', delta: `\n[Stream error: ${String(err)}]` };
    }

    const escalation = checkEscalation(request.mode, fullText);
    if (escalation) {
      yield { type: 'escalation', suggest_mode: escalation.suggest_mode, reason: escalation.reason };
    }

    await Promise.all([
      this.store.appendChat({ role: 'user',      content: lastUserMsg, timestamp: new Date().toISOString() }),
      this.store.appendChat({ role: 'assistant', content: fullText,    timestamp: new Date().toISOString() }),
      this.store.setState({ mode: request.mode, session_id: request.session_id }),
    ]);

    yield { type: 'done' };
  }
}
