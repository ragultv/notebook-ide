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

import React, { createContext, useContext, ReactNode, useRef } from 'react';
import { useNotebookWebSocket } from '../../hooks/useNotebookWebSocket';

export interface WSContextType extends ReturnType<typeof useNotebookWebSocket> {
    registerRunCell: (cellId: string, runFn: () => Promise<any>) => void;
    unregisterRunCell: (cellId: string) => void;
    runCell: (cellId: string) => Promise<any>;
}

const NotebookWSContext = createContext<WSContextType | null>(null);

export function NotebookWSProvider({
    notebookId,
    children,
}: {
    notebookId: string;
    children: ReactNode;
}) {
    const ws = useNotebookWebSocket(notebookId);
    const registryRef = useRef<Record<string, () => Promise<any>>>({});

    const registerRunCell = (cellId: string, runFn: () => Promise<any>) => {
        registryRef.current[cellId] = runFn;
    };

    const unregisterRunCell = (cellId: string) => {
        delete registryRef.current[cellId];
    };

    const runCell = async (cellId: string) => {
        const runFn = registryRef.current[cellId];
        if (runFn) {
            return await runFn();
        }
        return undefined;
    };

    const contextValue: WSContextType = {
        ...ws,
        registerRunCell,
        unregisterRunCell,
        runCell,
    };

    return (
        <NotebookWSContext.Provider value={contextValue}>
            {children}
        </NotebookWSContext.Provider>
    );
}

export function useNotebookWS(): WSContextType {
    const ctx = useContext(NotebookWSContext);
    if (!ctx) {
        throw new Error('useNotebookWS must be used within a NotebookWSProvider');
    }
    return ctx;
}
