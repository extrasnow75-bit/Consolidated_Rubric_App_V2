/**
 * Interface zoom, persisted across launches.
 *
 * The window uses `titleBarStyle: 'hidden'`, so Electron's default menu is never drawn —
 * and with it go the Zoom In / Zoom Out accelerators users expect from Ctrl+= and Ctrl+-.
 * The app is dense and its smallest labels are 10px, so on a large monitor at native scale
 * the text is genuinely hard to read. Zoom is therefore wired up explicitly here: keyboard
 * shortcuts registered on the window, plus visible controls in the ribbon, since a shortcut
 * nobody can see is not a feature anyone will find.
 *
 * Electron's zoom *level* is logarithmic — factor = 1.2 ** level — which makes the steps
 * feel even. Levels are clamped so the UI cannot be shrunk into illegibility or blown up
 * until the layout breaks.
 */
import { BrowserWindow } from 'electron'
import { readSettings, updateSettings } from './settings'

export const MIN_ZOOM_LEVEL = -2
export const MAX_ZOOM_LEVEL = 5

function clamp(level: number): number {
  return Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, level))
}

export function getSavedZoomLevel(): number {
  const saved = readSettings().zoomLevel
  return typeof saved === 'number' && Number.isFinite(saved) ? clamp(saved) : 0
}

/** Apply a level to the window, persist it, and tell the renderer so its readout matches. */
export function applyZoomLevel(win: BrowserWindow, level: number): number {
  const next = clamp(level)
  win.webContents.setZoomLevel(next)
  updateSettings({ zoomLevel: next })
  win.webContents.send('app:zoomChanged', next)
  return next
}

export function stepZoom(win: BrowserWindow, delta: number): number {
  return applyZoomLevel(win, win.webContents.getZoomLevel() + delta)
}

/**
 * Register Ctrl/Cmd +, -, and 0 on this window.
 *
 * `before-input-event` rather than a Menu: the menu is not rendered with a hidden title bar,
 * and globalShortcut would steal these keys from every other application while the app has
 * focus. This fires only when our window does.
 *
 * Both `=` and `+` are accepted because Ctrl+= is what an unshifted "plus" key actually
 * reports, and both `-` and `_` for the same reason.
 */
export function registerZoomShortcuts(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const mod = process.platform === 'darwin' ? input.meta : input.control
    if (!mod) return

    if (input.key === '=' || input.key === '+') {
      event.preventDefault()
      stepZoom(win, 1)
    } else if (input.key === '-' || input.key === '_') {
      event.preventDefault()
      stepZoom(win, -1)
    } else if (input.key === '0') {
      event.preventDefault()
      applyZoomLevel(win, 0)
    }
  })
}
