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
            const id = notebookId || 'default';

            const result = await kernelManager.executeCode(id, code);

            // Transform result to match frontend expectations
            return transformResult(cellId, id, result);
        } catch (error: any) {
            reply.code(500).send({ error: error.message });
        }
    });

    // Streaming execution
    fastify.post('/run_cell_stream', async (request, reply) => {
        const { cellId, code, notebookId } = request.body as ExecuteBody;
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

        // Track if input is requested
        let inputRequested = false;
        let inputExecutionId: string | null = null;

        // Listen for input_request events
        const onInputRequest = (reqNotebookId: string, data: any) => {
            if (reqNotebookId === id) {
                inputRequested = true;
                inputExecutionId = data.execution_id;
                // Send input_request to client
                const inputData = {
                    type: 'input_request',
                    execution_id: data.execution_id,
                    prompt: data.prompt,
                    password: data.password
                };
                reply.raw.write(`data: ${JSON.stringify(inputData)}\n\n`);
            }
        };

        // Listen for comm events (widgets)
        const onCommOpen = (reqNotebookId: string, data: any) => {
            if (reqNotebookId === id) {
                const commData = {
                    type: 'comm_open',
                    comm_id: data.comm_id,
                    target_name: data.target_name,
                    data: data.data,
                    metadata: data.metadata
                };
                reply.raw.write(`data: ${JSON.stringify(commData)}\n\n`);
            }
        };

        const onCommMsg = (reqNotebookId: string, data: any) => {
            if (reqNotebookId === id) {
                const commData = {
                    type: 'comm_msg',
                    comm_id: data.comm_id,
                    data: data.data
                };
                reply.raw.write(`data: ${JSON.stringify(commData)}\n\n`);
            }
        };

        const onCommClose = (reqNotebookId: string, commId: string) => {
            if (reqNotebookId === id) {
                const commData = {
                    type: 'comm_close',
                    comm_id: commId
                };
                reply.raw.write(`data: ${JSON.stringify(commData)}\n\n`);
            }
        };

        kernelManager.on('kernel:input_request', onInputRequest);
        kernelManager.on('kernel:comm_open', onCommOpen);
        kernelManager.on('kernel:comm_msg', onCommMsg);
        kernelManager.on('kernel:comm_close', onCommClose);

        try {
            // Start kernel if not running
            const status = kernelManager.getKernelStatus(id);
            if (!status) {
                await kernelManager.startKernel(id);
            }

            // Use callbacks for real-time streaming
            const result = await kernelManager.executeCode(id, code, {
                onOutput: (output) => {
                    // Stream output immediately as it comes
                    const outputData = {
                        type: 'output',
                        output
                    };
                    reply.raw.write(`data: ${JSON.stringify(outputData)}\n\n`);
                },
                onComplete: (result) => {
                    // Send complete message
                    const completeData = {
                        type: 'complete',
                        result: transformResult(cellId, id, result)
                    };
                    reply.raw.write(`data: ${JSON.stringify(completeData)}\n\n`);
                },
                onError: (error) => {
                    // Send error message
                    const errorData = {
                        type: 'error',
                        error
                    };
                    reply.raw.write(`data: ${JSON.stringify(errorData)}\n\n`);
                }
            });

        } catch (error: any) {
            const errorData = {
                type: 'error',
                error: error.message
            };
            reply.raw.write(`data: ${JSON.stringify(errorData)}\n\n`);
        } finally {
            kernelManager.off('kernel:input_request', onInputRequest);
            kernelManager.off('kernel:comm_open', onCommOpen);
            kernelManager.off('kernel:comm_msg', onCommMsg);
            kernelManager.off('kernel:comm_close', onCommClose);
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

    // Send input reply (for input() prompts)
    fastify.post('/stdin_reply', async (request, reply) => {
        try {
            const { notebookId, executionId, value } = request.body as { notebookId: string; executionId: string; value: string };
            const id = notebookId || 'default';

            await kernelManager.sendStdin(id, executionId, value);
            return { status: 'ok' };
        } catch (error: any) {
            reply.code(500).send({ error: error.message });
        }
    });

    // Send comm message (for widget interactions)
    fastify.post('/comm_msg', async (request, reply) => {
        try {
            const { notebookId, commId, data } = request.body as { notebookId: string; commId: string; data: any };
            const id = notebookId || 'default';

            await kernelManager.sendCommMsg(id, commId, data);
            return { status: 'ok' };
        } catch (error: any) {
            reply.code(500).send({ error: error.message });
        }
    });
}
