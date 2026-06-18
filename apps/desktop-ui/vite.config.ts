import * as path from 'path';
import * as fs from 'fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const svgAsStringPlugin = () => ({
  name: 'svg-as-string',
  enforce: 'pre' as const,
  configureServer(server: any) {
    server.middlewares.use(async (req: any, res: any, next: any) => {
      if (req.url && req.url.includes('.svg')) {
        // Only process if it's a raw SVG request (no ?import)
        const [urlPath, query] = req.url.split('?');
        if (query && query.includes('import')) {
          return next();
        }
        try {
          let filePath = urlPath;
          if (urlPath.startsWith('/@fs/')) {
            // Strip /@fs/ and decode
            filePath = urlPath.slice(4); // slice(4) to keep the leading slash for Unix, wait: /@fs/C:/... -> C:/...
            if (filePath.match(/^\/[A-Za-z]:\//)) {
              // Windows drive with leading slash: /C:/ -> C:/
              filePath = filePath.slice(1);
            }
          } else {
            // relative to project root
            filePath = path.join(process.cwd(), urlPath);
          }
          if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            res.setHeader('Content-Type', 'application/javascript');
            res.end(`export default ${JSON.stringify(content)};`);
            return;
          }
        } catch (e) {
          console.error(e);
        }
      }
      next();
    });
  },
  async load(id: string) {
    const cleanId = id.split('?')[0];
    if (cleanId.endsWith('.svg')) {
      const content = await fs.promises.readFile(cleanId, 'utf-8');
      return `export default ${JSON.stringify(content)}`;
    }
  }
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: './',
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [react(), svgAsStringPlugin()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      '__webpack_public_path__': JSON.stringify('')
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      }
    },
    optimizeDeps: {
      // Pre-bundle CJS jupyter-widgets packages into ESM so Vite can import them
      include: [
        '@jupyter-widgets/base',
        '@jupyter-widgets/base-manager',
        '@jupyter-widgets/controls',
        '@jupyter-widgets/html-manager',
        '@jupyter-widgets/output',
        '@jupyterlab/ui-components',
      ],
      esbuildOptions: {
        loader: {
          '.svg': 'text'
        }
      }
    },
  };
});
