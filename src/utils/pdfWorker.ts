/**
 * pdf.js, configured to use the worker bundled with the app.
 *
 * The web build pointed `workerSrc` at esm.sh and fetched the worker over the network at runtime.
 * In a packaged desktop app that request cannot succeed — the page is loaded from file:// under
 * `connect-src 'none'` — and the failure is quiet: PDF import simply hangs. The `?url` import
 * makes Vite emit the worker as a real asset beside the bundle and hands back its local path.
 *
 * Importing this module is what configures pdf.js, so import it for the side effect and take
 * `pdfjsLib` from here rather than setting `workerSrc` again at each call site.
 *
 * pdf.js itself stays in the renderer on purpose. It only parses bytes the user already chose and
 * makes no network calls of its own, so moving it to the main process would buy nothing and cost
 * a large transfer of file data across IPC.
 */
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export { pdfjsLib }
