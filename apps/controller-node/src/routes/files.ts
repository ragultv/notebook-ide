import { FastifyInstance } from 'fastify';
import '@fastify/multipart';
import fs from 'fs-extra';
import path from 'path';
import { projectStore } from '../core/ProjectStore.js';

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
        const targetPath = queryPath ? path.resolve(queryPath) : process.cwd();

        try {
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
            return reply.code(500).send({ error: error.message });
        }
    });

    // ── GET /files/read ─────────────────────────────────────────────────────
    // Reads ANY file from disk and returns raw text content.
    fastify.get('/read', async (request, reply) => {
        const { path: queryPath } = request.query as { path: string };
        if (!queryPath) return reply.code(400).send({ error: 'path query param required' });
        try {
            const content = await fs.readFile(queryPath, 'utf-8');
            const stats = await fs.stat(queryPath);
            return { path: queryPath, content, size: stats.size };
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });

    // ── POST /files/save ────────────────────────────────────────────────────
    // Writes text content to the REAL file on disk at the given absolute path.
    fastify.post('/save', async (request, reply) => {
        const { path: filePath, content } = request.body as { path: string; content: string };
        if (!filePath) return reply.code(400).send({ error: 'path is required' });
        try {
            await fs.ensureDir(path.dirname(filePath)); // create parent dirs if needed
            await fs.writeFile(filePath, content, 'utf-8');
            const stats = await fs.stat(filePath);
            return { status: 'saved', path: filePath, size: stats.size };
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
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
            const exists = await fs.pathExists(resolved);
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
            await fs.ensureDir(resolved); // creates folder + any parent dirs on disk
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
    // Deletes file or directory (recursive) from disk.
    fastify.delete('/delete', async (request, reply) => {
        const { path: targetPath } = request.query as { path: string };
        if (!targetPath) return reply.code(400).send({ error: 'path query param required' });
        try {
            const exists = await fs.pathExists(targetPath);
            if (!exists) return reply.code(404).send({ error: 'Path not found' });
            await fs.remove(targetPath); // removes file or entire directory tree
            return { status: 'deleted', deleted: targetPath };
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });

    // ── POST /files/rename ───────────────────────────────────────────────────
    // Renames or moves file/folder on disk.
    fastify.post('/rename', async (request, reply) => {
        const { oldPath, newPath } = request.body as { oldPath: string; newPath: string };
        if (!oldPath || !newPath) return reply.code(400).send({ error: 'oldPath and newPath are required' });
        try {
            const exists = await fs.pathExists(oldPath);
            if (!exists) return reply.code(404).send({ error: `Source not found: ${oldPath}` });
            await fs.move(oldPath, newPath, { overwrite: false });
            return { status: 'renamed', oldPath, newPath };
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });

    // ── POST /files/create-folder ────────────────────────────────────────────
    // Creates a new directory on disk.
    fastify.post('/create-folder', async (request, reply) => {
        const { path: parentPath, name } = request.body as { path: string; name: string };
        if (!parentPath || !name) return reply.code(400).send({ error: 'path and name are required' });
        try {
            const folderPath = path.join(parentPath, name);
            await fs.ensureDir(folderPath);
            return { status: 'created', path: folderPath };
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });

    // ── POST /files/upload (single) ──────────────────────────────────────────
    // Saves the uploaded file bytes to the destination folder on disk.
    fastify.post('/upload', async (request, reply) => {
        try {
            const data = await request.file();
            if (!data) return reply.code(400).send({ error: 'No file provided' });

            const dest = (data.fields as any)?.destination?.value as string;
            if (!dest) return reply.code(400).send({ error: 'destination field required' });

            await fs.ensureDir(dest);
            const filePath = path.join(dest, data.filename);
            await fs.ensureDir(path.dirname(filePath));
            await fs.writeFile(filePath, await data.toBuffer());
            const stats = await fs.stat(filePath);
            return { status: 'uploaded', path: filePath, name: data.filename, size: stats.size };
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });

    // ── POST /files/upload-multiple ──────────────────────────────────────────
    // Saves multiple uploaded files to the destination folder on disk.
    fastify.post('/upload-multiple', async (request, reply) => {
        try {
            const parts = request.parts();
            let dest = '';
            const filesToSave: Array<{ name: string; buffer: Buffer }> = [];
            const results: Array<{ status: string; name: string; path?: string; error?: string }> = [];

            for await (const part of parts) {
                if (part.type === 'field' && part.fieldname === 'destination') {
                    dest = (part as any).value as string;
                } else if (part.type === 'file') {
                    // Always consume the stream to avoid hanging the multipart parser
                    try {
                        filesToSave.push({
                            name: part.filename,
                            buffer: await part.toBuffer()
                        });
                    } catch (e: any) {
                        results.push({ status: 'error', name: part.filename, error: `Failed to buffer: ${e.message}` });
                    }
                }
            }

            if (!dest) {
                return reply.code(400).send({ error: 'No destination folder provided in multipart fields' });
            }

            // After all parts are processed, we have the 'dest' and all file buffers
            await fs.ensureDir(dest);
            for (const file of filesToSave) {
                try {
                    const filePath = path.join(dest, file.name);
                    await fs.writeFile(filePath, file.buffer);
                    results.push({ status: 'uploaded', name: file.name, path: filePath });
                } catch (e: any) {
                    results.push({ status: 'error', name: file.name, error: e.message });
                }
            }

            return { results };
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });

    // ── GET /files/notebook/open ─────────────────────────────────────────────
    // Reads an .ipynb file from disk and returns parsed notebook content.
    fastify.get('/notebook/open', async (request, reply) => {
        const { path: notebookPath } = request.query as { path: string };
        if (!notebookPath) return reply.code(400).send({ error: 'path is required' });
        try {
            const exists = await fs.pathExists(notebookPath);
            if (!exists) return reply.code(404).send({ error: 'Notebook not found' });
            const raw = await fs.readFile(notebookPath, 'utf-8');
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
            return reply.code(500).send({ error: error.message });
        }
    });

    // ── POST /files/notebook/save ────────────────────────────────────────────
    // Writes notebook JSON to the REAL .ipynb file on disk.
    fastify.post('/notebook/save', async (request, reply) => {
        const { path: notebookPath, content } = request.body as { path: string; content: string };
        if (!notebookPath) return reply.code(400).send({ error: 'path is required' });
        try {
            await fs.ensureDir(path.dirname(notebookPath)); // create parent dirs if needed
            // `content` may be a JSON string or already an object
            const parsed = typeof content === 'string' ? JSON.parse(content) : content;
            await fs.writeJson(notebookPath, parsed, { spaces: 2 }); // writes to real file on disk
            const stats = await fs.stat(notebookPath);
            return { status: 'saved', path: notebookPath, size: stats.size };
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });

    // ── GET /files/preview/csv ───────────────────────────────────────────────
    // Reads a CSV file from disk and returns headers + rows as JSON.
    fastify.get('/preview/csv', async (request, reply) => {
        const { path: filePath, limit } = request.query as { path: string; limit?: string };
        if (!filePath) return reply.code(400).send({ error: 'path is required' });
        const maxRows = parseInt(limit || '100', 10);
        try {
            const raw = await fs.readFile(filePath, 'utf-8');
            const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
            if (lines.length === 0) return { path: filePath, headers: [], rows: [], totalRows: 0 };

            const parseCSVLine = (line: string): string[] => {
                const result: string[] = [];
                let current = '';
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

            const headers = parseCSVLine(lines[0]);
            const dataLines = lines.slice(1, maxRows + 1);
            const rows = dataLines.map(l => parseCSVLine(l));
            return { path: filePath, headers, rows, totalRows: lines.length - 1 };
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });

    // ── GET /files/preview/excel ─────────────────────────────────────────────
    // Reads an Excel file from disk and returns headers + rows as JSON.
    fastify.get('/preview/excel', async (request, reply) => {
        const { path: filePath, sheet, limit } = request.query as {
            path: string; sheet?: string; limit?: string;
        };
        if (!filePath) return reply.code(400).send({ error: 'path is required' });
        const maxRows = parseInt(limit || '100', 10);
        try {
            // Dynamic import — xlsx is an optional dependency
            const XLSX = await import('xlsx').catch(() => null);
            if (!XLSX) {
                return reply.code(501).send({ error: 'xlsx package not installed. Run: npm install xlsx' });
            }
            const workbook = XLSX.readFile(filePath);
            const sheetNames = workbook.SheetNames;
            const useSheet = sheet && sheetNames.includes(sheet) ? sheet : sheetNames[0];
            const worksheet = workbook.Sheets[useSheet];
            const jsonRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

            if (jsonRows.length === 0) {
                return { path: filePath, headers: [], rows: [], totalRows: 0, sheets: sheetNames, currentSheet: useSheet };
            }
            const headers = (jsonRows[0] as any[]).map(String);
            const rows = jsonRows.slice(1, maxRows + 1) as any[][];
            return { path: filePath, headers, rows, totalRows: jsonRows.length - 1, sheets: sheetNames, currentSheet: useSheet };
        } catch (error: any) {
            return reply.code(500).send({ error: error.message });
        }
    });
}
