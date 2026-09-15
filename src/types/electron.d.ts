/**
 * The typed `window.api` bridge. Mirrors electron/preload.ts.
 *
 * Keep this in step with the preload by hand — there is no shared source, and a method that
 * exists here but not there fails silently at runtime as `undefined is not a function`.
 *
 * Note what is deliberately absent: nothing returns a Canvas token, a Gemini key or a Google
 * access token. Credentials travel renderer → main only, and come back as status. If a method
 * that returns one ever appears here, that is a bug, not a feature.
 */
export {}

declare global {
  interface Window {
    api: {
      app: {
        /** 'darwin' | 'win32' | 'linux' — read synchronously during the first render. */
        platform: string
        version(): Promise<string>
        /** Resolves to null when up to date, offline, or the check fails. */
        checkUpdate(): Promise<{ version: string } | null>
        checkUpdateNow(): Promise<
          | { state: 'update-available'; current: string; latest: string }
          | { state: 'up-to-date'; current: string }
          | { state: 'check-failed'; current: string }
        >
        openReleases(): Promise<void>
        getHideLocalSaveNotice(): Promise<boolean>
        setHideLocalSaveNotice(hide: boolean): Promise<void>
        getZoom(): Promise<{ level: number; min: number; max: number }>
        stepZoom(delta: number): Promise<number>
        resetZoom(): Promise<number>
        /** Returns an unsubscribe function. */
        onZoomChanged(callback: (level: number) => void): () => void
      }
      dialog: {
        /** Resolves to null if the user cancelled. */
        saveFile(opts: {
          defaultName: string
          ext: string
          label: string
        }): Promise<string | null>
        /** Only accepts a path that `saveFile` issued; any other is refused in main. */
        writeFile(args: { path: string; data: string | Uint8Array }): Promise<{ ok: true }>
      }
      credentials: {
        keychainAvailable(): Promise<boolean>
        /** Pass null to forget the stored token. Rejects if the keychain is unavailable. */
        setCanvasToken(token: string | null): Promise<void>
        /** Status only — there is no call that returns the token itself. */
        canvasTokenStatus(): Promise<CredentialStatus>
      }
      canvas: {
        setCourseUrl(url: string | null): Promise<{ ok: boolean; message?: string }>
        getCourseUrl(): Promise<string | null>
        verifyToken(args: { courseUrl: string }): Promise<CanvasLookup>
        getCourseName(args: { courseUrl: string }): Promise<CanvasLookup>
        /** Takes no token: main loads it from the keychain when it builds the request. */
        pushRubric(args: {
          csvContent: string
          courseUrl: string
        }): Promise<{ success: boolean; message: string }>
      }
    }
  }

  /** What the renderer may know about a stored secret: that it exists, and its last 4 chars. */
  interface CredentialStatus {
    hasValue: boolean
    hint: string
  }

  interface CanvasLookup {
    ok: boolean
    name?: string
    message?: string
  }
}
