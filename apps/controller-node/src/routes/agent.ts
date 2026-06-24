import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AgentRuntime } from '../core/ai-agents/agent-runtime.js';
import { KernelBridge } from '../core/ai-agents/kernel-bridge.js';
import { OctomlStore } from '../core/ai-agents/store/octoml-store.js';
import type { AgentEvent } from '../core/ai-agents/types/index.js';
import { setKernelBridge } from '../core/ai-agents/tool-registry/index.js';
import { broadcastToNotebook } from './notebookBroadcast.js';

const ModeSchema = z.enum(['ASK', 'PLAN', 'AGENT', 'AGENTIC']);

const RequestSchema = z.object({
  messages: z.array(z.object({
    role:      z.enum(['user', 'assistant', 'system']),
    content:   z.string(),
    timestamp: z.string().default(() => new Date().toISOString()),
  })),
  mode:             ModeSchema,
  project_path:     z.string().min(1),
  current_notebook: z.object({
    cells: z.array(z.object({
      id:     z.string(),
      type:   z.enum(['code', 'markdown']),
      source: z.string(),
    })),
    path: z.string().optional(),
  }),
  session_id: z.string().min(1),
});

// Shared bridge singleton per server instance
const bridge = new KernelBridge();

// Origins allowed for SSE — must mirror the cors plugin config in index.ts.
// reply.raw.writeHead() bypasses Fastify's onSend hooks (where @fastify/cors injects
// its headers), so we must add Access-Control-Allow-Origin manually here.
const SSE_ALLOWED_ORIGINS = new Set([
  'http://localhost:5000',
  'http://localhost:5001',
  'http://localhost:5173',
  'http://127.0.0.1:5000',
  'http://127.0.0.1:5173',
]);

function sseWrite(reply: FastifyReply, event: AgentEvent): void {
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/agent', async (req: FastifyRequest, reply: FastifyReply) => {
    // Validate body
    const parsed = RequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation error', details: parsed.error.issues });
    }

    const request = parsed.data;

    // Resolve the request origin for CORS (SSE bypasses Fastify's onSend hooks)
    const origin = typeof req.headers['origin'] === 'string' ? req.headers['origin'] : '';
    const acao   = SSE_ALLOWED_ORIGINS.has(origin) ? origin : [...SSE_ALLOWED_ORIGINS][0];

    // Set up SSE headers before streaming (CORS headers must be added manually here)
    reply.raw.writeHead(200, {
      'Content-Type':                     'text/event-stream',
      'Cache-Control':                    'no-cache',
      'Connection':                       'keep-alive',
      'X-Accel-Buffering':                'no',
      'Access-Control-Allow-Origin':      acao,
      'Access-Control-Allow-Credentials': 'true',
    });

    // Wire bridge singleton and connect to the session's kernel
    setKernelBridge(bridge);
    // Determine the notebook ID the browser is connected to via WebSocket.
    // The browser opens a WS at /ws/<notebookId> where notebookId is the notebook path.
    // We use current_notebook.path when available; fall back to session_id.
    const notebookBroadcastId = request.current_notebook.path ?? request.session_id;
    try {
      await bridge.connect(request.session_id);
      // Wire the broadcast function so agent cell runs update the UI identically
      // to a manual cell run (running spinner, live output, success/error state).
      bridge.setBroadcast(notebookBroadcastId, broadcastToNotebook);
    } catch {
      // Non-fatal — AGENTIC tools will surface the error when invoked
    }

    const store   = new OctomlStore(request.project_path);
    const runtime = new AgentRuntime(store);

    try {
      for await (const event of runtime.invoke(request)) {
        sseWrite(reply, event);
        if (event.type === 'done') break;
      }
    } catch (err) {
      const errorEvent: AgentEvent = {
        type:  'text_delta',
        delta: `\n[Runtime error: ${String(err)}]`,
      };
      sseWrite(reply, errorEvent);
      sseWrite(reply, { type: 'done' });
      app.log.error({ err }, '[AgentRoute] runtime error');
    }

    reply.raw.end();
  });
}
