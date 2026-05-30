import { FastifyInstance } from 'fastify';
import { KernelManager } from '../core/KernelManager.js';

const kernelManager = KernelManager.getInstance();

interface ExecuteBody {
    cellId: string;
    code: string;
    notebookId?: string;
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
            const { cellId, code, notebookId } = request.body as ExecuteBody;
            const id     = notebookId || 'default';
            const result = await kernelManager.executeCode(id, code);
            return transformResult(cellId, id, result);
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });

    // Streaming execution — sends real-time output chunks via SSE.
    fastify.post('/run_cell_stream', async (request, reply) => {
        const { cellId, code, notebookId } = request.body as ExecuteBody;
        const id = notebookId || 'default';

        // Set headers for SSE streaming
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.flushHeaders();

        // Forward input_request events to the SSE client so the UI can render an input prompt.
        const onInputRequest = (reqNotebookId: string, data: any) => {
            if (reqNotebookId === id) {
                reply.raw.write(`data: ${JSON.stringify({
                    type:         'input_request',
                    execution_id: data.execution_id,
                    prompt:       data.prompt,
                    password:     data.password,
                })}\n\n`);
            }
        };

        const onCommOpen = (reqNotebookId: string, data: any) => {
            if (reqNotebookId === id) {
                reply.raw.write(`data: ${JSON.stringify({
                    type:        'comm_open',
                    comm_id:     data.comm_id,
                    target_name: data.target_name,
                    data:        data.data,
                    metadata:    data.metadata,
                })}\n\n`);
            }
        };

        const onCommMsg = (reqNotebookId: string, data: any) => {
            if (reqNotebookId === id) {
                reply.raw.write(`data: ${JSON.stringify({
                    type:    'comm_msg',
                    comm_id: data.comm_id,
                    data:    data.data,
                })}\n\n`);
            }
        };

        const onCommClose = (reqNotebookId: string, commId: string) => {
            if (reqNotebookId === id) {
                reply.raw.write(`data: ${JSON.stringify({ type: 'comm_close', comm_id: commId })}\n\n`);
            }
        };

        kernelManager.on('kernel:input_request', onInputRequest);
        kernelManager.on('kernel:comm_open',     onCommOpen);
        kernelManager.on('kernel:comm_msg',      onCommMsg);
        kernelManager.on('kernel:comm_close',    onCommClose);

        try {
            if (!kernelManager.getKernelStatus(id)) {
                await kernelManager.startKernel(id);
            }

            await kernelManager.executeCode(id, code, {
                onOutput: (output) => {
                    reply.raw.write(`data: ${JSON.stringify({ type: 'output', output })}\n\n`);
                },
                onComplete: (result) => {
                    reply.raw.write(`data: ${JSON.stringify({
                        type:   'complete',
                        result: transformResult(cellId, id, result),
                    })}\n\n`);
                },
                onError: (error) => {
                    reply.raw.write(`data: ${JSON.stringify({ type: 'error', error })}\n\n`);
                },
            });
        } catch (error: any) {
            reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
        } finally {
            kernelManager.off('kernel:input_request', onInputRequest);
            kernelManager.off('kernel:comm_open',     onCommOpen);
            kernelManager.off('kernel:comm_msg',      onCommMsg);
            kernelManager.off('kernel:comm_close',    onCommClose);
            reply.raw.end();
        }
    });

    // Forward raw user input to the kernel's stdin queue (for input() prompts, not terminal PTY).
    // Uses sendStdin (Jupyter protocol) rather than the now-removed ghost sendInput method.
    fastify.post('/input', async (request, reply) => {
        try {
            const { notebookId, executionId, value } = request.body as {
                notebookId: string; executionId: string; value: string;
            };
            const id = notebookId || 'default';
            await kernelManager.sendStdin(id, executionId, value);
            return { success: true };
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });

    fastify.post('/interrupt', async (request, reply) => {
        try {
            const { notebookId } = request.body as { notebookId: string };
            const id = notebookId || 'default';
            await kernelManager.interruptKernel(id);
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

    // Send stdin reply for input() prompts (explicit execution_id routing).
    fastify.post('/stdin_reply', async (request, reply) => {
        try {
            const { notebookId, executionId, value } = request.body as {
                notebookId: string; executionId: string; value: string;
            };
            const id = notebookId || 'default';
            await kernelManager.sendStdin(id, executionId, value);
            return { status: 'ok' };
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });

    // Forward widget comm messages from the browser to the kernel.
    fastify.post('/comm_msg', async (request, reply) => {
        try {
            const { notebookId, commId, data } = request.body as {
                notebookId: string; commId: string; data: unknown;
            };
            const id = notebookId || 'default';
            await kernelManager.sendCommMsg(id, commId, data);
            return { status: 'ok' };
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });
}
