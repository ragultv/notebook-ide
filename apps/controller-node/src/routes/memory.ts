import { FastifyInstance } from 'fastify';
import { KernelManager } from '../core/KernelManager.js';

export async function memoryRoutes(fastify: FastifyInstance) {
    fastify.get('/snapshot', async (request, reply) => {
        const { notebookId } = request.query as { notebookId: string };

        if (!notebookId) {
            return reply.status(400).send({ error: 'notebookId is required' });
        }

        try {
            const kernelManager = KernelManager.getInstance();
            const snapshot = await kernelManager.getMemorySnapshot(notebookId);
            return snapshot;
        } catch (error: any) {
            // If kernel is not running, return empty snapshot instead of error
            // to allow the UI to show the "Run a cell" message
            return {
                timestamp: Date.now() / 1000,
                variables: [],
                coordinates_2d: [],
                total_memory_bytes: 0,
                algorithm: 'umap'
            };
        }
    });
}
