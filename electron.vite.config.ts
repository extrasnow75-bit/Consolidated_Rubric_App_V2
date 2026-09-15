import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import type { Plugin } from 'vite'

/**
 * Content-Security-Policy for the packaged renderer.
 *
 * `connect-src 'none'` is the load-bearing directive, and it is the reason every network call in
 * this app lives in the main process. A Canvas access token acts as the instructor who issued it
 * — enrollments, submissions, grades, student names and SIS IDs across every course they teach —
 * so the question that matters is not whether the renderer can be compromised but what a
 * compromised renderer could do with what it finds. With no socket available to it, the answer is
 * nothing: no fetch, no XHR, no WebSocket, no beacon.
 *
 * It is not airtight and should not be described as such. CSP does not govern top-level
 * navigation, so `will-navigate` is a separate exfiltration route — see `openExternalSafely` in
 * electron/main.ts, which answers it with a host allowlist rather than the usual "http(s) is
 * fine" check.
 *
 * `style-src` needs 'unsafe-inline' because React writes `style={{…}}` as inline style
 * attributes. `img-src` allows data: URIs for the small assets Vite inlines and for the
 * screenshot previews the converter renders from local files.
 *
 * Injected at build time only. The dev server needs a websocket for HMR and serves inline module
 * scripts, so applying this policy there would just break `npm run dev`.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

function cspPlugin(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}">`,
      )
    },
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload.ts') },
      },
    },
  },
  renderer: {
    root: '.',
    resolve: {
      alias: { '@': resolve(__dirname, '.') },
    },
    server: {
      watch: {
        // Once electron-builder has run, `release/` holds ~100 MB of packaged Electron files.
        // Watching them makes the dev server fire an endless HMR reload storm on files that are
        // not sources.
        ignored: ['**/release/**', '**/out/**'],
      },
    },
    plugins: [react(), cspPlugin()],
    build: {
      minify: true,
      rollupOptions: {
        input: { index: resolve(__dirname, 'index.html') },
      },
    },
  },
})
