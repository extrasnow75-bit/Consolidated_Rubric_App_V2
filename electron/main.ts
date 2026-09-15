import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { writeFile } from 'fs/promises'
import { isAllowedExternalUrl, setAllowedCanvasHost } from './ipc/externalLinks'
import { readSettings, updateSettings } from './ipc/settings'
import {
  setCanvasToken,
  canvasTokenStatus,
  isKeychainAvailable,
  type CredentialStatus,
} from './ipc/credentials'
import { pushRubric, verifyToken, getCourseName } from './ipc/canvas'
import { parseCourseUrl } from './ipc/canvasUtils'
import { rememberSavePath, consumeSavePath } from './ipc/savePaths'
import { checkForUpdate, checkNow, RELEASES_PAGE } from './ipc/updateCheck'
import {
  applyZoomLevel,
  getSavedZoomLevel,
  registerZoomShortcuts,
  stepZoom,
  MIN_ZOOM_LEVEL,
  MAX_ZOOM_LEVEL,
} from './ipc/zoom'

const IS_MAC = process.platform === 'darwin'

/**
 * True only for a navigation back to the page this window already shows.
 *
 * Deliberately not an origin comparison. Every `file://` URL has the origin `"null"`, so in the
 * packaged build — which loads the UI with `loadFile` — comparing origins matches *any* local
 * file and waves it through. That would let a navigation to, say, a rubric the user just saved as
 * .html run inside this window, where the preload bridge is attached and hands it the whole
 * `window.api` surface. Under `file://` we therefore require the exact same document, and only
 * the dev server (a real http origin, which reloads itself for HMR) gets origin treatment.
 */
function isOwnPage(win: BrowserWindow, url: string): boolean {
  const current = win.webContents.getURL()
  if (!current) return false
  try {
    const target = new URL(url)
    const here = new URL(current)
    if (here.origin === 'null' || target.origin === 'null') {
      return target.protocol === here.protocol && target.pathname === here.pathname
    }
    return target.origin === here.origin
  } catch {
    return false
  }
}

/**
 * Hand a URL to the OS browser, but only one this app has business opening.
 *
 * See externalLinks.ts for why this is a host allowlist rather than the usual http(s) check: with
 * `connect-src 'none'` closing every socket in the renderer, navigation is the last route by
 * which a compromised renderer could move a Canvas token off the machine.
 */
