import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Custom Canvas proxy plugin.
 *
 * Vite's built-in proxy uses http-proxy whose `router` option has inconsistent
 * behaviour across versions and environments. This plugin adds an express-style
 * middleware that handles every /canvas-proxy/* request directly with Node's
 * native fetch, giving us full control over target selection and headers.
 *
 * The client sends the real Canvas base URL in the `x-canvas-base` header
 * (e.g. "https://boisestate.instructure.com") so a single dev server can
 * reach any institution without changing config.
 */
const canvasProxyPlugin = (): Plugin => ({
  name: 'canvas-dynamic-proxy',
  configureServer(server) {
    server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
      if (!req.url?.startsWith('/canvas-proxy')) return next();

      const rawBase = req.headers['x-canvas-base'];
      const canvasBase = Array.isArray(rawBase) ? rawBase[0] : rawBase;

      if (!canvasBase) {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Missing x-canvas-base header' }));
        return;
      }

      const urlPath = req.url.replace(/^\/canvas-proxy/, '') || '/';
      const targetUrl = `${canvasBase.replace(/\/$/, '')}${urlPath}`;

      // Collect request body
      const body: Buffer = await new Promise((resolve) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
      });

      // Build forwarded headers — strip hop-by-hop and proxy-specific ones
      const skipReqHeaders = new Set([
        'host', 'x-canvas-base', 'connection',
        'content-length', 'transfer-encoding',
      ]);
      const forwardHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (skipReqHeaders.has(k.toLowerCase())) continue;
        forwardHeaders[k] = Array.isArray(v) ? v.join(', ') : (v ?? '');
      }
      try { forwardHeaders['host'] = new URL(canvasBase).host; } catch { /* ignore */ }

      try {
        const response = await fetch(targetUrl, {
          method: req.method ?? 'GET',
          headers: forwardHeaders,
          // omit body for GET/HEAD (fetch throws on body + these methods)
          body: body.length > 0 && !['GET', 'HEAD'].includes(req.method ?? 'GET')
            ? body
            : undefined,
        });

        res.statusCode = response.status;

        // Forward response headers, stripping ones that would confuse the browser
        const skipResHeaders = new Set([
          'transfer-encoding', 'connection',
          // fetch (Undici) decompresses automatically, so drop the encoding label
          'content-encoding',
          // we set the real length below after decompression
          'content-length',
        ]);
        response.headers.forEach((v, k) => {
          if (!skipResHeaders.has(k.toLowerCase())) res.setHeader(k, v);
        });

        const buffer = Buffer.from(await response.arrayBuffer());
        res.setHeader('content-length', buffer.length);
        res.end(buffer);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (!res.headersSent) {
          res.statusCode = 502;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: `Canvas proxy error: ${message}` }));
        }
      }
    });
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3001,
      strictPort: false,
      host: '0.0.0.0',
    },
    plugins: [react(), canvasProxyPlugin()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
