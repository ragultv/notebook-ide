/**
 * WebSocket hook for notebook communication with the Bridge architecture.
 * One WebSocket per notebook, shared across all cells.
 *
 * Execution flow:
 *  1. Browser calls execute(cellId, code) → sends {type:'execute', cell_id, code} over WS
 *  2. Server receives it, generates authoritative execution_id, sends {type:'execution_started', execution_id}
 *  3. All subsequent output messages carry that server-assigned execution_id
 *  4. The Cell component listens to 'output', 'execution_complete', 'execution_error' on the shared WS
 *     and filters by execution_id stored in a ref.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

const BASE_URL = 'ws://127.0.0.1:3001';

export interface WebSocketMessage {
    type: string;
    notebook_id: string;
    [key: string]: any;
}

export function useNotebookWebSocket(notebookId: string | null) {
    const wsRef = useRef<WebSocket | null>(null);
    const [connected, setConnected] = useState(false);
    const [kernelStatus, setKernelStatus] = useState<'idle' | 'busy' | 'error' | 'starting'>('starting');
    // Map of message type → list of handlers
    const listeners = useRef<Map<string, Function[]>>(new Map());
    // Pending executions: localId → callback called when server sends execution_started
    const pendingExecutions = useRef<Map<string, (serverExecId: string) => void>>(new Map());
    const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!notebookId) return;

        const connect = () => {
            const ws = new WebSocket(`${BASE_URL}/ws/${encodeURIComponent(notebookId)}`);
            wsRef.current = ws;

            ws.onopen = () => {
                console.log(`[WebSocket] Connected for notebook: ${notebookId}`);
                setConnected(true);
                // Expose WS instance for Run All (useKernelManagement)
                if (!(window as any).__notebookWS) (window as any).__notebookWS = {};
                (window as any).__notebookWS[notebookId] = ws;
                if (reconnectTimeoutRef.current) {
                    clearTimeout(reconnectTimeoutRef.current);
                    reconnectTimeoutRef.current = null;
                }
            };

            ws.onclose = () => {
                console.log(`[WebSocket] Disconnected for notebook: ${notebookId}`);
                setConnected(false);
                setKernelStatus('starting');
                // Remove exposed WS instance
                if ((window as any).__notebookWS) {
                    delete (window as any).__notebookWS[notebookId];
                }

                // Auto-reconnect after 2 seconds
                reconnectTimeoutRef.current = setTimeout(connect, 2000);
            };

            ws.onerror = (error) => {
                console.error(`[WebSocket] Error for notebook ${notebookId}:`, error);
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data) as WebSocketMessage;

                    // Update kernel status from server status messages
                    if (msg.type === 'kernel_status') {
                        setKernelStatus(msg.status);
                    }

                    // When server confirms execution started, call pending callback with the
                    // server-assigned execution_id so Cell can store it and match future outputs.
                    if (msg.type === 'execution_started' && msg.cell_id) {
                        const cb = pendingExecutions.current.get(msg.cell_id);
                        if (cb) {
                            pendingExecutions.current.delete(msg.cell_id);
                            cb(msg.execution_id);
                        }
                    }

                    // Notify all listeners for this message type
                    const handlers = listeners.current.get(msg.type) || [];
                    handlers.forEach(h => h(msg));

                    // Wildcard listeners
                    const all = listeners.current.get('*') || [];
                    all.forEach(h => h(msg));
                } catch (e) {
                    console.error('[WebSocket] Failed to parse message:', e);
                }
            };
        };

        connect();

        return () => {
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
            wsRef.current?.close();
        };
    }, [notebookId]);

    // Register a listener for a message type. Returns cleanup function.
    const on = useCallback((type: string, handler: Function) => {
        if (!listeners.current.has(type)) {
            listeners.current.set(type, []);
        }
        listeners.current.get(type)!.push(handler);

        return () => {
            const arr = listeners.current.get(type) || [];
            listeners.current.set(type, arr.filter(h => h !== handler));
        };
    }, []);

    /**
     * Send an execute command.
     * Returns a Promise that resolves with the server-assigned execution_id.
     * Cell stores this id in a ref and uses it to filter subsequent output messages.
     */
    const execute = useCallback((cellId: string, code: string): Promise<string> => {
        return new Promise((resolve, reject) => {
            // 15-second timeout in case the server never confirms execution_started
            const timeoutHandle = setTimeout(() => {
                pendingExecutions.current.delete(cellId);
                reject(new Error('Execution start timed out — kernel may not be ready'));
            }, 15000);

            pendingExecutions.current.set(cellId, (serverExecId: string) => {
                clearTimeout(timeoutHandle);
                resolve(serverExecId);
            });

            wsRef.current?.send(JSON.stringify({
                type: 'execute',
                notebook_id: notebookId,
                cell_id: cellId,
                code,
            }));
        });
    }, [notebookId]);

    const interrupt = useCallback(() => {
        wsRef.current?.send(JSON.stringify({
            type: 'interrupt',
            notebook_id: notebookId,
        }));
    }, [notebookId]);

    const restart = useCallback(() => {
        wsRef.current?.send(JSON.stringify({
            type: 'restart',
            notebook_id: notebookId,
        }));
    }, [notebookId]);

    const sendStdin = useCallback((executionId: string, value: string) => {
        wsRef.current?.send(JSON.stringify({
            type: 'stdin_reply',
            notebook_id: notebookId,
            execution_id: executionId,
            value,
        }));
    }, [notebookId]);

    const sendCommMsg = useCallback((commId: string, data: any) => {
        wsRef.current?.send(JSON.stringify({
            type: 'comm_msg',
            notebook_id: notebookId,
            comm_id: commId,
            data,
        }));
    }, [notebookId]);

    const getVariables = useCallback(() => {
        wsRef.current?.send(JSON.stringify({
            type: 'get_variables',
            notebook_id: notebookId,
        }));
    }, [notebookId]);

    return {
        connected,
        kernelStatus,
        on,
        execute,
        interrupt,
        restart,
        sendStdin,
        sendCommMsg,
        getVariables,
    };
}
