/**
 * File system routes for OctoML.
 *
 * PATH MODEL:
 *   All routes accept and return VIRTUAL paths  (e.g. "/data/file.csv").
 *   The backend resolves them to OS paths via VirtualFS.
 *   OS absolute paths are NEVER sent to the frontend.
 */

import { FastifyInstance } from 'fastify';
import '@fastify/multipart';
import fs from 'fs-extra';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { fileURLToPath } from 'url';
import { projectStore, OCTOML_DIR } from '../core/ProjectStore.js';
import { VirtualFS, createVFS } from '../core/VirtualFS.js';
import { notebookManager } from '../core/notebook/NotebookManager.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getVFS(): VirtualFS {
    return createVFS(projectStore.getCurrentProject()?.path);
}

function getExtension(name: string): string {
    const idx = name.lastIndexOf('.');
    return idx >= 0 ? name.slice(idx) : '';
}

// ─── File tree builder ────────────────────────────────────────────────────────

interface FileTreeNode {
    name:       string;
    virtualPath: string;
    type:       'file' | 'directory';
    extension?: string;
    size?:      number;
    modified?:  string;
    children?:  FileTreeNode[];
}

async function buildTree(
    dirPath: string,
    vfs: VirtualFS,
    recursive = false,
    depth = 0,
): Promise<FileTreeNode[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const nodes: FileTreeNode[] = [];

    for (const entry of entries) {
        // Always hide dotfiles at root level; specifically hide .octoml everywhere
        if (entry.name.startsWith('.')) continue;

        const osPath = path.join(dirPath, entry.name);
        const vPath  = vfs.toVirtual(osPath);
        const isDir  = entry.isDirectory();

        let size: number | undefined;
        let modified: string | undefined;
        try {
            const stat = await fs.stat(osPath);
            size       = stat.size;
            modified   = stat.mtime.toISOString();
        } catch { /* ignore */ }

        const node: FileTreeNode = {
            name:       entry.name,
            virtualPath: vPath,
            type:       isDir ? 'directory' : 'file',
            extension:  isDir ? undefined : getExtension(entry.name),
            size,
            modified,
        };

        if (isDir && (recursive || depth === 0)) {
            node.children = await buildTree(osPath, vfs, recursive, depth + 1);
        }

        nodes.push(node);
    }

    // Directories first, then files; both alpha-sorted
    nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });

    return nodes;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function filesRoutes(fastify: FastifyInstance) {

    // ── GET /files/tree ─────────────────────────────────────────────────────
    // Returns full recursive virtual file tree for the active project.
    fastify.get('/tree', async (_request, reply) => {
        try {
            const vfs   = getVFS();
            const tree  = await buildTree(vfs.root, vfs, true);
            return { tree, projectRoot: '/' };
        } catch (error: any) {
            return reply.code(error.statusCode ?? 500).send({ error: error.message });
        }
    });

    // ── GET /files/list ─────────────────────────────────────────────────────
    // Lists children of a virtual directory (non-recursive, lazy loading).
    fastify.get('/list', async (request, reply) => {
        const { path: virtualPath } = request.query as { path?: string };
        try {
            const vfs     = getVFS();
            const ospath  = virtualPath ? vfs.resolve(virtualPath) : vfs.root;
            const items   = await buildTree(ospath, vfs, false);
            return { path: virtualPath ?? '/', items };
        } catch (error: any) {
            return reply.code(error.statusCode ?? 500).send({ error: error.message });
        }
    });

    // ── GET /files/read ─────────────────────────────────────────────────────
    fastify.get('/read', async (request, reply) => {
        const { path: virtualPath } = request.query as { path: string };
        if (!virtualPath) return reply.code(400).send({ error: 'path query param required' });
        try {
            const vfs    = getVFS();
            const ospath = vfs.resolve(virtualPath);
            const content = await fs.readFile(ospath, 'utf-8');
            const stats   = await fs.stat(ospath);
            return { path: virtualPath, content, size: stats.size };
        } catch (error: any) {
            return reply.code(error.statusCode ?? 500).send({ error: error.message });
        }
    });

    // ── GET /files/raw ──────────────────────────────────────────────────────
    fastify.get('/raw', async (request, reply) => {
        const { path: virtualPath } = request.query as { path: string };
        if (!virtualPath) return reply.code(400).send({ error: 'path query param required' });
        try {
            const vfs = getVFS();
            const ospath = vfs.resolve(virtualPath);
            const { createReadStream } = await import('fs');
            const stream = createReadStream(ospath);
            
            // Set content type based on extension
            const ext = path.extname(ospath).toLowerCase();
            const mimeTypes: Record<string, string> = {
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.gif': 'image/gif',
                '.webp': 'image/webp',
                '.svg': 'image/svg+xml'
            };
            if (mimeTypes[ext]) {
                reply.header('Content-Type', mimeTypes[ext]);
            }
            return reply.send(stream);
        } catch (error: any) {
            return reply.code(error.statusCode ?? 500).send({ error: error.message });
        }
    });

    // ── POST /files/save ────────────────────────────────────────────────────
    fastify.post('/save', async (request, reply) => {
        const { path: virtualPath, content } = request.body as { path: string; content: string };
        if (!virtualPath) return reply.code(400).send({ error: 'path is required' });
        try {
            const vfs    = getVFS();
            const ospath = await vfs.resolveSafe(virtualPath);
            await fs.ensureDir(path.dirname(ospath));
            await fs.writeFile(ospath, content, 'utf-8');
            const stats = await fs.stat(ospath);

            // If it's a notebook and is currently open, sync the in-memory cells/content.
            if (virtualPath.endsWith('.ipynb')) {
                const notebookId = notebookManager.pathToId(ospath);
                if (notebookManager.isOpen(notebookId)) {
                    try {
                        const parsed = typeof content === 'string' ? JSON.parse(content) : content;
                        notebookManager.updateNotebookContent(notebookId, parsed);
                    } catch (e) {
                        // ignore parse/JSON errors
                    }
                }
            }

            return { status: 'saved', path: virtualPath, size: stats.size };
        } catch (error: any) {
            return reply.code(error.statusCode ?? 500).send({ error: error.message });
        }
    });

    // ── POST /files/create-file ──────────────────────────────────────────────
    // Creates a new file with optional initial content.
    fastify.post('/create-file', async (request, reply) => {
        const { path: virtualPath, content = '' } = request.body as { path: string; content?: string };
        if (!virtualPath) return reply.code(400).send({ error: 'path is required' });
        try {
            const vfs    = getVFS();
            const ospath = vfs.resolve(virtualPath);
            if (await fs.pathExists(ospath)) {
                return reply.code(409).send({ error: 'File already exists' });
            }
            await fs.ensureDir(path.dirname(ospath));
            await fs.writeFile(ospath, content, 'utf-8');
            return { status: 'created', path: virtualPath };
        } catch (error: any) {
            return reply.code(error.statusCode ?? 500).send({ error: error.message });
        }
    });

    // ── GET /files/project ──────────────────────────────────────────────────
    fastify.get('/project', async () => {
        const project  = projectStore.getCurrentProject();
        return { project };
    });

    // ── POST /files/project/open ────────────────────────────────────────────
    fastify.post('/project/open', async (request, reply) => {
        const { path: projectPath, name } = request.body as { path: string; name?: string };
        if (!projectPath) return reply.code(400).send({ error: 'path is required' });
        try {
            const resolved = path.resolve(projectPath);
            if (!(await fs.pathExists(resolved))) {
                return reply.code(404).send({ error: `Path does not exist: ${resolved}` });
            }
            const stat = await fs.stat(resolved);
            if (!stat.isDirectory()) {
                return reply.code(400).send({ error: 'Path must be a directory' });
            }

            // Try to read existing manifest, or validate legacy project
            const manifest = await projectStore.validateProject(resolved);
            const projName = name || manifest?.name || path.basename(resolved);

            // Ensure .octoml dir exists even for legacy projects
            await projectStore.ensureOctoMLDir(resolved);

            const proj = { path: resolved, name: projName };
            await projectStore.setCurrentProject(proj);
            await projectStore.addRecentProject(proj);

            return { status: 'opened', project: proj, manifest };
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });

    // ── POST /files/project/create ──────────────────────────────────────────
    fastify.post('/project/create', async (request, reply) => {
        const { path: projectPath, name, pythonPath } = request.body as {
            path: string; name: string; pythonPath?: string;
        };
        if (!projectPath || !name) return reply.code(400).send({ error: 'path and name are required' });
        try {
            const resolved = path.resolve(projectPath);
            await fs.ensureDir(resolved);

            const manifest = await projectStore.initProject(resolved, name, pythonPath);
            const proj     = { path: resolved, name };
            await projectStore.setCurrentProject(proj);
            await projectStore.addRecentProject(proj);

            return { status: 'created', project: proj, manifest };
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });

    // ── POST /files/project/close ───────────────────────────────────────────
    fastify.post('/project/close', async () => {
        await projectStore.closeProject();
        return { status: 'closed' };
    });

    // ── GET /files/project/metadata ─────────────────────────────────────────
    fastify.get('/project/metadata', async (_request, reply) => {
        const proj = projectStore.getCurrentProject();
        if (!proj) return reply.code(400).send({ error: 'No project open' });
        const manifest = await projectStore.getManifest(proj.path);
        return { manifest };
    });

    // ── POST /files/project/metadata ────────────────────────────────────────
    fastify.post('/project/metadata', async (request, reply) => {
        const proj = projectStore.getCurrentProject();
        if (!proj) return reply.code(400).send({ error: 'No project open' });
        const updates = request.body as object;
        const manifest = await projectStore.saveManifest(proj.path, updates);
        return { manifest };
    });

    // ── GET /files/recent ───────────────────────────────────────────────────
    fastify.get('/recent', async () => {
        return { recent: projectStore.getRecentProjects() };
    });

    // ── GET /files/project/os-root ───────────────────────────────────────────
    // Returns the OS absolute path of the project root (for "Open in Explorer").
    fastify.get('/project/os-root', async (_request, reply) => {
        const proj = projectStore.getCurrentProject();
        if (!proj) return reply.code(400).send({ error: 'No project is currently open.' });
        return { osPath: proj.path };
    });

    // ── GET /files/resolve-os-path ───────────────────────────────────────────
    // Resolves a virtual path to its OS absolute path (for "Open in Explorer").
    fastify.get('/resolve-os-path', async (request, reply) => {
        const { path: virtualPath } = request.query as { path?: string };
        try {
            const vfs    = getVFS();
            const ospath = vfs.resolve(virtualPath ?? '/');
            return { osPath: ospath };
        } catch (error: any) {
            return reply.code(error.statusCode ?? 500).send({ error: error.message });
        }
    });

    // ── DELETE /files/delete ─────────────────────────────────────────────────
    fastify.delete('/delete', async (request, reply) => {
        const { path: virtualPath } = request.query as { path: string };
        if (!virtualPath) return reply.code(400).send({ error: 'path query param required' });
        try {
            const vfs    = getVFS();
            const ospath = await vfs.resolveSafe(virtualPath);
            if (!(await fs.pathExists(ospath))) {
                return reply.code(404).send({ error: 'Path not found' });
            }
            await fs.remove(ospath);
            return { status: 'deleted', path: virtualPath };
        } catch (error: any) {
            return reply.code(error.statusCode ?? 500).send({ error: error.message });
        }
    });

    // ── POST /files/rename ───────────────────────────────────────────────────
    fastify.post('/rename', async (request, reply) => {
        const { oldPath, newPath } = request.body as { oldPath: string; newPath: string };
        if (!oldPath || !newPath) return reply.code(400).send({ error: 'oldPath and newPath are required' });
        try {
            const vfs       = getVFS();
            const oldOsPath = vfs.resolve(oldPath);
            const newOsPath = vfs.resolve(newPath);
            if (!(await fs.pathExists(oldOsPath))) {
                return reply.code(404).send({ error: `Source not found: ${oldPath}` });
            }
            await fs.move(oldOsPath, newOsPath, { overwrite: false });
            return { status: 'renamed', oldPath, newPath };
        } catch (error: any) {
            return reply.code(error.statusCode ?? 500).send({ error: error.message });
        }
    });

    // ── POST /files/move ────────────────────────────────────────────────────
    // Move a file or folder to a different directory (drag & drop support).
    fastify.post('/move', async (request, reply) => {
        const { srcPath, dstFolder } = request.body as { srcPath: string; dstFolder: string };
        if (!srcPath || !dstFolder) return reply.code(400).send({ error: 'srcPath and dstFolder are required' });
        try {
            const vfs      = getVFS();
            const srcOs    = vfs.resolve(srcPath);
            const dstDirOs = vfs.resolve(dstFolder);
            const fileName = path.basename(srcOs);
            const dstOs    = path.join(dstDirOs, fileName);

            if (!(await fs.pathExists(srcOs))) {
                return reply.code(404).send({ error: `Source not found: ${srcPath}` });
            }
            await fs.move(srcOs, dstOs, { overwrite: false });
            const newVirtual = vfs.toVirtual(dstOs);
            return { status: 'moved', srcPath, newPath: newVirtual };
        } catch (error: any) {
            return reply.code(error.statusCode ?? 500).send({ error: error.message });
        }
    });

    // ── POST /files/create-folder ────────────────────────────────────────────
    fastify.post('/create-folder', async (request, reply) => {
        const { path: parentVirtualPath, name } = request.body as { path: string; name: string };
        if (!parentVirtualPath || !name) return reply.code(400).send({ error: 'path and name are required' });
        try {
            const vfs        = getVFS();
            const parentOs   = vfs.resolve(parentVirtualPath);
            const folderOs   = path.join(parentOs, name);
            vfs.resolve(vfs.toVirtual(folderOs)); // re-validate
            await fs.ensureDir(folderOs);
            return { status: 'created', path: vfs.toVirtual(folderOs) };
        } catch (error: any) {
            return reply.code(error.statusCode ?? 500).send({ error: error.message });
        }
    });

    // ── POST /files/upload (single) ──────────────────────────────────────────
    fastify.post('/upload', async (request, reply) => {
        try {
            const data = await request.file();
            if (!data) return reply.code(400).send({ error: 'No file provided' });

            const destVirtual = (data.fields as any)?.destination?.value as string;
            if (!destVirtual) return reply.code(400).send({ error: 'destination field required' });

            const vfs      = getVFS();
            const destOs   = vfs.resolve(destVirtual);
            const fileOs   = path.join(destOs, data.filename);
            vfs.resolve(vfs.toVirtual(fileOs)); // validate

            await fs.ensureDir(destOs);
            await pipeline(data.file, createWriteStream(fileOs));
            const stats = await fs.stat(fileOs);
            return {
                status: 'uploaded',
                path:   vfs.toVirtual(fileOs),
                name:   data.filename,
                size:   stats.size,
            };
        } catch (error: any) {
            return reply.code(error.statusCode ?? 500).send({ error: error.message });
        }
    });

    // ── POST /files/upload-multiple ──────────────────────────────────────────
    fastify.post('/upload-multiple', async (request, reply) => {
        try {
            const parts  = request.parts();
            let destVirtual = '';
            const vfs    = getVFS();
            const results: Array<{ status: string; name: string; path?: string; error?: string }> = [];
            const pendingFiles: Array<{ name: string; _buf: Buffer }> = [];

            for await (const part of parts) {
                if (part.type === 'field' && part.fieldname === 'destination') {
                    destVirtual = (part as any).value as string;
                } else if (part.type === 'file') {
                    const chunks: Buffer[] = [];
                    for await (const chunk of part.file) chunks.push(chunk as Buffer);
                    pendingFiles.push({ name: part.filename, _buf: Buffer.concat(chunks) });
                }
            }

            if (!destVirtual) return reply.code(400).send({ error: 'No destination folder provided' });
            const destOs = vfs.resolve(destVirtual);
            await fs.ensureDir(destOs);

            for (const pf of pendingFiles) {
                const fileOs = path.join(destOs, pf.name);
                try {
                    vfs.resolve(vfs.toVirtual(fileOs));
                    await fs.writeFile(fileOs, pf._buf);
                    results.push({ status: 'uploaded', name: pf.name, path: vfs.toVirtual(fileOs) });
                } catch (e: any) {
                    results.push({ status: 'error', name: pf.name, error: e.message });
                }
            }
            return { results };
        } catch (error: any) {
            return reply.code(error.statusCode ?? 500).send({ error: error.message });
        }
    });


    // ── GET /files/preview/csv ───────────────────────────────────────────────
    fastify.get('/preview/csv', async (request, reply) => {
        const { path: virtualPath, limit } = request.query as { path: string; limit?: string };
        if (!virtualPath) return reply.code(400).send({ error: 'path is required' });
        const maxRows = Math.min(parseInt(limit || '100', 10), 10_000);
        try {
            const vfs      = getVFS();
            const filePath = vfs.resolve(virtualPath);
            const headers: string[] = [];
            const rows: string[][] = [];
            let totalRows = 0;
            let headerParsed = false;

            const parseCSVLine = (line: string): string[] => {
                const result: string[] = [];
                let current = ''; let inQuotes = false;
                for (let i = 0; i < line.length; i++) {
                    const ch = line[i];
                    if (ch === '"') {
                        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
                        else { inQuotes = !inQuotes; }
                    } else if (ch === ',' && !inQuotes) {
                        result.push(current.trim()); current = '';
                    } else { current += ch; }
                }
                result.push(current.trim());
                return result;
            };

            const { createReadStream } = await import('fs');
            const { createInterface }  = await import('readline');
            await new Promise<void>((resolve, reject) => {
                const rl = createInterface({ input: createReadStream(filePath, { encoding: 'utf-8' }), crlfDelay: Infinity });
                rl.on('line', (line: string) => {
                    if (!line.trim()) return;
                    if (!headerParsed) { headers.push(...parseCSVLine(line)); headerParsed = true; return; }
                    totalRows++;
                    if (rows.length < maxRows) rows.push(parseCSVLine(line));
                });
                rl.on('close', resolve);
                rl.on('error', reject);
            });

            if (!headerParsed) return { path: virtualPath, headers: [], rows: [], totalRows: 0 };
            return { path: virtualPath, headers, rows, totalRows };
        } catch (error: any) {
            return reply.code(error.statusCode ?? 500).send({ error: error.message });
        }
    });

    // ── GET /files/preview/excel ─────────────────────────────────────────────
    fastify.get('/preview/excel', async (request, reply) => {
        const { path: virtualPath, sheet, limit } = request.query as { path: string; sheet?: string; limit?: string };
        if (!virtualPath) return reply.code(400).send({ error: 'path is required' });
        const maxRows = Math.min(parseInt(limit || '100', 10), 10_000);
        try {
            const vfs      = getVFS();
            const filePath = vfs.resolve(virtualPath);
            const { Worker } = await import('worker_threads');
            const workerUrl  = new URL('../workers/xlsxWorker.js', import.meta.url);
            const workerPath = fileURLToPath(workerUrl);
            const result = await new Promise<any>((resolve, reject) => {
                const worker = new Worker(workerPath, { workerData: { filePath, sheet, maxRows } });
                worker.once('message', resolve);
                worker.once('error',   reject);
            });
            if (!result.ok) return reply.code(500).send({ error: result.error });
            return { path: virtualPath, ...result };
        } catch (error: any) {
            return reply.code(error.statusCode ?? 500).send({ error: error.message });
        }
    });

    // ── GET /files/octoml/read ──────────────────────────────────────────────
    // Read a file from the hidden .octoml directory (chat history, memory, etc.)
    fastify.get(`/${OCTOML_DIR}/read`, async (request, reply) => {
        const { file } = request.query as { file: string };
        if (!file) return reply.code(400).send({ error: 'file param required' });
        try {
            const proj = projectStore.getCurrentProject();
            if (!proj) return reply.code(400).send({ error: 'No project open' });
            const filePath = path.join(proj.path, OCTOML_DIR, file);
            // Ensure it stays within .octoml
            const octomlRoot = path.join(proj.path, OCTOML_DIR);
            if (!path.resolve(filePath).startsWith(path.resolve(octomlRoot))) {
                return reply.code(403).send({ error: 'Access denied' });
            }
            if (!(await fs.pathExists(filePath))) return reply.code(404).send({ error: 'Not found' });
            const content = await fs.readFile(filePath, 'utf-8');
            return { content };
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });

    // ── POST /files/octoml/write ────────────────────────────────────────────
    fastify.post(`/${OCTOML_DIR}/write`, async (request, reply) => {
        const { file, content } = request.body as { file: string; content: string };
        if (!file) return reply.code(400).send({ error: 'file param required' });
        try {
            const proj = projectStore.getCurrentProject();
            if (!proj) return reply.code(400).send({ error: 'No project open' });
            const filePath   = path.join(proj.path, OCTOML_DIR, file);
            const octomlRoot = path.join(proj.path, OCTOML_DIR);
            if (!path.resolve(filePath).startsWith(path.resolve(octomlRoot))) {
                return reply.code(403).send({ error: 'Access denied' });
            }
            await fs.ensureDir(path.dirname(filePath));
            await fs.writeFile(filePath, content, 'utf-8');
            return { status: 'written', file };
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });
}