async function openExternalSafely(url: string): Promise<void> {
  if (!isAllowedExternalUrl(url)) return
  await shell.openExternal(url)
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 860,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'hidden',
    ...(IS_MAC
      ? { trafficLightPosition: { x: 13, y: 11 } }
      : {
          titleBarOverlay: {
            color: '#0033a0',
            symbolColor: '#ffffff',
            height: 36,
          },
        }),
    backgroundColor: '#f9fafb',
  })

  // This window only ever shows our own bundled UI. Everything external — the Google consent
  // screen, a finished Doc, the Canvas course — opens in the user's real browser. So refuse both
  // routes by which remote content could end up rendering inside the app instead: window.open,
  // and navigation away from our own page.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalSafely(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (isOwnPage(win, url)) return
    event.preventDefault()
    void openExternalSafely(url)
  })

  registerZoomShortcuts(win)

  // Restore the saved zoom once the page exists. Setting it earlier has no effect: Electron
  // resets the zoom level for each new document.
  win.webContents.on('did-finish-load', () => {
    applyZoomLevel(win, getSavedZoomLevel())
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

/** The window a renderer message came from, so zoom applies to the right one. */
function windowFor(e: { sender: Electron.WebContents }): BrowserWindow | null {
  return BrowserWindow.fromWebContents(e.sender)
}

// ─── App info and updates ─────────────────────────────────────────────────────

ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('app:checkUpdate', () => checkForUpdate())
ipcMain.handle('app:checkUpdateNow', () => checkNow())

// Takes no URL on purpose: the destination is a constant here, so the renderer cannot use this as
// a general "open any link in the browser" capability.
ipcMain.handle('app:openReleases', () => shell.openExternal(RELEASES_PAGE))

ipcMain.handle('app:getHideLocalSaveNotice', () => readSettings().hideLocalSaveNotice === true)
ipcMain.handle('app:setHideLocalSaveNotice', (_e, hide: boolean) => {
  updateSettings({ hideLocalSaveNotice: hide === true })
})

// ─── Interface zoom ───────────────────────────────────────────────────────────

ipcMain.handle('app:getZoom', (e) => {
  const win = windowFor(e)
  return {
    level: win ? win.webContents.getZoomLevel() : 0,
    min: MIN_ZOOM_LEVEL,
    max: MAX_ZOOM_LEVEL,
  }
})

ipcMain.handle('app:stepZoom', (e, delta: number) => {
  const win = windowFor(e)
  // Only ever ±1 from the renderer; the size of a step is not the renderer's decision.
  return win ? stepZoom(win, delta > 0 ? 1 : -1) : 0
})

ipcMain.handle('app:resetZoom', (e) => {
  const win = windowFor(e)
  return win ? applyZoomLevel(win, 0) : 0
})

// ─── Local file save ──────────────────────────────────────────────────────────

ipcMain.handle(
  'dialog:saveFile',
  async (_e, opts: { defaultName: string; ext: string; label: string }) => {
    const { filePath } = await dialog.showSaveDialog({
      defaultPath: opts.defaultName,
      filters: [{ name: opts.label, extensions: [opts.ext] }],
    })
    if (!filePath) return null
    // Writes are only permitted to paths this dialog issued; see savePaths.ts.
    rememberSavePath(filePath)
    return filePath
  },
)

/**
 * Write a file the user chose in the save dialog.
 *
 * `consumeSavePath` is what makes this safe to expose. The renderer hands back a path string, and
 * a string is a string — nothing about the round trip proves it is the one the dialog returned.
 * Without the check, anything able to run script in the renderer could write attacker-influenced
 * bytes (rubric text is AI-generated) to any path the user can write.
 */
ipcMain.handle('dialog:writeFile', async (_e, args: { path: string; data: string | Uint8Array }) => {
  const target = consumeSavePath(args.path)
  const bytes = typeof args.data === 'string' ? Buffer.from(args.data, 'utf-8') : Buffer.from(args.data)
  await writeFile(target, bytes)
  return { ok: true as const }
})

// ─── Credentials ──────────────────────────────────────────────────────────────
//
// Note the asymmetry, which is the point: `set` takes a secret, and the matching read returns a
// status object. There is deliberately no `getCanvasToken` handler. See credentials.ts.

ipcMain.handle('credentials:keychainAvailable', () => isKeychainAvailable())

ipcMain.handle('credentials:setCanvasToken', (_e, token: string | null) => {
  setCanvasToken(token)
})

ipcMain.handle('credentials:canvasTokenStatus', (): CredentialStatus => canvasTokenStatus())

// ─── Canvas ───────────────────────────────────────────────────────────────────

/**
 * Save the course URL, and teach the external-link allowlist about its host.
 *
 * Validated here rather than trusted, because this one value decides two things that matter: the
 * only host the Canvas token will ever be sent to, and the only Canvas host `openExternal` will
 * open. Rejected URLs are not stored, so a bad value cannot widen either.
 */
ipcMain.handle('canvas:setCourseUrl', (_e, url: string | null) => {
  if (!url) {
    updateSettings({ canvasCourseUrl: undefined })
    setAllowedCanvasHost(null)
    return { ok: true as const }
  }
  const ref = parseCourseUrl(url)
  if (!ref) {
    return {
      ok: false as const,
      message:
        'That is not a recognised Canvas course URL. It should look like ' +
        'https://yourschool.instructure.com/courses/12345 — paste a link from inside your course.',
    }
  }
  updateSettings({ canvasCourseUrl: url.trim() })
  setAllowedCanvasHost(url.trim())
  return { ok: true as const }
})

ipcMain.handle('canvas:getCourseUrl', () => readSettings().canvasCourseUrl ?? null)

ipcMain.handle('canvas:verifyToken', (_e, args: { courseUrl: string }) => verifyToken(args))
ipcMain.handle('canvas:getCourseName', (_e, args: { courseUrl: string }) => getCourseName(args))
ipcMain.handle('canvas:pushRubric', (_e, args: { csvContent: string; courseUrl: string }) =>
  pushRubric(args),
)

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // Teach the external-link allowlist which Canvas host this user configured, so a link to their
  // course opens while everything else stays shut.
  setAllowedCanvasHost(readSettings().canvasCourseUrl ?? null)

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
