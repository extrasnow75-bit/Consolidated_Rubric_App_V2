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
      google: {
        signIn(options?: { useAnotherAccount?: boolean }): Promise<GoogleSignInStatus>
        signOut(): Promise<void>
        /** Identity only — there is no call that returns the Google access token. */
        status(): Promise<GoogleSignInStatus>
        /** Fires when a stored sign-in turns out to be dead. Returns an unsubscribe function. */
        onSignedOut(callback: () => void): () => void
      }
      drive: {
        listFiles(args: {
          scope: 'recent' | 'myDrive' | 'sharedWithMe' | 'folder' | 'search'
          folderId?: string
          query?: string
          mimeTypes?: string[]
          foldersOnly?: boolean
          pageToken?: string
          pageSize?: number
        }): Promise<{ files: DriveFile[]; nextPageToken?: string }>
        /** Accepts any Drive URL shape, or a bare file id. */
        resolveUrl(
          url: string,
        ): Promise<
          | { ok: true; fileId: string; name: string; mimeType: string }
          | { ok: false; message: string }
        >
        getFileMetadata(fileId: string): Promise<{ name: string; mimeType: string }>
        getDocText(fileId: string): Promise<string>
        getSheetCsv(fileId: string): Promise<string>
        downloadBytes(fileId: string): Promise<Uint8Array>
        /** Bytes ready for processing; a Google Doc arrives converted to .docx. */
        fetchForProcessing(
          fileId: string,
        ): Promise<{ name: string; mimeType: string; bytes: Uint8Array }>
        upload(args: {
          content: string | Uint8Array
          name: string
          sourceMimeType: string
          targetMimeType?: string
          folderId?: string
        }): Promise<{ fileId: string; webViewLink: string }>
        /** Takes a file id, not a URL: main builds the address. */
        openInBrowser(fileId: string): Promise<void>
      }
      gemini: {
        /** Stops a running generation. */
        cancel(jobId: string): Promise<boolean>
        validateKey(apiKey: string): Promise<boolean>
        startNewChat(): Promise<void>
        sendMessage(a: { text: string; attachments?: unknown[]; jobId?: string }): Promise<string>
        extractRubricMetadata(a: { attachments: unknown[]; jobId?: string }): Promise<never>
        validateAssignmentDescription(a: { text: string; jobId?: string }): Promise<never>
        generateRubricFromDescription(a: {
          assignmentDescription: string
          settings: unknown
          jobId?: string
        }): Promise<never>
        generateRubricFromScreenshot(a: {
          imageData: { data: string; mimeType: string }
          settings: unknown
          jobId?: string
        }): Promise<never>
        extractRubricFromDocument(a: { documentText: string; jobId?: string }): Promise<never>
        applyRubricChanges(a: {
          rubric: unknown
          changeRequest: string
          jobId?: string
        }): Promise<never>
        analyzeCsvForCanvas(a: { csvContent: string; jobId?: string }): Promise<never>
        generateCsvForRubric(a: {
          rubricName: string
          totalPoints: string
          scoringMethod: 'ranges' | 'fixed'
          attachment: unknown
          jobId?: string
        }): Promise<string>
        discoverRubricTitles(a: { attachment: unknown; jobId?: string }): Promise<never>
        generateAllCsvsFromDoc(a: { attachment: unknown; jobId?: string }): Promise<never>
      }
      credentials: {
        keychainAvailable(): Promise<boolean>
        /** Pass null to forget the stored token. Rejects if the keychain is unavailable. */
        setCanvasToken(token: string | null): Promise<void>
        /** Status only — there is no call that returns the token itself. */
        canvasTokenStatus(): Promise<CredentialStatus>
        /** Pass null to forget the stored key. */
        setGeminiApiKey(key: string | null): Promise<void>
        geminiKeyStatus(): Promise<CredentialStatus>
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

  /** Who is signed in. Carries no token — Drive calls fetch their own in the main process. */
  interface GoogleSignInStatus {
    signedIn: boolean
    email?: string
    name?: string
    picture?: string
  }

  interface DriveFile {
    id: string
    name: string
    mimeType: string
    modifiedTime?: string
    iconLink?: string
    isFolder: boolean
  }
}
