import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        strictPort: true,
        host: '0.0.0.0',
        proxy: {
          // Canvas API proxy — routes requests server-side so the browser never
          // sees a cross-origin response. The actual Canvas domain is supplied by
          // the client in the x-canvas-base header so any institution URL works.
          '/canvas-proxy': {
            target: 'https://canvas.instructure.com', // fallback; overridden per-request
            router: (req) =>
              (req.headers['x-canvas-base'] as string) || 'https://canvas.instructure.com',
            changeOrigin: true,
            secure: true,
            rewrite: (path) => path.replace(/^\/canvas-proxy/, ''),
          },
        },
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
