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
/**
 * Hosts the renderer can still reach, and the migration state that keeps them here.
 *
 * The target is `connect-src 'none'`, and everything else is already there. What is not yet moved
 * is Gemini (still called from src/services/geminiService.ts) and Firebase Auth (still used for
 * Google sign-in). Both need a socket, so pinning this to 'none' today would not make the app
 * safer — it would just break AI generation and sign-in in packaged builds while leaving the same
 * code in the same place.
 *
 * So this list is a checklist, not a design. Each entry disappears as its caller moves to the
 * main process, and the last one to go takes `connect-src` to 'none' with it. Nothing should ever
 * be *added* here.
 *
 * Note that the Canvas hosts are already absent: Canvas calls moved to main first, because a
 * Canvas token is the one credential here that reads student records.
 */
const RENDERER_CONNECT_SRC = [
  // TODO(phase-4): remove with geminiService.ts.
  'https://generativelanguage.googleapis.com',
  // TODO(phase-3): remove with firebaseService.ts, when sign-in becomes native PKCE.
  'https://identitytoolkit.googleapis.com',
  'https://securetoken.googleapis.com',
  'https://www.googleapis.com',
  'https://oauth2.googleapis.com',
]

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.googleusercontent.com",
  "font-src 'self'",
  `connect-src ${RENDERER_CONNECT_SRC.join(' ')}`,
  "object-src 'none'",
  // Firebase Auth signs in through an iframe on its own domain. Goes with it in phase 3.
  "frame-src https://updated-rubric-creator.firebaseapp.com",
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
