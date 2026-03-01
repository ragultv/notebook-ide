import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [react()],
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
      ],
    },
  };
});
