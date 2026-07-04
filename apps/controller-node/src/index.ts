import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { kernelRoutes } from './routes/kernels.js';
import { executionRoutes } from './routes/execution.js';
import { providersRoutes } from './routes/providers.js';
import { filesRoutes } from './routes/files.js';
import { websocketRoutes } from './routes/websocket.js';
import { notebookRoutes } from './routes/notebook.js';
import { agentRoutes } from './routes/agent.js';
import { chatSessionRoutes } from './routes/chat-sessions.js';
import { agentModelsRoutes } from './routes/agent-models.js';
import { config } from './config.js';
import { errorHandler } from './middleware/errorHandler.js';
import { KernelManager } from './core/KernelManager.js';
import { BridgeProcess } from './core/BridgeProcess.js';
import { KeyStore as _KeyStore } from './core/KeyStore.js';
import { TerminalManager } from './core/TerminalManager.js';
// Octopod runtime managers
import { persistenceManager } from './core/persistence/PersistenceManager.js';
import { sessionManager } from './core/session/SessionManager.js';
import { notebookManager } from './core/notebook/NotebookManager.js';
import { notebookExecutionService as _notebookExecutionService } from './core/execution/NotebookExecutionService.js'; // side-effect: registers kernel:restarted handler
import './core/kernel/KernelBootstrap.js'; // side-effect: wires KernelManager events to VS Code kernel system

const server: FastifyInstance = fastify({
    bodyLimit: 50 * 1024 * 1024, // 50 MB
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

    // Flush autosave and close DB
    persistenceManager.shutdown();

    await server.close();
    process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

const start = async () => {
    try {
        // P1-7: Kill any orphaned kernel processes from a previous crashed session
        BridgeProcess.sweepOrphans();

        // Initialize Octopod runtime managers (order matters: store → session → persistence)
        // executionEngine is imported above — its constructor registers the queue executor
        sessionManager.initialize();
        persistenceManager.initialize(notebookManager);
        server.log.info('[Octopod] Runtime managers initialized.');

        // API keys are now managed by the new agent system via model-router.ts

        // Register error handler
        server.setErrorHandler(errorHandler);

        // Register plugins
        await server.register(cors, {
            // Allowed origins:
            //   octoml-app://app  — production renderer (custom Electron protocol, VS Code pattern)
            //   http://localhost:* — Vite dev server
            //   http://127.0.0.1:* — Vite dev server (alternate)
            //   null / no origin  — health-check requests, CLI tools, fallback
            origin: (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
                if (!origin || origin === 'null') { cb(null, true); return; }
                if (origin.startsWith('octoml-app:')) { cb(null, true); return; }
                if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
                    cb(null, true); return;
                }
                cb(new Error('CORS: origin not allowed'), false);
            },
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
        await server.register(kernelRoutes,      { prefix: '/kernels' });
        await server.register(executionRoutes,   { prefix: '/execution' });
        await server.register(filesRoutes,       { prefix: '/files' });
        await server.register(websocketRoutes);
        await server.register(notebookRoutes,    { prefix: '/notebooks' });
        await server.register(agentRoutes);
        await server.register(chatSessionRoutes);
        await server.register(agentModelsRoutes);
        await server.register(providersRoutes);  // self-registers at /api/providers/*

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
