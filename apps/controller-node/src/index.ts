import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import { kernelRoutes } from './routes/kernels.js';
import { executionRoutes } from './routes/execution.js';
import { filesRoutes } from './routes/files.js';
import { aiRoutes } from './routes/ai.js';
import { modelsRoutes } from './routes/models.js';
import { memoryRoutes } from './routes/memory.js';
import { config } from './config.js';
import { errorHandler } from './middleware/errorHandler.js';
import { KernelManager } from './core/KernelManager.js';
import { closeMemoryStore } from './core/ai/MemoryStore.js';

const server: FastifyInstance = fastify({
    logger: {
        level: config.logging.level,
        transport: config.logging.pretty
            ? {
                target: 'pino-pretty',
                options: {
                    translateTime: 'HH:MM:ss Z',
                    ignore: 'pid,hostname',
                },
            }
            : undefined,
    },
});

// Graceful shutdown handler
const gracefulShutdown = async () => {
    server.log.info('Shutting down gracefully...');

    // Stop all kernels
    const kernelManager = KernelManager.getInstance();
    const kernels = kernelManager.getAllKernels();
    for (const kernel of kernels) {
        try {
            await kernelManager.stopKernel(kernel.id);
        } catch (error) {
            server.log.error({ err: error, kernelId: kernel.id }, 'Failed to stop kernel');
        }
    }

    closeMemoryStore();

    await server.close();
    process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

const start = async () => {
    try {
        // Register error handler
        server.setErrorHandler(errorHandler);

        // Register plugins
        await server.register(cors, {
            // For browser clients (Vite dev server / desktop UI), reflect the Origin header.
            // Using '*' with credentials breaks streaming fetch in browsers.
            origin: true,
            credentials: config.cors.credentials,
            methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Accept'],
        });

        await server.register(websocket);
        await server.register(multipart);

        // Register routes
        await server.register(kernelRoutes, { prefix: '/kernels' });
        await server.register(executionRoutes, { prefix: '/execution' });
        await server.register(filesRoutes, { prefix: '/files' });
        await server.register(aiRoutes, { prefix: '/ai' });
        await server.register(modelsRoutes, { prefix: '/ai/models' });
        await server.register(memoryRoutes, { prefix: '/api/memory' });

        // Health check route
        server.get('/', async () => {
            return {
                status: 'ok',
                service: 'controller-node',
                version: '1.0.0',
                env: config.env,
            };
        });

        // Ready check
        server.get('/health', async () => {
            return {
                status: 'healthy',
                uptime: process.uptime(),
                timestamp: new Date().toISOString(),
            };
        });

        await server.listen({ port: config.port, host: config.host });
        server.log.info(`Server listening at http://${config.host}:${config.port}`);
        server.log.info(`Environment: ${config.env}`);
    } catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};

start();
