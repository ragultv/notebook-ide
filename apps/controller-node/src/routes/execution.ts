import { FastifyInstance } from 'fastify';
import { KernelManager } from '../core/KernelManager.js';

const kernelManager = KernelManager.getInstance();

interface ExecuteBody {
    cellId: string;
    code: string;
    notebookId?: string;
    device?: 'cpu' | 'cuda';
}

function transformResult(cellId: string, notebookId: string, result: any) {
    return {
        cellId,
        notebookId,
        success: result.status === 'success',
        output: result.stdout || null,
        outputs: result.outputs || [],
        error: result.status === 'error' ? (result.error_details || result.stderr || 'Execution failed') : null,
        executionCount: result.execution_count || 0,
        duration: result.execution_time || 0,
    };
}

export async function executionRoutes(fastify: FastifyInstance) {
    fastify.post('/run_cell', async (request, reply) => {
        try {
            const { cellId, code, notebookId, device } = request.body as ExecuteBody;
            const id = notebookId || 'default';

            const result = await kernelManager.executeCode(id, code, undefined, 'python', device);

            // Transform result to match frontend expectations
            return transformResult(cellId, id, result);
        } catch (error: any) {
            reply.code(500).send({ error: error.message });
        }
    });

    // Streaming execution
    fastify.post('/run_cell_stream', async (request, reply) => {
        const { cellId, code, notebookId, device } = request.body as ExecuteBody;
        const id = notebookId || 'default';

        // Set CORS headers for SSE (required for cross-origin requests)
        reply.raw.setHeader('Access-Control-Allow-Origin', '*');
        reply.raw.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        reply.raw.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        // Set headers for streaming
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.flushHeaders();

        try {
            // Start kernel if not running
            const status = kernelManager.getKernelStatus(id);
            if (!status) {
                await kernelManager.startKernel(id, 'python', device);
            }

            const result = await kernelManager.executeCode(id, code, (streamEvent) => {
                const outputData = {
                    type: 'output',
                    output: streamEvent
                };
                reply.raw.write(`data: ${JSON.stringify(outputData)}\n\n`);
            }, 'python', device);

            // Send complete with transformed result
            const completeData = {
                type: 'complete',
                result: transformResult(cellId, id, result)
            };
            reply.raw.write(`data: ${JSON.stringify(completeData)}\n\n`);

        } catch (error: any) {
            const errorData = {
                type: 'error',
                error: error.message
            };
            reply.raw.write(`data: ${JSON.stringify(errorData)}\n\n`);
        } finally {
            reply.raw.end();
        }
    });

    fastify.post('/input', async (request, reply) => {
        try {
            const { notebookId, value } = request.body as { notebookId: string; value: string };
            const id = notebookId || 'default';
            kernelManager.sendInput(id, value);
            return { success: true };
        } catch (error: any) {
            reply.code(500).send({ error: error.message });
        }
    });

    fastify.post('/interrupt', async (request, reply) => {
        try {
            const { notebookId } = request.body as { notebookId: string };
            const id = notebookId || 'default';
            kernelManager.interruptKernel(id);
            return { success: true };
        } catch (error: any) {
            reply.code(500).send({ error: error.message });
        }
    });
    fastify.post('/resize', async (request, reply) => {
        try {
            const { notebookId, cols, rows } = request.body as { notebookId: string; cols: number; rows: number };
            const id = notebookId || 'default';
            kernelManager.resizeTerminal(id, cols, rows);
            return { success: true };
        } catch (error: any) {
            reply.code(500).send({ error: error.message });
        }
    });

    fastify.post('/complete', async (request, reply) => {
        try {
            const { code, cursorPos, notebookId, contextCode } = request.body as { code: string; cursorPos: number; notebookId: string; contextCode?: string };
            const id = notebookId || 'default';

            const completions = await kernelManager.getCompletions(id, code, cursorPos, contextCode);
            return { completions };
        } catch (error: any) {
            reply.code(500).send({ error: error.message });
        }
    });
}
