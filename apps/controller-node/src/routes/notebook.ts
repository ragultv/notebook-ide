/**
 * notebook.ts — HTTP routes for notebook lifecycle operations.
 *
 * Routes:
 *   POST /notebooks/open     — open a .ipynb file, returns notebook content + persisted outputs
 *   POST /notebooks/save     — manually save a notebook
 *   POST /notebooks/close    — close a notebook (release from memory)
 *   GET  /notebooks/list     — list all currently open notebooks
 *   GET  /notebooks/:id      — get current notebook state (cells + outputs)
 *   GET  /notebooks/:id/outputs — get persisted outputs for a notebook
 */

import { FastifyInstance } from 'fastify';
import { notebookManager } from '../core/notebook/NotebookManager.js';
import { outputManager } from '../core/output/OutputManager.js';
import { persistenceManager } from '../core/persistence/PersistenceManager.js';
import { cellExecutionQueue } from '../core/execution/CellExecutionQueue.js';
import { sessionManager } from '../core/session/SessionManager.js';
import { projectStore } from '../core/ProjectStore.js';
import { createVFS } from '../core/VirtualFS.js';

export async function notebookRoutes(fastify: FastifyInstance) {
    function getVFS() {
        return createVFS(projectStore.getCurrentProject()?.path);
    }

    // ── POST /notebooks/open ──────────────────────────────────────────────────

    fastify.post('/open', async (request, reply) => {
        const { path: filePath } = request.body as { path: string };

        if (!filePath) {
            return reply.code(400).send({ error: 'path is required' });
        }

        try {
            let resolvedPath = filePath;
            try {
                const vfs = getVFS();
                resolvedPath = vfs.resolve(filePath);
            } catch (vfsError) {
                // fallback to original path if not resolvable via VFS
            }

            const nb = await notebookManager.openNotebook(resolvedPath);

            // Retrieve persisted outputs to include in response
            const outputs: Record<string, any[]> = {};
            const nbOutputs = outputManager.getNotebookOutputs(nb.notebookId);
            for (const [cellId, cellOutputs] of nbOutputs.entries()) {
                outputs[cellId] = cellOutputs;
            }

            return {
                notebookId: nb.notebookId,
                path: nb.path,
                name: nb.name,
                notebook: nb.notebook,
                persistedOutputs: outputs,
                openedAt: nb.openedAt,
                lastSavedAt: nb.lastSavedAt,
            };
        } catch (err: any) {
            return reply.code(500).send({ error: err.message });
        }
    });

    // ── POST /notebooks/save ──────────────────────────────────────────────────

    fastify.post('/save', async (request, reply) => {
        const { notebookId } = request.body as { notebookId: string };

        if (!notebookId) {
            return reply.code(400).send({ error: 'notebookId is required' });
        }

        try {
            await persistenceManager.manualSave(notebookId);
            return { success: true, notebookId };
        } catch (err: any) {
            return reply.code(500).send({ error: err.message });
        }
    });

    // ── POST /notebooks/close ─────────────────────────────────────────────────

    fastify.post('/close', async (request, reply) => {
        const { notebookId } = request.body as { notebookId: string };

        if (!notebookId) {
            return reply.code(400).send({ error: 'notebookId is required' });
        }

        try {
            // Save before closing
            await persistenceManager.manualSave(notebookId);
            notebookManager.closeNotebook(notebookId);
            return { success: true };
        } catch (err: any) {
            return reply.code(500).send({ error: err.message });
        }
    });

    // ── GET /notebooks/list ───────────────────────────────────────────────────

    fastify.get('/list', async (_request, _reply) => {
        const notebooks = notebookManager.getAllOpen().map((nb) => ({
            notebookId: nb.notebookId,
            path: nb.path,
            name: nb.name,
            cellCount: nb.notebook.cells.length,
            isDirty: persistenceManager.isDirty(nb.notebookId),
            queueStatus: cellExecutionQueue.getQueueSnapshot(nb.notebookId).status,
            session: sessionManager.getSession(nb.notebookId),
            openedAt: nb.openedAt,
            lastSavedAt: nb.lastSavedAt,
        }));

        return { notebooks };
    });

    // ── GET /notebooks/:notebookId ────────────────────────────────────────────

    fastify.get('/:notebookId', async (request, reply) => {
        const { notebookId } = request.params as { notebookId: string };
        const decodedId = decodeURIComponent(notebookId);

        const nb = notebookManager.getNotebook(decodedId);
        if (!nb) {
            return reply.code(404).send({ error: 'Notebook not found. Call /open first.' });
        }

        return {
            notebookId: nb.notebookId,
            path: nb.path,
            name: nb.name,
            notebook: nb.notebook,
            isDirty: persistenceManager.isDirty(nb.notebookId),
            queueStatus: cellExecutionQueue.getQueueSnapshot(nb.notebookId).status,
            session: sessionManager.getSession(nb.notebookId),
        };
    });

    // ── GET /notebooks/:notebookId/outputs ────────────────────────────────────

    fastify.get('/:notebookId/outputs', async (request, _reply) => {
        const { notebookId } = request.params as { notebookId: string };
        const decodedId = decodeURIComponent(notebookId);

        const outputMap = outputManager.getNotebookOutputs(decodedId);
        const result: Record<string, any[]> = {};
        for (const [cellId, outputs] of outputMap.entries()) {
            result[cellId] = outputs;
        }

        return { notebookId: decodedId, outputs: result };
    });

    // ── POST /notebooks/:notebookId/clear-outputs ──────────────────────────────

    fastify.post('/:notebookId/clear-outputs', async (request, _reply) => {
        const { notebookId } = request.params as { notebookId: string };
        const decodedId = decodeURIComponent(notebookId);

        outputManager.clearNotebookOutputs(decodedId);
        notebookManager.clearAllOutputs(decodedId);

        return { success: true, notebookId: decodedId };
    });
}
