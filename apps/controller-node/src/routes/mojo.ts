import { FastifyInstance } from 'fastify';
import { MojoManager } from '../core/MojoManager.js';

const mojoManager = MojoManager.getInstance();

export async function mojoRoutes(fastify: FastifyInstance) {
  fastify.post('/start', async (request, reply) => {
    try {
      const body = (request.body || {}) as { notebookId?: string; workspaceDir?: string };
      const notebookId = body.notebookId || 'default';
      // Workspace directory must exist on the host and be mounted into the container.
      // If not provided, fallback to current process cwd.
      const workspaceDir = body.workspaceDir || process.cwd();

      await mojoManager.startNotebook(notebookId, workspaceDir);
      return { status: 'started', notebookId };
    } catch (error: any) {
      console.error('[MOJO START ERROR]', error);
      reply.code(500).send({
        error: error?.message ?? 'Unknown error',
        stack: error?.stack,
      });
    }
  });

  fastify.post('/stop', async (request, reply) => {
    try {
      const body = (request.body || {}) as { notebookId?: string };
      const notebookId = body.notebookId || 'default';
      await mojoManager.stopNotebook(notebookId);
      return { status: 'stopped', notebookId };
    } catch (error: any) {
      reply.code(500).send({ error: error.message });
    }
  });

  fastify.post('/run', async (request, reply) => {
    try {
      const body = (request.body || {}) as { notebookId?: string; code: string };
      const notebookId = body.notebookId || 'default';
      const code = body.code || '';

      // Ensure the container is started (and if needed, recreated in CPU-only mode)
      await mojoManager.startNotebook(notebookId, process.cwd());

      const result = await mojoManager.runCell(notebookId, code);
      return result;
    } catch (error: any) {
      console.error('[MOJO RUN ERROR]', error);
      reply.code(500).send({
        error: error?.message ?? 'Unknown error',
        stack: error?.stack,
      });
    }
  });
}
