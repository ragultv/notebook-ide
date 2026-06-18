import { FastifyInstance } from 'fastify';
import { KernelManager } from '../core/KernelManager.js';

const kernelManager = KernelManager.getInstance();

export async function executionRoutes(fastify: FastifyInstance) {
    fastify.post('/input', async (request, reply) => {
        try {
            const { notebookId, value } = request.body as {
                notebookId: string; value: string;
            };
            const id = notebookId || 'default';
            // Send terminal input
            await kernelManager.sendStdin(id, '', value);
            return { success: true };
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });

    fastify.post('/resize', async (request, reply) => {
        try {
            const { notebookId, cols, rows } = request.body as {
                notebookId: string; cols: number; rows: number;
            };
            const id = notebookId || 'default';
            kernelManager.resizeTerminal(id, cols, rows);
            return { success: true };
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });

    fastify.post('/complete', async (request, reply) => {
        try {
            const { code, cursorPos, notebookId, contextCode } = request.body as {
                code: string; cursorPos: number; notebookId: string; contextCode?: string;
            };
            const id          = notebookId || 'default';
            const completions = await kernelManager.getCompletions(id, code, cursorPos, contextCode);
            return { completions };
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });
}
