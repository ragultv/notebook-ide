import { FastifyInstance } from 'fastify';
import { KernelManager, KernelInfo } from '../core/KernelManager.js';

const kernelManager = KernelManager.getInstance();

export async function kernelRoutes(fastify: FastifyInstance) {
    // Allow empty JSON bodies — required for POST routes with optional bodies.
    fastify.addContentTypeParser('application/json', { parseAs: 'string' }, function (_req, body, done) {
        try {
            const json = body === '' ? {} : JSON.parse(body as string);
            done(null, json);
        } catch (err: any) {
            err.statusCode = 400;
            done(err, undefined);
        }
    });

    fastify.post('/start', async (request, reply) => {
        try {
            const body = (request.body || {}) as { notebookId?: string };
            const id   = body.notebookId || 'default';
            const info = await kernelManager.startKernel(id);
            return info;
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });

    fastify.post('/stop', async (request, reply) => {
        try {
            const body = (request.body || {}) as { notebookId?: string };
            const id   = body.notebookId || 'default';
            await kernelManager.stopKernel(id);
            return { status: 'stopped', notebookId: id };
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });

    fastify.post('/restart', async (request, reply) => {
        try {
            const body = (request.body || {}) as { notebookId?: string };
            const id   = body.notebookId || 'default';
            await kernelManager.stopKernel(id);
            const info = await kernelManager.startKernel(id);
            return info;
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });

    fastify.get('/status', async (request) => {
        const { notebookId } = request.query as { notebookId?: string };
        const id   = notebookId || 'default';
        const info = kernelManager.getKernelStatus(id);
        if (!info) {
            return { status: 'disconnected', id: null, executionCount: 0 };
        }
        return info;
    });

    fastify.get('/metrics/:notebookId', async (request) => {
        const { notebookId } = request.params as { notebookId: string };
        const metrics        = await kernelManager.getKernelMetrics(notebookId);
        if (metrics.available) {
            console.log(
                `[METRICS] Notebook ${notebookId} | ` +
                `Sys RAM: ${metrics.system_memory_used_mb?.toFixed(2)}MB / ${metrics.system_memory_total_mb?.toFixed(2)}MB`
            );
        }
        return metrics;
    });

    fastify.get('/metrics', async () => {
        const kernels = kernelManager.getAllKernels();
        return {
            kernels: kernels.reduce(
                (acc: Record<string, unknown>, k: KernelInfo) => ({ ...acc, [k.id]: { status: k.status } }),
                {}
            ),
            total_count:   kernels.length,
            running_count: kernels.filter((k: KernelInfo) => k.status !== 'error').length,
        };
    });
}
