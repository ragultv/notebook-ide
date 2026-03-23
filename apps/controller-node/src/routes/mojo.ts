import { FastifyInstance } from 'fastify';
import { MojoManager } from '../core/MojoManager.js';
import { projectStore } from '../core/ProjectStore.js';

const mojoManager = MojoManager.getInstance();

function resolveWorkspaceDir(explicitWorkspaceDir?: string): string {
  return explicitWorkspaceDir || projectStore.getCurrentProject()?.path || process.cwd();
}

export async function mojoRoutes(fastify: FastifyInstance) {
  fastify.post('/start', async (request, reply) => {
    try {
      const body = (request.body || {}) as { notebookId?: string; workspaceDir?: string };
      const notebookId = body.notebookId || 'default';
      const workspaceDir = resolveWorkspaceDir(body.workspaceDir);

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

      await mojoManager.startNotebook(notebookId, resolveWorkspaceDir());

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
