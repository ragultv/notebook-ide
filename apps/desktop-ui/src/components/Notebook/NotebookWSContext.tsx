/**
 * NotebookWSContext — provides one shared WebSocket connection for the entire notebook.
 *
 * Critical: every Cell must share the SAME WebSocket instance.
 * If each Cell creates its own connection, the server's WebSocket `connections` Map
 * will keep overwriting the previous socket for the same notebookId, meaning only
 * the last-registered cell receives messages like input_request.
 *
 * Usage:
 *   <NotebookWSProvider notebookId={id}>
 *     <Cell ... />   ← calls useNotebookWS() to get the shared instance
 *   </NotebookWSProvider>
 */

import React, { createContext, useContext, ReactNode } from 'react';
import { useNotebookWebSocket } from '../../hooks/useNotebookWebSocket';

type WSContextValue = ReturnType<typeof useNotebookWebSocket>;

const NotebookWSContext = createContext<WSContextValue | null>(null);

export function NotebookWSProvider({
    notebookId,
    children,
}: {
    notebookId: string;
    children: ReactNode;
}) {
    const ws = useNotebookWebSocket(notebookId);
    return (
        <NotebookWSContext.Provider value={ws}>
            {children}
        </NotebookWSContext.Provider>
    );
}

export function useNotebookWS(): WSContextValue {
    const ctx = useContext(NotebookWSContext);
    if (!ctx) {
        throw new Error('useNotebookWS must be used within a NotebookWSProvider');
    }
    return ctx;
}
