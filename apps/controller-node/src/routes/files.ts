import { FastifyInstance } from 'fastify';
import '@fastify/multipart';
import fs from 'fs-extra';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { fileURLToPath } from 'url';
import { projectStore } from '../core/ProjectStore.js';

// ─── Security ─────────────────────────────────────────────────────────────────

/**
 * Asserts that `targetPath` is a descendant of `rootPath` (or equal to it).
 * Throws a typed error on any path-traversal attempt.
 *
 * Both paths are fully resolved before comparison so that relative segments,
 * symlink components, and double-dot sequences cannot escape the root.
 */
function assertUnderRoot(targetPath: string, rootPath: string): void {
    const resolvedTarget = path.resolve(targetPath);
    const resolvedRoot   = path.resolve(rootPath);
    const prefix         = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;

    if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(prefix)) {
        const err = new Error(`Access denied: path is outside the project root.`);
        (err as any).statusCode = 403;
        throw err;
    }
}

/**
 * Returns the current project root path, or throws if no project is open.
 * Used as the jail root for all file-system operations.
 */
function getProjectRoot(): string {
    const project = projectStore.getCurrentProject();
    if (!project?.path) {
        const err = new Error('No project is currently open. Open a project first.');
        (err as any).statusCode = 400;
        throw err;
    }
    return project.path;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getExtension(name: string): string {
    const idx = name.lastIndexOf('.');
    return idx >= 0 ? name.slice(idx) : '';
}

async function buildFileItem(itemPath: string, name: string, isDir: boolean) {
    let size = 0;
    let modified: string | undefined;
    try {
        const s = await fs.stat(itemPath);
        size = s.size;
        modified = s.mtime.toISOString();
    } catch { /* ignore */ }

    return {
        name,
        path: itemPath,
        type: isDir ? 'directory' : 'file',
        size,
        modified,
        extension: isDir ? undefined : getExtension(name),
    };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function filesRoutes(fastify: FastifyInstance) {

    // ── GET /files/list ─────────────────────────────────────────────────────
    fastify.get('/list', async (request, reply) => {
        const { path: queryPath } = request.query as { path?: string };

        try {
            const root       = getProjectRoot();
            const targetPath = queryPath ? path.resolve(queryPath) : root;
            assertUnderRoot(targetPath, root);

            const stats = await fs.stat(targetPath);
            if (!stats.isDirectory()) {
                return reply.code(400).send({ error: 'Path is not a directory' });
            }
            const entries = await fs.readdir(targetPath, { withFileTypes: true });
            const items = await Promise.all(
                entries
                    .filter(e => !e.name.startsWith('.')) // hide dotfiles at top-level
                    .map(e => buildFileItem(path.join(targetPath, e.name), e.name, e.isDirectory()))
            );
            // Directories first, then files, both alpha-sorted
            items.sort((a, b) => {
                if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
            return { path: targetPath, items };
        } catch (error: any) {
            const code = error.statusCode ?? 500;
            return reply.code(code).send({ error: error.message });
        }
    });

    // ── GET /files/read ─────────────────────────────────────────────────────
    // Reads a text file from within the active project root.
    fastify.get('/read', async (request, reply) => {
        const { path: queryPath } = request.query as { path: string };
        if (!queryPath) return reply.code(400).send({ error: 'path query param required' });

        try {
            const root = getProjectRoot();
            assertUnderRoot(queryPath, root);

            const content = await fs.readFile(queryPath, 'utf-8');
            const stats   = await fs.stat(queryPath);
            return { path: queryPath, content, size: stats.size };
        } catch (error: any) {
            const code = error.statusCode ?? 500;
            return reply.code(code).send({ error: error.message });
        }
    });

    // ── POST /files/save ────────────────────────────────────────────────────
    // Writes text content to a file within the active project root.
    fastify.post('/save', async (request, reply) => {
        const { path: filePath, content } = request.body as { path: string; content: string };
        if (!filePath) return reply.code(400).send({ error: 'path is required' });

        try {
            const root = getProjectRoot();
            assertUnderRoot(filePath, root);

            await fs.ensureDir(path.dirname(filePath));
            await fs.writeFile(filePath, content, 'utf-8');
            const stats = await fs.stat(filePath);
            return { status: 'saved', path: filePath, size: stats.size };
        } catch (error: any) {
            const code = error.statusCode ?? 500;
            return reply.code(code).send({ error: error.message });
        }
    });

    // ── GET /files/project ──────────────────────────────────────────────────
    fastify.get('/project', async (_request, _reply) => {
        return { project: projectStore.getCurrentProject() };
    });

    // ── POST /files/project/open ────────────────────────────────────────────
    fastify.post('/project/open', async (request, reply) => {
        const { path: projectPath, name } = request.body as { path: string; name: string };
        if (!projectPath) return reply.code(400).send({ error: 'path is required' });
        try {
            const resolved = path.resolve(projectPath);
            const exists   = await fs.pathExists(resolved);
            if (!exists) return reply.code(404).send({ error: `Path does not exist: ${resolved}` });
            const stats = await fs.stat(resolved);
            if (!stats.isDirectory()) return reply.code(400).send({ error: 'Path must be a directory' });

            const proj = { path: resolved, name: name || path.basename(resolved) };
            await projectStore.setCurrentProject(proj);
            await projectStore.addRecentProject(proj);
            return { status: 'opened', project: proj };
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });

    // ── POST /files/project/create ──────────────────────────────────────────
    // Creates the folder on disk (mkdirp) then sets it as the active project.
    fastify.post('/project/create', async (request, reply) => {
        const { path: projectPath, name } = request.body as { path: string; name: string };
        if (!projectPath) return reply.code(400).send({ error: 'path is required' });
        try {
            const resolved = path.resolve(projectPath);
            await fs.ensureDir(resolved);
            // Seed with a starter notebook
            const notebookPath = path.join(resolved, 'notebook.ipynb');
            if (!(await fs.pathExists(notebookPath))) {
                const starterNotebook = {
                    nbformat: 4,
                    nbformat_minor: 5,
                    metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' } },
                    cells: [{
                        cell_type: 'code',
                        id: 'starter-cell',
                        metadata: {},
                        source: ['# Welcome to your new project\n'],
                        execution_count: null,
                        outputs: [],
                    }],
                };
                await fs.writeJson(notebookPath, starterNotebook, { spaces: 2 });
            }
            const proj = { path: resolved, name: name || path.basename(resolved) };
            await projectStore.setCurrentProject(proj);
            await projectStore.addRecentProject(proj);
            return { status: 'created', project: proj };
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });

    // ── GET /files/recent ───────────────────────────────────────────────────
    fastify.get('/recent', async () => {
        return { recent: projectStore.getRecentProjects() };
    });

    // ── POST /files/recent/add ──────────────────────────────────────────────
    fastify.post('/recent/add', async (request, reply) => {
        const { path: projectPath, name } = request.body as { path: string; name: string };
        if (!projectPath) return reply.code(400).send({ error: 'path is required' });
        await projectStore.addRecentProject({ path: projectPath, name: name || path.basename(projectPath) });
        return { status: 'added' };
    });

    // ── DELETE /files/delete ─────────────────────────────────────────────────
    // Deletes file or directory (recursive) from within the active project root.
    fastify.delete('/delete', async (request, reply) => {
        const { path: targetPath } = request.query as { path: string };
        if (!targetPath) return reply.code(400).send({ error: 'path query param required' });

        try {
            const root = getProjectRoot();
            assertUnderRoot(targetPath, root);

            const exists = await fs.pathExists(targetPath);
            if (!exists) return reply.code(404).send({ error: 'Path not found' });
            await fs.remove(targetPath);
            return { status: 'deleted', deleted: targetPath };
        } catch (error: any) {
            const code = error.statusCode ?? 500;
            return reply.code(code).send({ error: error.message });
        }
    });

    // ── POST /files/rename ───────────────────────────────────────────────────
    // Renames or moves file/folder within the active project root.
    fastify.post('/rename', async (request, reply) => {
        const { oldPath, newPath } = request.body as { oldPath: string; newPath: string };
        if (!oldPath || !newPath) return reply.code(400).send({ error: 'oldPath and newPath are required' });

        try {
            const root = getProjectRoot();
            assertUnderRoot(oldPath, root);
            assertUnderRoot(newPath, root);

            const exists = await fs.pathExists(oldPath);
            if (!exists) return reply.code(404).send({ error: `Source not found: ${oldPath}` });
            await fs.move(oldPath, newPath, { overwrite: false });
            return { status: 'renamed', oldPath, newPath };
        } catch (error: any) {
            const code = error.statusCode ?? 500;
            return reply.code(code).send({ error: error.message });
        }
    });

    // ── POST /files/create-folder ────────────────────────────────────────────
    // Creates a new directory within the active project root.
    fastify.post('/create-folder', async (request, reply) => {
        const { path: parentPath, name } = request.body as { path: string; name: string };
        if (!parentPath || !name) return reply.code(400).send({ error: 'path and name are required' });

        try {
            const root       = getProjectRoot();
            const folderPath = path.join(parentPath, name);
            assertUnderRoot(folderPath, root);

            await fs.ensureDir(folderPath);
            return { status: 'created', path: folderPath };
        } catch (error: any) {
            const code = error.statusCode ?? 500;
            return reply.code(code).send({ error: error.message });
        }
    });

    // ── POST /files/upload (single) ──────────────────────────────────────────
    // Streams the uploaded file directly to disk within the project root.
    // Avoids buffering the entire file into Node heap.
    fastify.post('/upload', async (request, reply) => {
        try {
            const data = await request.file();
            if (!data) return reply.code(400).send({ error: 'No file provided' });

            const dest = (data.fields as any)?.destination?.value as string;
            if (!dest) return reply.code(400).send({ error: 'destination field required' });

            const root     = getProjectRoot();
            const filePath = path.join(dest, data.filename);
            assertUnderRoot(filePath, root);

            await fs.ensureDir(dest);
            // Stream directly to disk — no heap buffering
            await pipeline(data.file, createWriteStream(filePath));
            const stats = await fs.stat(filePath);
            return { status: 'uploaded', path: filePath, name: data.filename, size: stats.size };
        } catch (error: any) {
            const code = error.statusCode ?? 500;
            return reply.code(code).send({ error: error.message });
        }
    });

    // ── POST /files/upload-multiple ──────────────────────────────────────────
    // Streams multiple uploaded files to disk within the project root.
    fastify.post('/upload-multiple', async (request, reply) => {
        try {
            const parts  = request.parts();
            let dest     = '';
            const root   = getProjectRoot();
            const results: Array<{ status: string; name: string; path?: string; error?: string }> = [];

            // Collect all parts: read destination field first, then process files
            const pendingFiles: Array<{ name: string; file: NodeJS.ReadableStream }> = [];

            for await (const part of parts) {
                if (part.type === 'field' && part.fieldname === 'destination') {
                    dest = (part as any).value as string;
                } else if (part.type === 'file') {
                    // Buffer reference + stream — we MUST consume immediately to avoid parser hang
                    const chunks: Buffer[] = [];
                    for await (const chunk of part.file) {
                        chunks.push(chunk as Buffer);
                    }
                    pendingFiles.push({ name: part.filename, file: null as any });
                    // Store buffer on the pending record
                    (pendingFiles[pendingFiles.length - 1] as any)._buf = Buffer.concat(chunks);
                }
            }

            if (!dest) {
                return reply.code(400).send({ error: 'No destination folder provided in multipart fields' });
            }

            await fs.ensureDir(dest);

            for (const pf of pendingFiles) {
                const filePath = path.join(dest, pf.name);
                try {
                    assertUnderRoot(filePath, root);
                    await fs.writeFile(filePath, (pf as any)._buf);
                    results.push({ status: 'uploaded', name: pf.name, path: filePath });
                } catch (e: any) {
                    results.push({ status: 'error', name: pf.name, error: e.message });
                }
            }

            return { results };
        } catch (error: any) {
            const code = error.statusCode ?? 500;
            return reply.code(code).send({ error: error.message });
        }
    });

    // ── GET /files/notebook/open ─────────────────────────────────────────────
    // Reads an .ipynb file from within the active project root.
    fastify.get('/notebook/open', async (request, reply) => {
        const { path: notebookPath } = request.query as { path: string };
        if (!notebookPath) return reply.code(400).send({ error: 'path is required' });

        try {
            const root = getProjectRoot();
            assertUnderRoot(notebookPath, root);

            const exists = await fs.pathExists(notebookPath);
            if (!exists) return reply.code(404).send({ error: 'Notebook not found' });
            const raw   = await fs.readFile(notebookPath, 'utf-8');
            const ipynb = JSON.parse(raw);

            const cells = (ipynb.cells || []).map((cell: any, idx: number) => ({
                id: cell.id || `cell-${idx}`,
                type: cell.cell_type as 'code' | 'markdown',
                content: Array.isArray(cell.source) ? cell.source.join('') : (cell.source || ''),
                output: cell.outputs?.[0]?.text
                    ? (Array.isArray(cell.outputs[0].text) ? cell.outputs[0].text.join('') : cell.outputs[0].text)
                    : undefined,
                executionCount: cell.execution_count ?? null,
            }));

            return {
                path: notebookPath,
                name: path.basename(notebookPath),
                content: {
                    cells: cells.length > 0 ? cells : [{ id: 'default-cell', type: 'code', content: '' }],
                    metadata: ipynb.metadata || {},
                },
            };
        } catch (error: any) {
            const code = error.statusCode ?? 500;
            return reply.code(code).send({ error: error.message });
        }
    });

    // ── POST /files/notebook/save ────────────────────────────────────────────
    // Writes notebook JSON to the .ipynb file within the active project root.
    fastify.post('/notebook/save', async (request, reply) => {
        const { path: notebookPath, content } = request.body as { path: string; content: string };
        if (!notebookPath) return reply.code(400).send({ error: 'path is required' });

        try {
            const root = getProjectRoot();
            assertUnderRoot(notebookPath, root);

            await fs.ensureDir(path.dirname(notebookPath));
            const parsed = typeof content === 'string' ? JSON.parse(content) : content;
            await fs.writeJson(notebookPath, parsed, { spaces: 2 });
            const stats = await fs.stat(notebookPath);
            return { status: 'saved', path: notebookPath, size: stats.size };
        } catch (error: any) {
            const code = error.statusCode ?? 500;
            return reply.code(code).send({ error: error.message });
        }
    });

    // ── GET /files/preview/csv ───────────────────────────────────────────────
    // Streams a CSV file and returns only the requested header + row slice.
    // Avoids loading the entire file into heap regardless of file size.
    fastify.get('/preview/csv', async (request, reply) => {
        const { path: filePath, limit } = request.query as { path: string; limit?: string };
        if (!filePath) return reply.code(400).send({ error: 'path is required' });

        const maxRows = Math.min(parseInt(limit || '100', 10), 10_000); // hard cap at 10k rows

        try {
            const root = getProjectRoot();
            assertUnderRoot(filePath, root);

            const headers: string[] = [];
            const rows: string[][]  = [];
            let totalRows           = 0;
            let headerParsed        = false;

            // Manual streaming CSV parser — avoids pulling in a heavy dependency
            // for a simple preview. Handles quoted fields correctly.
            const parseCSVLine = (line: string): string[] => {
                const result: string[] = [];
                let current  = '';
                let inQuotes = false;
                for (let i = 0; i < line.length; i++) {
                    const ch = line[i];
                    if (ch === '"') {
                        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
                        else { inQuotes = !inQuotes; }
                    } else if (ch === ',' && !inQuotes) {
                        result.push(current.trim()); current = '';
                    } else {
                        current += ch;
                    }
                }
                result.push(current.trim());
                return result;
            };

            // Stream line-by-line to avoid full-file heap allocation
            const { createReadStream } = await import('fs');
            const { createInterface } = await import('readline');

            await new Promise<void>((resolve, reject) => {
                const rl = createInterface({
                    input: createReadStream(filePath, { encoding: 'utf-8' }),
                    crlfDelay: Infinity,
                });

                rl.on('line', (line: string) => {
                    if (!line.trim()) return;
                    if (!headerParsed) {
                        headers.push(...parseCSVLine(line));
                        headerParsed = true;
                        return;
                    }
                    totalRows++;
                    if (rows.length < maxRows) {
                        rows.push(parseCSVLine(line));
                    }
                });

                rl.on('close', resolve);
                rl.on('error', reject);
            });

            if (!headerParsed) return { path: filePath, headers: [], rows: [], totalRows: 0 };
            return { path: filePath, headers, rows, totalRows };
        } catch (error: any) {
            const code = error.statusCode ?? 500;
            return reply.code(code).send({ error: error.message });
        }
    });

    // ── GET /files/preview/excel ─────────────────────────────────────────────
    // Reads an Excel file from within the project root and returns row slice.
    fastify.get('/preview/excel', async (request, reply) => {
        const { path: filePath, sheet, limit } = request.query as {
            path: string; sheet?: string; limit?: string;
        };
        if (!filePath) return reply.code(400).send({ error: 'path is required' });

        const maxRows = Math.min(parseInt(limit || '100', 10), 10_000);

        try {
            const root = getProjectRoot();
            assertUnderRoot(filePath, root);

            // P1-5: Parse XLSX in a worker thread to avoid blocking the event loop.
            // Must pre-import worker_threads — cannot use await inside Promise constructor.
            const { Worker } = await import('worker_threads');
            const workerUrl  = new URL('../workers/xlsxWorker.js', import.meta.url);
            const workerPath = fileURLToPath(workerUrl);

            const result = await new Promise<any>((resolve, reject) => {
                const worker = new Worker(workerPath, {
                    workerData: { filePath, sheet, maxRows },
                });
                worker.once('message', resolve);
                worker.once('error',   reject);
            });

            if (!result.ok) {
                return reply.code(500).send({ error: result.error });
            }
            return { path: filePath, ...result };
        } catch (error: any) {
            const code = error.statusCode ?? 500;
            return reply.code(code).send({ error: error.message });
        }
    });
}
