/**
 * WebSocket server — the only connection point between browser and system.
 * Translates browser messages → bridge sends.
 * Translates bridge messages → browser sends.
 * No logic. Pure routing.
 */

import { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { KernelManager } from '../core/KernelManager.js';
import { v4 as uuidv4 } from 'uuid';

const kernelManager = KernelManager.getInstance();

// Map to track WebSocket connections per notebook
const connections = new Map<string, WebSocket>();

export async function websocketRoutes(fastify: FastifyInstance) {
    // Initialize kernel pool on startup
    await kernelManager.initializePool();

    fastify.get('/ws/:notebookId', { websocket: true }, async (socket: WebSocket, req: any) => {
        const notebookId = req.params.notebookId;

        if (!notebookId) {
            socket.close();
            return;
        }

        console.log(`[WebSocket] Client connected for notebook: ${notebookId}`);
        connections.set(notebookId, socket);

        // Get or create bridge for this notebook
        let bridgeReady = false;
        try {
            const info = await kernelManager.startKernel(notebookId);
            bridgeReady = true;

            // Send initial status
            socket.send(JSON.stringify({
                type: 'kernel_status',
                notebook_id: notebookId,
                status: info.status,
                execution_count: info.executionCount
            }));
        } catch (e: any) {
            socket.send(JSON.stringify({
                type: 'error',
                notebook_id: notebookId,
                error: `Failed to start kernel: ${e.message}`
            }));
        }

        // Listen for kernel events and forward to browser
        const onKernelStatus = (id: string, status: string) => {
            if (id === notebookId) {
                socket.send(JSON.stringify({
                    type: 'kernel_status',
                    notebook_id: notebookId,
                    status
                }));
            }
        };

        const onKernelDead = (id: string) => {
            if (id === notebookId) {
                socket.send(JSON.stringify({
                    type: 'kernel_dead',
                    notebook_id: notebookId
                }));
            }
        };

        const onKernelReconnected = (id: string) => {
            if (id === notebookId) {
                socket.send(JSON.stringify({
                    type: 'kernel_reconnected',
                    notebook_id: notebookId
                }));
            }
        };

        const onInputRequest = (id: string, data: any) => {
            if (id === notebookId) {
                socket.send(JSON.stringify({
                    type: 'input_request',
                    notebook_id: notebookId,
                    execution_id: data.execution_id,
                    prompt: data.prompt,
                    password: data.password
                }));
            }
        };

        const onDebug = (id: string, message: string) => {
            if (id === notebookId) {
                console.log(`[Bridge ${id}] ${message}`);
            }
        };

        const onCommOpen = (id: string, data: any) => {
            if (id === notebookId) {
                socket.send(JSON.stringify({
                    type: 'comm_open',
                    notebook_id: notebookId,
                    comm_id: data.comm_id,
                    target_name: data.target_name,
                    data: data.data,
                    metadata: data.metadata,
                    execution_id: data.execution_id
                }));
            }
        };

        const onCommMsg = (id: string, data: any) => {
            if (id === notebookId) {
                socket.send(JSON.stringify({
                    type: 'comm_msg',
                    notebook_id: notebookId,
                    comm_id: data.comm_id,
                    data: data.data
                }));
            }
        };

        const onCommClose = (id: string, commId: string) => {
            if (id === notebookId) {
                socket.send(JSON.stringify({
                    type: 'comm_close',
                    notebook_id: notebookId,
                    comm_id: commId
                }));
            }
        };

        kernelManager.on('kernel:status_change', onKernelStatus);
        kernelManager.on('kernel:dead', onKernelDead);
        kernelManager.on('kernel:reconnected', onKernelReconnected);
        kernelManager.on('kernel:input_request', onInputRequest);
        kernelManager.on('kernel:debug', onDebug);
        kernelManager.on('kernel:comm_open', onCommOpen);
        kernelManager.on('kernel:comm_msg', onCommMsg);
        kernelManager.on('kernel:comm_close', onCommClose);

        // Handle messages from browser
        socket.on('message', async (raw: any) => {
            try {
                const msg = JSON.parse(raw.toString());

                // Generate execution_id here in Node (single source of truth)
                if (msg.type === 'execute') {
                    msg.execution_id = uuidv4();

                    // Confirm execution_id back to browser so it can map cell
                    socket.send(JSON.stringify({
                        type: 'execution_started',
                        notebook_id: notebookId,
                        cell_id: msg.cell_id,
                        execution_id: msg.execution_id
                    }));

                    // Execute code with streaming callbacks.
                    // Pass the same execution_id we sent to the browser so output routing is correct.
                    // Don't await — execution may block on input() and we need to handle stdin_reply.
                    kernelManager.executeCode(notebookId, msg.code, {
                        onOutput: (output) => {
                            socket.send(JSON.stringify({
                                type: 'output',
                                notebook_id: notebookId,
                                execution_id: msg.execution_id,
                                output
                            }));
                        },
                        onComplete: (result) => {
                            socket.send(JSON.stringify({
                                type: 'execution_complete',
                                notebook_id: notebookId,
                                execution_id: msg.execution_id,
                                cell_id: msg.cell_id,
                                result
                            }));
                        },
                        onError: (error) => {
                            socket.send(JSON.stringify({
                                type: 'execution_error',
                                notebook_id: notebookId,
                                execution_id: msg.execution_id,
                                cell_id: msg.cell_id,
                                error
                            }));
                        }
                    }, msg.execution_id).catch(err => {
                        console.error('[WebSocket] Execution error:', err);
                    });
                } else if (msg.type === 'interrupt') {
                    await kernelManager.interruptKernel(notebookId);
                } else if (msg.type === 'restart') {
                    await kernelManager.restartKernel(notebookId);
                } else if (msg.type === 'stdin_reply') {
                    await kernelManager.sendStdin(notebookId, msg.execution_id, msg.value);
                } else if (msg.type === 'get_variables') {
                    await kernelManager.getVariables(notebookId);
                } else if (msg.type === 'comm_msg') {
                    // Browser widget → kernel (button clicks, state updates)
                    await kernelManager.sendCommMsg(notebookId, msg.comm_id, msg.data);
                }
            } catch (e: any) {
                socket.send(JSON.stringify({
                    type: 'error',
                    notebook_id: notebookId,
                    error: e.message
                }));
            }
        });

        // Handle disconnect
        socket.on('close', () => {
            console.log(`[WebSocket] Client disconnected for notebook: ${notebookId}`);
            connections.delete(notebookId);

            // Remove listeners
            kernelManager.off('kernel:status_change', onKernelStatus);
            kernelManager.off('kernel:dead', onKernelDead);
            kernelManager.off('kernel:reconnected', onKernelReconnected);
            kernelManager.off('kernel:input_request', onInputRequest);
            kernelManager.off('kernel:debug', onDebug);
            kernelManager.off('kernel:comm_open', onCommOpen);
            kernelManager.off('kernel:comm_msg', onCommMsg);
            kernelManager.off('kernel:comm_close', onCommClose);

            // Don't kill bridge on disconnect — user may reconnect
            // Browser reconnects and bridge is still alive with kernel state
        });
    });
}
