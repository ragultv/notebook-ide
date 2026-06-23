import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  createSession, updateSession, listSessions,
  getSession, deleteSession, addMessages, getMessages,
} from '../db/chat-db.js';

const CreateSchema = z.object({
  project_path: z.string().min(1),
  mode:         z.enum(['ASK', 'PLAN', 'AGENT', 'AGENTIC']).default('ASK'),
  title:        z.string().optional(),
});

const SaveMessagesSchema = z.object({
  messages: z.array(z.object({
    role:       z.enum(['user', 'assistant']),
    content:    z.string(),
    tool_calls: z.array(z.object({
      tool:   z.string(),
      input:  z.unknown(),
      result: z.unknown(),
    })).optional(),
    attachments: z.array(z.object({
      name:    z.string(),
      content: z.string(),
    })).optional(),
  })).min(1),
  mode:  z.enum(['ASK', 'PLAN', 'AGENT', 'AGENTIC']).optional(),
  title: z.string().optional(),
});

export async function chatSessionRoutes(app: FastifyInstance): Promise<void> {

  // List sessions for a project
  app.get('/api/chat/sessions', async (req: FastifyRequest, reply: FastifyReply) => {
    const { project_path } = req.query as Record<string, string>;
    if (!project_path) return reply.status(400).send({ error: 'project_path required' });
    return { sessions: listSessions(project_path) };
  });

  // Create a new session
  app.post('/api/chat/sessions', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });
    const { project_path, mode, title } = parsed.data;
    return { session: createSession(project_path, mode, title) };
  });

  // Get session + messages
  app.get('/api/chat/sessions/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const session = getSession(id);
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    return { session, messages: getMessages(id) };
  });

  // Batch-save messages + optionally update title/mode
  app.post('/api/chat/sessions/:id/messages', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    if (!getSession(id)) return reply.status(404).send({ error: 'Session not found' });

    const parsed = SaveMessagesSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues });

    const { messages, mode, title } = parsed.data;
    addMessages(id, messages);
    if (mode || title) updateSession(id, { mode, title });

    return { saved: messages.length };
  });

  // Delete a session
  app.delete('/api/chat/sessions/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    if (!getSession(id)) return reply.status(404).send({ error: 'Session not found' });
    deleteSession(id);
    return { deleted: true };
  });
}
