import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { kernelRoutes } from './routes/kernels.js';
import { executionRoutes } from './routes/execution.js';
import { filesRoutes } from './routes/files.js';
import { aiRoutes } from './routes/ai.js';
import { modelsRoutes } from './routes/models.js';
import { memoryRoutes } from './routes/memory.js';
import { websocketRoutes } from './routes/websocket.js';
import { config } from './config.js';
import { errorHandler } from './middleware/errorHandler.js';
import { KernelManager } from './core/KernelManager.js';
import { BridgeProcess } from './core/BridgeProcess.js';
import { KeyStore } from './core/KeyStore.js';
import { aiService } from './core/ai/AIService.js';
import { TerminalManager } from './core/TerminalManager.js';
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

    // Stop all active terminal sessions (P1-1)
    TerminalManager.getInstance().killAll();

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
        // P1-7: Kill any orphaned kernel processes from a previous crashed session
        BridgeProcess.sweepOrphans();

        // P1-3: Restore API keys persisted by KeyStore on the previous session.
        // This prevents users from having to re-enter keys after a server restart.
        for (const provider of KeyStore.listProviders()) {
            const key = KeyStore.getKey(provider);
            if (key) {
                aiService.setApiKey(provider, key);
                server.log.info(`[KeyStore] Restored API key for provider: ${provider}`);
            }
        }

        // Register error handler
        server.setErrorHandler(errorHandler);

        // Register plugins
        await server.register(cors, {
            // Restrict to known local origins — this is a desktop-local app only.
            // Using origin: true (reflect-all) is unnecessarily permissive.
            origin: [
                'http://localhost:5000',   // Vite dev server
                'http://localhost:5173',   // Vite default fallback
                'http://127.0.0.1:5000',
                'http://127.0.0.1:5173',
            ],
            credentials: config.cors.credentials,
            methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Accept'],
        });

        await server.register(websocket);

        // P0-5: Enforce upload size limits. 500 MB per file, 1 MB per field value.
        await server.register(multipart, {
            limits: {
                fileSize:  500 * 1024 * 1024, // 500 MB per file
                fieldSize: 1   * 1024 * 1024, // 1 MB per non-file field
                files:     50,                // max 50 files per request
                fields:    20,                // max 20 non-file fields
            },
        });

        // P1-4: Global rate limit — defence-in-depth against runaway loops or rogue clients.
        // Per-route limits are registered in their respective route files.
        await server.register(rateLimit, {
            global:        true,
            max:           300,
            timeWindow:    60_000, // 1 minute window
            errorResponseBuilder: (_req, context) => ({
                statusCode:  429,
                error:       'Too Many Requests',
                message:     `Rate limit exceeded. Retry after ${Math.ceil(context.ttl / 1000)}s`,
                retryAfter:  Math.ceil(context.ttl / 1000),
            }),
        });

        // Register routes
        await server.register(kernelRoutes, { prefix: '/kernels' });
        await server.register(executionRoutes, { prefix: '/execution' });
        await server.register(filesRoutes, { prefix: '/files' });
        await server.register(aiRoutes, { prefix: '/ai' });
        await server.register(modelsRoutes, { prefix: '/ai/models' });
        await server.register(memoryRoutes, { prefix: '/api/memory' });
        await server.register(websocketRoutes);

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
