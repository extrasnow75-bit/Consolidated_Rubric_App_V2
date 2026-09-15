import { contextBridge, ipcRenderer } from 'electron'

/**
 * The renderer's entire view of the outside world.
 *
 * Every method here is a deliberate grant, so the shape of this object is the app's real
 * security boundary. Two rules it follows, both of which matter more than they look:
 *
 *   1. No method returns a credential. The Canvas token, the Gemini key and the Google access
 *      token are written in one direction only — renderer to keychain — and the reads come back
 *      as status, not secrets. The renderer cannot leak what it was never given.
 *   2. No method takes a URL that the main process will then fetch or open verbatim. Destinations
 *      are either constants in main or checked against an allowlist there.
 */
contextBridge.exposeInMainWorld('api', {
  app: {
    /**
     * 'darwin' | 'win32' | 'linux'. A plain value rather than a call, because the layout decides
     * on it during the first render — the title bar has to leave room for macOS's traffic lights
     * immediately, not after a round trip that would show a visible jump.
     */
    platform: process.platform,
    version: (): Promise<string> => ipcRenderer.invoke('app:version'),
    /** Resolves to null when up to date, offline, or the check fails. */
    checkUpdate: (): Promise<{ version: string } | null> => ipcRenderer.invoke('app:checkUpdate'),
    /** User-initiated check. Always hits the network, and distinguishes a failed check. */
    checkUpdateNow: (): Promise<
      | { state: 'update-available'; current: string; latest: string }
      | { state: 'up-to-date'; current: string }
      | { state: 'check-failed'; current: string }
    > => ipcRenderer.invoke('app:checkUpdateNow'),
    openReleases: (): Promise<void> => ipcRenderer.invoke('app:openReleases'),
    /** "Don't show this again" on the notice shown before the first local save. */
    getHideLocalSaveNotice: (): Promise<boolean> =>
      ipcRenderer.invoke('app:getHideLocalSaveNotice'),
    setHideLocalSaveNotice: (hide: boolean): Promise<void> =>
      ipcRenderer.invoke('app:setHideLocalSaveNotice', hide),
    /** Current interface zoom, plus the range the controls should stop at. */
    getZoom: (): Promise<{ level: number; min: number; max: number }> =>
      ipcRenderer.invoke('app:getZoom'),
    /** One step larger (delta > 0) or smaller. Resolves to the new level. */
    stepZoom: (delta: number): Promise<number> => ipcRenderer.invoke('app:stepZoom', delta),
    resetZoom: (): Promise<number> => ipcRenderer.invoke('app:resetZoom'),
    /** Fires when zoom changes by any route, including the keyboard shortcuts. */
    onZoomChanged: (callback: (level: number) => void): (() => void) => {
      const listener = (_e: unknown, level: number) => callback(level)
      ipcRenderer.on('app:zoomChanged', listener)
      return () => ipcRenderer.removeListener('app:zoomChanged', listener)
    },
  },
  dialog: {
    /** Opens the native save dialog. Resolves to null if the user cancelled. */
    saveFile: (opts: { defaultName: string; ext: string; label: string }): Promise<string | null> =>
      ipcRenderer.invoke('dialog:saveFile', opts),
    /** Writes to a path `saveFile` issued. Any other path is refused in main. */
    writeFile: (args: { path: string; data: string | Uint8Array }): Promise<{ ok: true }> =>
      ipcRenderer.invoke('dialog:writeFile', args),
  },
})
