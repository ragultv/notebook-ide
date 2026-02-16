import { FastifyInstance } from 'fastify';
import fs from 'fs-extra';
import path from 'path';

export async function filesRoutes(fastify: FastifyInstance) {
    fastify.get('/list', async (request, reply) => {
        const { path: queryPath } = request.query as { path?: string };
        const targetPath = queryPath ? path.resolve(queryPath) : process.cwd();

        try {
            const stats = await fs.stat(targetPath);
            if (!stats.isDirectory()) {
                reply.code(400).send({ error: 'Path is not a directory' });
                return;
            }

            const items = await fs.readdir(targetPath, { withFileTypes: true });
            const result = await Promise.all(items.map(async (item) => {
                const itemPath = path.join(targetPath, item.name);
                let size = 0;
                if (item.isFile()) {
                    const s = await fs.stat(itemPath);
                    size = s.size;
                }

                return {
                    name: item.name,
                    path: itemPath,
                    type: item.isDirectory() ? 'directory' : 'file',
                    size
                };
            }));

            return { path: targetPath, items: result };
        } catch (error: any) {
            reply.code(500).send({ error: error.message });
        }
    });

    fastify.get('/read', async (request, reply) => {
        const { path: queryPath } = request.query as { path: string };

        try {
            const content = await fs.readFile(queryPath, 'utf-8');
            const stats = await fs.stat(queryPath);
            return { path: queryPath, content, size: stats.size };
        } catch (error: any) {
            reply.code(500).send({ error: error.message });
        }
    });

    fastify.post('/save', async (request, reply) => {
        const { path: filePath, content } = request.body as { path: string, content: string };

        try {
            await fs.writeFile(filePath, content);
            const stats = await fs.stat(filePath);
            return { status: 'saved', path: filePath, size: stats.size };
        } catch (error: any) {
            reply.code(500).send({ error: error.message });
        }
    });
}
