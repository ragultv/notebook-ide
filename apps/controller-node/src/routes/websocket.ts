/**
 * websocket.ts — WebSocket server.
 * Routes browser messages to KernelManager (code execution, interrupt, etc.)
 * and TerminalManager (P1-1: node-pty interactive terminal).
 *
 * Message protocol additions (P1-1):
 *   Browser → Server: { type:'terminal_start', session_id, cwd?, cols?, rows? }
 *   Browser → Server: { type:'terminal_input', session_id, data }
 *   Browser → Server: { type:'terminal_resize', session_id, cols, rows }
 *   Browser → Server: { type:'terminal_stop', session_id }
 *   Server → Browser: { type:'terminal_output', session_id, data }
 *   Server → Browser: { type:'terminal_exit', session_id, exitCode, signal }
 */

import { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { KernelManager } from '../core/KernelManager.js';
import { TerminalManager } from '../core/TerminalManager.js';
import { v4 as uuidv4 } from 'uuid';

const kernelManager   = KernelManager.getInstance();
const terminalManager = TerminalManager.getInstance();

// Active WebSocket connections, keyed by notebookId
const connections = new Map<string, WebSocket>();

export async function websocketRoutes(fastify: FastifyInstance) {
    // Warm the kernel pool in background — cold start still works if pool isn't ready.
    void kernelManager.initializePool().catch((err) => {
        fastify.log.error({ err }, '[WebSocket] Kernel pool warm-up failed');
    });

    fastify.get('/ws/:notebookId', { websocket: true }, async (socket: WebSocket, req: any) => {
        const notebookId = req.params.notebookId as string;

        if (!notebookId) {
            socket.close();
            return;
        }

        console.log(`[WebSocket] Client connected for notebook: ${notebookId}`);
        connections.set(notebookId, socket);

        // ── Kernel startup ────────────────────────────────────────────────────
        try {
            const info = await kernelManager.startKernel(notebookId);
            socket.send(JSON.stringify({
                type:            'kernel_status',
                notebook_id:     notebookId,
                status:          info.status,
                execution_count: info.executionCount,
            }));
        } catch (e: any) {
            socket.send(JSON.stringify({
                type:        'error',
                notebook_id: notebookId,
                error:       `Failed to start kernel: ${e.message}`,
            }));
        }

        // ── Kernel event listeners → browser ──────────────────────────────────

        const onKernelStatus = (id: string, status: string) => {
            if (id === notebookId) {
                socket.send(JSON.stringify({ type: 'kernel_status', notebook_id: notebookId, status }));
            }
        };

        const onKernelDead = (id: string) => {
            if (id === notebookId) {
                socket.send(JSON.stringify({ type: 'kernel_dead', notebook_id: notebookId }));
            }
        };

        const onKernelReconnected = (id: string) => {
            if (id === notebookId) {
                socket.send(JSON.stringify({ type: 'kernel_reconnected', notebook_id: notebookId }));
            }
        };

        const onInputRequest = (id: string, data: any) => {
            if (id === notebookId) {
                socket.send(JSON.stringify({
                    type:         'input_request',
                    notebook_id:  notebookId,
                    execution_id: data.execution_id,
                    prompt:       data.prompt,
                    password:     data.password,
                }));
            }
        };

        const onDebug = (id: string, message: string) => {
            if (id === notebookId) console.log(`[Bridge ${id}] ${message}`);
        };

        const onCommOpen = (id: string, data: any) => {
            if (id === notebookId) {
                socket.send(JSON.stringify({
                    type:         'comm_open',
                    notebook_id:  notebookId,
                    comm_id:      data.comm_id,
                    target_name:  data.target_name,
                    data:         data.data,
                    metadata:     data.metadata,
                    execution_id: data.execution_id,
                }));
            }
        };

        const onCommMsg = (id: string, data: any) => {
            if (id === notebookId) {
                socket.send(JSON.stringify({
                    type:        'comm_msg',
                    notebook_id: notebookId,
                    comm_id:     data.comm_id,
                    data:        data.data,
                }));
            }
        };

        const onCommClose = (id: string, commId: string) => {
            if (id === notebookId) {
                socket.send(JSON.stringify({ type: 'comm_close', notebook_id: notebookId, comm_id: commId }));
            }
        };

        const onVariables = (id: string, data: any) => {
            if (id === notebookId) {
                socket.send(JSON.stringify({ type: 'variables', notebook_id: notebookId, data }));
            }
        };

        kernelManager.on('kernel:status_change', onKernelStatus);
        kernelManager.on('kernel:dead',          onKernelDead);
        kernelManager.on('kernel:reconnected',   onKernelReconnected);
        kernelManager.on('kernel:input_request', onInputRequest);
        kernelManager.on('kernel:debug',         onDebug);
        kernelManager.on('kernel:comm_open',     onCommOpen);
        kernelManager.on('kernel:comm_msg',      onCommMsg);
        kernelManager.on('kernel:comm_close',    onCommClose);
        kernelManager.on('kernel:variables',     onVariables);

        // ── P1-1: Terminal event listeners → browser ──────────────────────────

        const onTerminalOutput = (sessionId: string, data: string) => {
            // Only forward to the socket that owns this notebook's terminal session
            if (sessionId === notebookId) {
                socket.send(JSON.stringify({ type: 'terminal_output', session_id: sessionId, data }));
            }
        };

        const onTerminalExit = (sessionId: string, exitCode: number, signal: number | undefined) => {
            if (sessionId === notebookId) {
                socket.send(JSON.stringify({ type: 'terminal_exit', session_id: sessionId, exitCode, signal }));
            }
        };

        terminalManager.on('terminal:output', onTerminalOutput);
        terminalManager.on('terminal:exit',   onTerminalExit);

        // ── Browser → Server messages ─────────────────────────────────────────

        socket.on('message', async (raw: any) => {
            try {
                const msg = JSON.parse(raw.toString());

                // ── Kernel protocol ──────────────────────────────────────────

                if (msg.type === 'execute') {
                    msg.execution_id = uuidv4();

                    // Confirm the server-assigned execution_id to the browser
                    socket.send(JSON.stringify({
                        type:         'execution_started',
                        notebook_id:  notebookId,
                        cell_id:      msg.cell_id,
                        execution_id: msg.execution_id,
                    }));

                    // Fire-and-forget — may block on input() waiting for stdin_reply
                    kernelManager.executeCode(notebookId, msg.code, {
                        onOutput: (output) => {
                            socket.send(JSON.stringify({
                                type:         'output',
                                notebook_id:  notebookId,
                                execution_id: msg.execution_id,
                                output,
                            }));
                        },
                        onComplete: (result) => {
                            socket.send(JSON.stringify({
                                type:         'execution_complete',
                                notebook_id:  notebookId,
                                execution_id: msg.execution_id,
                                cell_id:      msg.cell_id,
                                result,
                            }));
                        },
                        onError: (error) => {
                            socket.send(JSON.stringify({
                                type:         'execution_error',
                                notebook_id:  notebookId,
                                execution_id: msg.execution_id,
                                cell_id:      msg.cell_id,
                                error,
                            }));
                        },
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
                    await kernelManager.sendCommMsg(notebookId, msg.comm_id, msg.data);

                // ── P1-1: Terminal protocol ──────────────────────────────────

                } else if (msg.type === 'terminal_start') {
                    const sessionId = msg.session_id || notebookId;
                    await terminalManager.createSession(
                        sessionId,
                        msg.cwd || process.cwd(),
                        msg.cols || 80,
                        msg.rows || 24
                    );
                    socket.send(JSON.stringify({
                        type:       'terminal_started',
                        session_id: sessionId,
                    }));

                } else if (msg.type === 'terminal_input') {
                    terminalManager.writeToSession(msg.session_id || notebookId, msg.data);

                } else if (msg.type === 'terminal_resize') {
                    terminalManager.resizeSession(msg.session_id || notebookId, msg.cols, msg.rows);

                } else if (msg.type === 'terminal_stop') {
                    terminalManager.killSession(msg.session_id || notebookId);
                    socket.send(JSON.stringify({ type: 'terminal_stopped', session_id: msg.session_id || notebookId }));
                }

            } catch (e: any) {
                socket.send(JSON.stringify({
                    type:        'error',
                    notebook_id: notebookId,
                    error:       e.message,
                }));
            }
        });

        // ── Disconnect cleanup ────────────────────────────────────────────────

        socket.on('close', () => {
            console.log(`[WebSocket] Client disconnected for notebook: ${notebookId}`);
            connections.delete(notebookId);

            // Remove kernel listeners
            kernelManager.off('kernel:status_change', onKernelStatus);
            kernelManager.off('kernel:dead',          onKernelDead);
            kernelManager.off('kernel:reconnected',   onKernelReconnected);
            kernelManager.off('kernel:input_request', onInputRequest);
            kernelManager.off('kernel:debug',         onDebug);
            kernelManager.off('kernel:comm_open',     onCommOpen);
            kernelManager.off('kernel:comm_msg',      onCommMsg);
            kernelManager.off('kernel:comm_close',    onCommClose);
            kernelManager.off('kernel:variables',     onVariables);

            // Remove terminal listeners
            terminalManager.off('terminal:output', onTerminalOutput);
            terminalManager.off('terminal:exit',   onTerminalExit);

            // NOTE: We do NOT kill the terminal session on disconnect —
            // the browser may reconnect and resume. User must send terminal_stop to clean up.
        });
    });
}
