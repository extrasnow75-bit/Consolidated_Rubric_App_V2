import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';

/**
 * SSRF guard for the Canvas proxy.
 *
 * Returns true (= blocked) when the supplied URL string:
 *  - is not a valid URL
 *  - uses a non-HTTPS scheme
 *  - resolves to localhost, a loopback address, or a private/link-local
 *    IPv4 range (RFC 1918 + 169.254.0.0/16 AWS metadata endpoint)
 */
const isBlockedProxyTarget = (urlStr: string): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return true; // unparseable → block
  }
  if (parsed.protocol !== 'https:') return true; // HTTP or anything else → block
  const h = parsed.hostname;
  // Loopback / localhost
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  // Private IPv4 ranges
  const oct = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (oct) {
    const [, a, b] = oct.map(Number);
    if (a === 10) return true;                         // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
    if (a === 192 && b === 168) return true;            // 192.168.0.0/16
    if (a === 169 && b === 254) return true;            // 169.254.0.0/16 (link-local / AWS metadata)
    if (a === 0) return true;                           // 0.0.0.0/8
  }
  return false;
};

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

      // SSRF protection: reject non-HTTPS and private/internal targets
      if (isBlockedProxyTarget(canvasBase)) {
        res.statusCode = 403;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Canvas proxy: only HTTPS requests to external hosts are permitted' }));
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
      headers: {
        // Prevent clickjacking
        'X-Frame-Options': 'DENY',
        // Block MIME-type sniffing
        'X-Content-Type-Options': 'nosniff',
        // Limit referrer information sent to third-party origins
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        // Content Security Policy — dev variant includes ws/wss for Vite HMR
        'Content-Security-Policy': [
          "default-src 'self'",
          // React + Vite module scripts; Tailwind CDN; Google API loader
          "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://apis.google.com",
          // Tailwind runtime injects inline styles; Google Fonts stylesheet
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          // Google profile pictures
          "img-src 'self' https://lh3.googleusercontent.com data: blob:",
          // Google Fonts glyphs
          "font-src 'self' https://fonts.gstatic.com",
          // All API endpoints the app calls + Vite HMR websocket
          "connect-src 'self'" +
            " https://generativelanguage.googleapis.com" +
            " https://accounts.google.com" +
            " https://oauth2.googleapis.com" +
            " https://www.googleapis.com" +
            " https://content.googleapis.com" +
            " https://drive.google.com" +
            " https://*.instructure.com" +
            " https://*.firebaseapp.com" +
            " https://identitytoolkit.googleapis.com" +
            " https://securetoken.googleapis.com" +
            " ws://localhost:* wss://localhost:*",
          // No iframes or plugins
          "frame-src 'none'",
          "object-src 'none'",
          // Lock down base tag hijacking
          "base-uri 'self'",
        ].join('; '),
      },
    },
    plugins: [react(), canvasProxyPlugin()],
    // NOTE: Do NOT add `define` entries for GEMINI_API_KEY or any other secret.
    // Vite `define` inlines values into the client bundle where they are
    // publicly visible. The app collects the Gemini key from the user at
    // runtime via the Dashboard — no build-time secret injection is needed.
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
