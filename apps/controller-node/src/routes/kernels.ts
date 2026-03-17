import { FastifyInstance } from 'fastify';
import { KernelManager, KernelInfo, KernelMetrics } from '../core/KernelManager.js';
import { z } from 'zod';

const kernelManager = KernelManager.getInstance();

export async function kernelRoutes(fastify: FastifyInstance) {
    // Configure to allow empty bodies
    fastify.addContentTypeParser('application/json', { parseAs: 'string' }, function (req, body, done) {
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
            // Body is optional - default to empty object
            const body = (request.body || {}) as { notebookId?: string; pythonPath?: string };
            const id = body.notebookId || 'default';

            const info = await kernelManager.startKernel(id, body.pythonPath);
            return info;
        } catch (error: any) {
            reply.code(500).send({ detail: error?.message ?? 'Unknown error' });
        }
    });

    fastify.post('/stop', async (request, reply) => {
        try {
            const body = (request.body || {}) as { notebookId?: string };
            const id = body.notebookId || 'default';

            await kernelManager.stopKernel(id);
            return { status: 'stopped', notebookId: id };
        } catch (error: any) {
            reply.code(500).send({ detail: error?.message ?? 'Unknown error' });
        }
    });

    fastify.post('/restart', async (request, reply) => {
        try {
            const body = (request.body || {}) as { notebookId?: string };
            const id = body.notebookId || 'default';

            await kernelManager.stopKernel(id);
            const info = await kernelManager.startKernel(id);
            return info;
        } catch (error: any) {
            reply.code(500).send({ detail: error?.message ?? 'Unknown error' });
        }
    });

    fastify.get('/status', async (request, reply) => {
        const { notebookId } = request.query as { notebookId?: string };
        const id = notebookId || 'default';

        const info = kernelManager.getKernelStatus(id);
        if (!info) {
            return { status: 'disconnected', id: null, executionCount: 0 };
        }
        return info;
    });

    // List interpreters available on the host system (for selecting a specific python version)
    fastify.get('/python_versions', async (request, reply) => {
        const versions = await kernelManager.listAvailablePythonVersions();
        return { versions };
    });

    // Add this route before global metrics or anywhere appropriate
    fastify.get('/metrics/:notebookId', async (request, reply) => {
        const { notebookId } = request.params as { notebookId: string };
        const metrics = await kernelManager.getKernelMetrics(notebookId);
        if (metrics.available) {
            console.log(`[METRICS] Notebook ${notebookId} PID ${metrics.pid} | Process RAM: ${metrics.memory_mb?.toFixed(2)}MB | Sys RAM Used: ${metrics.system_memory_used_mb?.toFixed(2)}MB / ${metrics.system_memory_total_mb?.toFixed(2)}MB`);
        }
        // Always return 200 with the metrics object (which contains available: boolean)
        return metrics;
    });

    fastify.get('/metrics', async (request, reply) => {
        // Return dummy metrics for now or implement real monitoring
        const kernels = kernelManager.getAllKernels();
        return {
            kernels: kernels.reduce((acc: Record<string, any>, k: KernelInfo) => ({ ...acc, [k.id]: { status: k.status } }), {}),
            total_count: kernels.length,
            running_count: kernels.filter((k: KernelInfo) => k.status !== 'error').length
        };
    });
}
