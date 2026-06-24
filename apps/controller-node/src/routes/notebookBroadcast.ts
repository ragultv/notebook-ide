/**
 * notebookBroadcast.ts
 *
 * Shared broadcast registry so any part of the backend (e.g. agent exec-tools)
 * can push WS messages to the browser for a given notebook, triggering the same
 * UI state transitions (running spinner, live output, success/error) that a
 * manual cell-run does.
 *
 * Usage:
 *   broadcastToNotebook(notebookId, { type: 'execution_started', ... });
 */

import type { WebSocket } from 'ws';

// Mirror of the connections map in websocket.ts — populated by registerNotebookSocket()
const _sockets = new Map<string, WebSocket>();

/**
 * Called by websocket.ts when a client connects / disconnects.
 */
function normalizeId(id: string): string {
  // Normalize Windows backslashes to forward slashes and ensure lowercase drive letters 
  // for consistent matching, or just replace backslashes.
  return id.replace(/\\/g, '/');
}

export function registerNotebookSocket(notebookId: string, socket: WebSocket): void {
  const normalized = normalizeId(notebookId);
  console.log(`[NotebookBroadcast] Registering socket for notebookId: ${normalized}`);
  _sockets.set(normalized, socket);
}

export function unregisterNotebookSocket(notebookId: string): void {
  const normalized = normalizeId(notebookId);
  console.log(`[NotebookBroadcast] Unregistering socket for notebookId: ${normalized}`);
  _sockets.delete(normalized);
}

/**
 * Send a JSON message to the browser for a specific notebook.
 * No-op if no browser tab is connected for that notebook.
 */
export function broadcastToNotebook(notebookId: string, msg: Record<string, unknown>): void {
  const normalized = normalizeId(notebookId);
  const socket = _sockets.get(normalized);
  console.log(`[NotebookBroadcast] Attempting broadcast to notebookId: ${normalized}, found socket: ${!!socket}, msgType: ${msg.type}`);
  if (socket && socket.readyState === 1 /* OPEN */) {
    try {
      socket.send(JSON.stringify(msg));
    } catch {
      // Ignore send errors — the socket may have just closed
    }
  }
}
