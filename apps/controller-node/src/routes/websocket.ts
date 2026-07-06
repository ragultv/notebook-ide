/**
 * websocket.ts — WebSocket server.
 * Routes browser messages to KernelManager (code execution, interrupt, etc.),
 * ExecutionEngine (run_all, run_above, run_below, run_selection, stop_execution),
 * and TerminalManager (P1-1: node-pty interactive terminal).
 *
 * Message protocol (Browser → Server):
 *   { type:'execute', cell_id, code }                           — run single cell
 *   { type:'run_all', cells:[{cell_id,code}] }                  — run all cells in order
 *   { type:'run_above', cells:[{cell_id,code}], target_cell_id } — run above target
 *   { type:'run_below', cells:[{cell_id,code}], target_cell_id } — run below target
 *   { type:'run_selection', cells:[{cell_id,code}], selected_ids:[] } — run selection
 *   { type:'stop_execution' }                                   — drain queue + interrupt
 *   { type:'interrupt' }                                        — interrupt kernel only
 *   { type:'restart' }                                          — restart kernel
 *   { type:'queue_snapshot' }                                   — request queue state
 *   { type:'terminal_start', session_id, cwd?, cols?, rows? }
 *   { type:'terminal_input', session_id, data }
 *   { type:'terminal_resize', session_id, cols, rows }
 *   { type:'terminal_stop', session_id }
 *
 * Message protocol (Server → Browser):
 *   { type:'kernel_status' }          — kernel idle/busy/etc
 *   { type:'execution_started' }      — cell accepted, execution_id assigned
 *   { type:'output' }                 — streaming cell output
 *   { type:'execution_complete' }     — cell done (success)
 *   { type:'execution_error' }        — cell done (failure)
 *   { type:'cell_started' }           — NEW: cell dequeued and running
 *   { type:'cell_completed' }         — NEW: cell fully done via EventBus
 *   { type:'cell_failed' }            — NEW: cell failed via EventBus
 *   { type:'cell_interrupted' }       — NEW: cell interrupted via EventBus
 *   { type:'cell_cancelled' }         — NEW: cell removed from queue
 *   { type:'queue_updated' }          — NEW: queue state snapshot
 *   { type:'notebook_saved' }         — NEW: autosave / manual save fired
 *   { type:'terminal_output' }
 *   { type:'terminal_exit' }
 */

import { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { KernelManager } from '../core/KernelManager.js';
import { TerminalManager } from '../core/TerminalManager.js';
import { notebookExecutionService } from '../core/execution/NotebookExecutionService.js';
import { cellExecutionQueue } from '../core/execution/CellExecutionQueue.js';
import { notebookManager } from '../core/notebook/NotebookManager.js';
import { eventBus } from '../core/events/EventBus.js';
import { v4 as uuidv4 } from 'uuid';
import { registerNotebookSocket, unregisterNotebookSocket } from './notebookBroadcast.js';

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
        const rawNotebookId = req.params.notebookId as string;
        const notebookId = rawNotebookId ? decodeURIComponent(rawNotebookId) : '';

        if (!notebookId) {
            socket.close();
            return;
        }

        console.log(`[WebSocket] Client connected for notebook: ${notebookId}`);
        connections.set(notebookId, socket);
        // Register into shared broadcast registry for agent cell execution
        registerNotebookSocket(notebookId, socket);

        // ── Kernel startup (lazy) ─────────────────────────────────────────────
        // Do not eagerly start process on tab open. Check if kernel is already running;
        // if not, send dormant status. Kernel starts lazily on first execution.
        const existingInfo = kernelManager.getKernelStatus(notebookId);
        socket.send(JSON.stringify({
            type:            'kernel_status',
            notebook_id:     notebookId,
            status:          existingInfo ? existingInfo.status : 'dormant',
            execution_count: existingInfo ? existingInfo.executionCount : 0,
        }));

        // ── KernelManager event listeners → browser ───────────────────────────

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

        // ── EventBus listeners → browser (new Octopod events) ────────────────

        const onCellStarted = (e: any) => {
            if (e.notebookId === notebookId) {
                socket.send(JSON.stringify({
                    type:           'cell_started',
                    notebook_id:    notebookId,
                    cell_id:        e.cellId,
                    execution_id:   e.executionId,
                    queue_position: e.queuePosition,
                    queue_size:     e.queueSize,
                }));
            }
        };

        const onCellCompleted = (e: any) => {
            if (e.notebookId === notebookId) {
                // New Octopod event
                socket.send(JSON.stringify({
                    type:            'cell_completed',
                    notebook_id:     notebookId,
                    cell_id:         e.cellId,
                    execution_id:    e.executionId,
                    execution_count: e.executionCount,
                    duration_ms:     e.durationMs,
                    success:         e.success,
                    outputs:         e.outputs,
                }));
                // Legacy event for Cell.tsx
                socket.send(JSON.stringify({
                    type:         'execution_complete',
                    notebook_id:  notebookId,
                    execution_id: e.executionId,
                    cell_id:      e.cellId,
                    duration_ms:  e.durationMs,
                    result: {
                        executionCount: e.executionCount,
                        execution_time: e.durationMs != null ? e.durationMs / 1000 : null,
                        outputs: e.outputs,
                    }
                }));
            }
        };

        const onCellFailed = (e: any) => {
            if (e.notebookId === notebookId) {
                // New Octopod event
                socket.send(JSON.stringify({
                    type:         'cell_failed',
                    notebook_id:  notebookId,
                    cell_id:      e.cellId,
                    execution_id: e.executionId,
                    error:        e.error,
                    ename:        e.ename,
                    evalue:       e.evalue,
                    traceback:    e.traceback,
                    outputs:      e.outputs,
                    duration_ms:  e.durationMs,
                }));
                // Legacy event for Cell.tsx
                socket.send(JSON.stringify({
                    type:         'execution_error',
                    notebook_id:  notebookId,
                    execution_id: e.executionId,
                    cell_id:      e.cellId,
                    error:        e.error,
                }));
            }
        };

        const onCellInterrupted = (e: any) => {
            if (e.notebookId === notebookId) {
                socket.send(JSON.stringify({
                    type:         'cell_interrupted',
                    notebook_id:  notebookId,
                    cell_id:      e.cellId,
                    execution_id: e.executionId,
                }));
            }
        };

        const onCellCancelled = (e: any) => {
            if (e.notebookId === notebookId) {
                socket.send(JSON.stringify({
                    type:         'cell_cancelled',
                    notebook_id:  notebookId,
                    cell_id:      e.cellId,
                    execution_id: e.executionId,
                }));
            }
        };

        const onQueueUpdated = (e: any) => {
            if (e.notebookId === notebookId) {
                socket.send(JSON.stringify({
                    type:                'queue_updated',
                    notebook_id:         notebookId,
                    queue:               e.queue,
                    status:              e.status,
                    active_execution_id: e.activeExecutionId,
                }));
            }
        };

        const onNotebookSaved = (e: any) => {
            if (e.notebookId === notebookId) {
                socket.send(JSON.stringify({
                    type:        'notebook_saved',
                    notebook_id: notebookId,
                    path:        e.path,
                    trigger:     e.trigger,
                }));
            }
        };

        eventBus.on('cell:started',     onCellStarted);
        eventBus.on('cell:completed',   onCellCompleted);
        eventBus.on('cell:failed',      onCellFailed);
        eventBus.on('cell:interrupted', onCellInterrupted);
        eventBus.on('cell:cancelled',   onCellCancelled);
        eventBus.on('queue:updated',    onQueueUpdated);
        eventBus.on('notebook:saved',   onNotebookSaved);

        // ── output:received → legacy 'output' message ───────────────────────
        // This is needed so run_all / run_above / run_below / run_selection
        // stream output to the browser in the format Cell.tsx already handles.
        // The single-cell 'execute' path uses its own direct callbacks below.

        const onOutputReceived = (e: any) => {
            if (e.notebookId !== notebookId) return;
            // Forward as the legacy 'output' format the frontend Cell.tsx expects
            const o = e.output;
            let legacyOutput: any;
            if (o.output_type === 'stream') {
                legacyOutput = { type: 'stream', stream: o.name, data: o.text };
            } else if (o.output_type === 'execute_result') {
                legacyOutput = { type: 'result', data: o.data, execution_count: o.execution_count };
            } else if (o.output_type === 'display_data') {
                legacyOutput = { type: 'display', data: o.data };
            } else if (o.output_type === 'error') {
                legacyOutput = { type: 'error', ename: o.ename, evalue: o.evalue, traceback: o.traceback };
            } else {
                return;
            }
            socket.send(JSON.stringify({
                type:         'output',
                notebook_id:  notebookId,
                execution_id: e.executionId,
                output:       legacyOutput,
            }));
        };

        eventBus.on('output:received', onOutputReceived);

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

                // ── Single cell execute (legacy + direct) ─────────────────────

                if (msg.type === 'execute') {
                    const executionId = msg.execution_id ?? uuidv4();

                    // Update the cell source in notebookManager so in-memory state is up-to-date!
                    notebookManager.updateCellSource(notebookId, msg.cell_id, msg.code);

                    // Confirm the server-assigned execution_id to the browser immediately.
                    socket.send(JSON.stringify({
                        type:         'execution_started',
                        notebook_id:  notebookId,
                        cell_id:      msg.cell_id,
                        execution_id: executionId,
                    }));

                    // Route directly through KernelManager with legacy streaming callbacks
                    // so the frontend receives 'output', 'execution_complete', 'execution_error'.
                    // This preserves the exact contract that Cell.tsx depends on.
                    kernelManager.executeCode(notebookId, msg.code, {
                        onStarted: () => {
                            // Cell was dequeued from the internal kernel queue and is now running.
                            // Emit cell_started so NotebookWSContext transitions the cell from
                            // yellow-Queued to green-Running in the execution store.
                            socket.send(JSON.stringify({
                                type:           'cell_started',
                                notebook_id:    notebookId,
                                cell_id:        msg.cell_id,
                                execution_id:   executionId,
                                queue_position: 0,
                                queue_size:     1,
                            }));
                        },
                        onOutput: (output) => {
                            socket.send(JSON.stringify({
                                type:         'output',
                                notebook_id:  notebookId,
                                execution_id: executionId,
                                output,
                            }));
                        },
                        onComplete: (result) => {
                            socket.send(JSON.stringify({
                                type:         'execution_complete',
                                notebook_id:  notebookId,
                                execution_id: executionId,
                                cell_id:      msg.cell_id,
                                result,
                            }));
                        },
                        onError: (error) => {
                            socket.send(JSON.stringify({
                                type:         'execution_error',
                                notebook_id:  notebookId,
                                execution_id: executionId,
                                cell_id:      msg.cell_id,
                                error,
                            }));
                        },
                    }, executionId).catch(err => {
                        console.error('[WebSocket] Execution error:', err);
                    });

                // ── Run All ───────────────────────────────────────────────────

                } else if (msg.type === 'run_all') {
                    // cells: [{ cell_id: string, code: string }]
                    const cells: Array<{ cellId: string; code: string }> =
                        (msg.cells ?? []).map((c: any) => ({ cellId: c.cell_id, code: c.code }));

                    for (const cell of cells) {
                        notebookManager.updateCellSource(notebookId, cell.cellId, cell.code);
                    }

                    notebookExecutionService.runCellsExplicit(notebookId, cells).catch(err => {
                        console.error('[WebSocket] run_all error:', err);
                    });

                // ── Run Above ─────────────────────────────────────────────────

                } else if (msg.type === 'run_above') {
                    const cells: Array<{ cellId: string; code: string }> =
                        (msg.cells ?? []).map((c: any) => ({ cellId: c.cell_id, code: c.code }));
                    const targetId: string = msg.target_cell_id;

                    for (const cell of cells) {
                        notebookManager.updateCellSource(notebookId, cell.cellId, cell.code);
                    }

                    // Filter to cells that come before targetId
                    const targetIdx = cells.findIndex((c) => c.cellId === targetId);
                    const above = targetIdx > 0 ? cells.slice(0, targetIdx) : [];

                    notebookExecutionService.runCellsExplicit(notebookId, above).catch(err => {
                        console.error('[WebSocket] run_above error:', err);
                    });

                // ── Run Below ─────────────────────────────────────────────────

                } else if (msg.type === 'run_below') {
                    const cells: Array<{ cellId: string; code: string }> =
                        (msg.cells ?? []).map((c: any) => ({ cellId: c.cell_id, code: c.code }));
                    const targetId: string = msg.target_cell_id;

                    for (const cell of cells) {
                        notebookManager.updateCellSource(notebookId, cell.cellId, cell.code);
                    }

                    const targetIdx = cells.findIndex((c) => c.cellId === targetId);
                    const below = targetIdx >= 0 && targetIdx < cells.length - 1
                        ? cells.slice(targetIdx + 1)
                        : [];

                    notebookExecutionService.runCellsExplicit(notebookId, below).catch(err => {
                        console.error('[WebSocket] run_below error:', err);
                    });

                // ── Run Selection ─────────────────────────────────────────────

                } else if (msg.type === 'run_selection') {
                    const cells: Array<{ cellId: string; code: string }> =
                        (msg.cells ?? []).map((c: any) => ({ cellId: c.cell_id, code: c.code }));
                    const selectedIds = new Set<string>(msg.selected_ids ?? []);

                    for (const cell of cells) {
                        notebookManager.updateCellSource(notebookId, cell.cellId, cell.code);
                    }

                    // Preserve notebook order, filter by selection
                    const selected = cells.filter((c) => selectedIds.has(c.cellId));

                    notebookExecutionService.runCellsExplicit(notebookId, selected).catch(err => {
                        console.error('[WebSocket] run_selection error:', err);
                    });

                // ── Stop execution (drain queue + interrupt) ──────────────────

                } else if (msg.type === 'stop_execution') {
                    await notebookExecutionService.stopExecution(notebookId);

                // ── Queue snapshot ────────────────────────────────────────────

                } else if (msg.type === 'queue_snapshot') {
                    const snap = cellExecutionQueue.getQueueSnapshot(notebookId);
                    socket.send(JSON.stringify({
                        type:        'queue_updated',
                        notebook_id: notebookId,
                        queue:       snap.entries,
                        status:      snap.status,
                    }));

                // ── Interrupt kernel only ─────────────────────────────────────

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
            // Unregister from shared broadcast registry
            unregisterNotebookSocket(notebookId);

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

            // Remove EventBus listeners
            eventBus.off('cell:started',     onCellStarted);
            eventBus.off('cell:completed',   onCellCompleted);
            eventBus.off('cell:failed',      onCellFailed);
            eventBus.off('cell:interrupted', onCellInterrupted);
            eventBus.off('cell:cancelled',   onCellCancelled);
            eventBus.off('queue:updated',    onQueueUpdated);
            eventBus.off('notebook:saved',   onNotebookSaved);
            eventBus.off('output:received',  onOutputReceived);

            // Remove terminal listeners
            terminalManager.off('terminal:output', onTerminalOutput);
            terminalManager.off('terminal:exit',   onTerminalExit);

            // NOTE: We do NOT kill the terminal session on disconnect —
            // the browser may reconnect and resume. User must send terminal_stop to clean up.
        });
    });
}
