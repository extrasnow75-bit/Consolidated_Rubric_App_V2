/**
 * Google Drive, from the main process.
 *
 * Ported from src/services/googleDriveService.ts, with two changes:
 *
 *   1. No access token crosses the IPC boundary. Every function here calls `getAccessToken()`
 *      itself, which reads the refresh token from the OS keychain and exchanges it as needed. The
 *      renderer names a file id; it never holds a credential.
 *   2. The Google Picker is gone. It is a browser widget that needs a real http origin for
 *      `setOrigin`, and a packaged app is served from file://. `listFiles` below replaces it, and
 *      the in-app browser built on it is better in the ways that were annoying anyway: no
 *      separate Picker API key, no 403 overlay, no ten-second timeout.
 */
import { randomBytes } from 'crypto'
import { getAccessToken } from './googleAuth'

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files'
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'

export const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document'
export const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
export const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder'

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
  iconLink?: string
  isFolder: boolean
}

export interface UploadResult {
  fileId: string
  webViewLink: string
}

/** Pull a useful sentence out of a Google error body, which is nested several layers deep. */
async function parseGoogleError(response: Response): Promise<string> {
  try {
    const body = (await response.clone().json()) as {
      error?: { message?: string; errors?: Array<{ reason?: string }> }
    }
    const err = body?.error
    if (!err) return ''
    const reason = err.errors?.[0]?.reason ?? ''
    const message = err.message ?? ''
    return reason ? `${reason}: ${message}` : message
  } catch {
    try {
      return (await response.clone().text()).slice(0, 200)
    } catch {
      return ''
    }
  }
}

/**
 * Turn a Google API failure into something the user can act on.
 *
 * The 403 split matters: "you are not allowed to open this document" and "this app was never
 * granted Drive access" look identical in the status code but need opposite responses from the
 * user — ask a colleague to share the file, versus sign in again and tick the Drive box.
 */
async function driveError(response: Response, noun: string): Promise<Error> {
  if (response.status === 404) {
    return new Error(`That ${noun} was not found. Check the link and try again.`)
  }
  if (response.status === 401) {
    return new Error('Your Google sign-in has expired. Sign in again under Initial Setup.')
  }
  if (response.status === 403) {
    const detail = (await parseGoogleError(response)).toLowerCase()
    const scopeProblem =
      detail.includes('insufficientpermissions') ||
      detail.includes('insufficient permissions') ||
      detail.includes('insufficient authentication scopes')
    if (scopeProblem) {
      return new Error(
        'This app was not granted access to your Google Drive. Sign out and sign in again, ' +
          'and allow Drive access on the Google consent screen.',
      )
    }
    return new Error(
      `You do not have access to that ${noun}. Ask whoever owns it to share it with your ` +
        'Google account.',
    )
  }
  const detail = await parseGoogleError(response)
  return new Error(`Google Drive error (${response.status})${detail ? `: ${detail}` : ''}`)
}

/**
 * A Drive file id, checked before it is interpolated into an API path.
 *
 * Drive ids are URL-safe base64, so this is their real alphabet rather than a guess. Without the
 * check, an id of `../../../oauth2/v3/userinfo` normalises out of the Drive namespace and issues
 * an authorized request to a different googleapis endpoint; `?` or `#` would let the renderer
 * append its own query parameters. The host cannot be changed either way, so this widens reach
 * rather than leaking the token — but it is one regex.
 */
function assertFileId(fileId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(fileId)) {
    throw new Error('That does not look like a Google Drive file id.')
  }
  return fileId
}

async function authorized(url: string, init?: RequestInit): Promise<Response> {
  const accessToken = await getAccessToken()
  return fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${accessToken}` },
  })
}

/**
 * Pull a Drive file id out of whatever the user pasted.
 *
 * Kept as a pure function (and unit-tested) because the shapes are numerous: a Docs URL, a Sheets
 * URL, an old `open?id=` link, or the bare id someone copied out of one of those.
 */
export function extractFileIdFromUrl(url: string): string {
  const slashMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/)
  if (slashMatch) return slashMatch[1]

  const idMatch = url.match(/[?&]id=([a-zA-Z0-9-_]+)/)
  if (idMatch) return idMatch[1]

  if (/^[a-zA-Z0-9-_]+$/.test(url.trim()) && url.trim().length > 10) return url.trim()

  throw new Error(
    'That does not look like a Google Docs or Sheets link. Paste a shareable link, such as ' +
      'https://docs.google.com/document/d/…',
  )
}

/** Escape a user's search text for a Drive `q` string literal. */
function escapeQueryLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export type DriveScope = 'recent' | 'myDrive' | 'sharedWithMe' | 'folder' | 'search'

export interface ListFilesArgs {
  scope: DriveScope
  /** Required for scope 'folder'. */
  folderId?: string
  /** Required for scope 'search'. */
  query?: string
  /** Restrict to these MIME types. Omit for the caller's default document set. */
  mimeTypes?: string[]
  /** List only folders — used when picking an upload destination. */
  foldersOnly?: boolean
  pageToken?: string
  pageSize?: number
}

/**
 * List or search the user's Drive.
 *
 * This is what replaces the Picker, and it needs the `drive.readonly` scope to see files the app
 * did not create — see the note in googleConfig.ts about what that costs.
 */
export async function listFiles(
  args: ListFilesArgs,
): Promise<{ files: DriveFile[]; nextPageToken?: string }> {
  const clauses: string[] = ['trashed = false']

  if (args.foldersOnly) {
    clauses.push(`mimeType = '${GOOGLE_FOLDER_MIME}'`)
  } else if (args.mimeTypes?.length) {
    // Folders are always included so the browser can be navigated.
    const types = [...args.mimeTypes, GOOGLE_FOLDER_MIME]
      .map((m) => `mimeType = '${escapeQueryLiteral(m)}'`)
      .join(' or ')
    clauses.push(`(${types})`)
  }

  let orderBy = 'folder,name'
  switch (args.scope) {
    case 'recent':
      orderBy = 'viewedByMeTime desc'
      break
    case 'myDrive':
      clauses.push("'root' in parents")
      break
    case 'sharedWithMe':
      clauses.push('sharedWithMe = true')
      break
    case 'folder':
      if (!args.folderId) throw new Error('No folder was specified.')
      clauses.push(`'${escapeQueryLiteral(args.folderId)}' in parents`)
      break
    case 'search':
      if (!args.query?.trim()) throw new Error('No search text was given.')
      clauses.push(`name contains '${escapeQueryLiteral(args.query.trim())}'`)
      break
  }

  const params = new URLSearchParams({
    q: clauses.join(' and '),
    orderBy,
    pageSize: String(args.pageSize ?? 50),
    fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, iconLink)',
    // Without these two, files on shared drives are silently missing from every listing.
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    corpora: 'allDrives',
  })
  if (args.pageToken) params.set('pageToken', args.pageToken)

  const response = await authorized(`${DRIVE_FILES}?${params.toString()}`)
  if (!response.ok) throw await driveError(response, 'folder')

  const body = (await response.json()) as {
    nextPageToken?: string
    files?: Array<{
      id: string
      name: string
      mimeType: string
      modifiedTime?: string
      iconLink?: string
    }>
  }

  return {
    files: (body.files ?? []).map((f) => ({ ...f, isFolder: f.mimeType === GOOGLE_FOLDER_MIME })),
    nextPageToken: body.nextPageToken,
  }
}

/** Confirm a file exists and is reachable, and report what it is. */
export async function getFileMetadata(
  rawFileId: string,
): Promise<{ name: string; mimeType: string }> {
  const fileId = assertFileId(rawFileId)
  const params = new URLSearchParams({ fields: 'name,mimeType', supportsAllDrives: 'true' })
  const response = await authorized(`${DRIVE_FILES}/${fileId}?${params.toString()}`)
  if (!response.ok) throw await driveError(response, 'file')
  return (await response.json()) as { name: string; mimeType: string }
}

/**
 * A Google Doc as plain text.
 *
 * Exported through Drive rather than read through the Docs API, which keeps this to one API and
 * one scope, and handles multi-tab documents without walking the tab tree by hand.
 */
export async function getGoogleDocText(rawFileId: string): Promise<string> {
  const fileId = assertFileId(rawFileId)
  const response = await authorized(`${DRIVE_FILES}/${fileId}/export?mimeType=text/plain`)
  if (!response.ok) throw await driveError(response, 'document')
  return response.text()
}

/** A Google Sheet as CSV. */
export async function getGoogleSheetCsv(rawFileId: string): Promise<string> {
  const fileId = assertFileId(rawFileId)
  const response = await authorized(`${DRIVE_FILES}/${fileId}/export?mimeType=text/csv`)
  if (!response.ok) throw await driveError(response, 'sheet')
  return response.text()
}

export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/**
 * A Google Doc exported as .docx bytes.
 *
 * Used when a document is headed for Gemini rather than for display: mammoth reads .docx and
 * preserves the table structure a rubric lives in, which a plain-text export flattens away.
 */
export async function exportDocAsDocx(rawFileId: string): Promise<Uint8Array> {
  const fileId = assertFileId(rawFileId)
  const response = await authorized(
    `${DRIVE_FILES}/${fileId}/export?mimeType=${encodeURIComponent(DOCX_MIME)}`,
  )
  if (!response.ok) throw await driveError(response, 'document')
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * Fetch any supported file as bytes, converting a Google Doc to .docx on the way.
 *
 * One call for what was three copies of the same branch in the renderer — picker, pasted link,
 * and recent-document list all needed "if it is a Google Doc, export it; otherwise download it".
 * Doing the branch here also means the renderer never assembles a Google API URL.
 */
export async function fetchFileForProcessing(
  rawFileId: string,
): Promise<{ name: string; mimeType: string; bytes: Uint8Array }> {
  const fileId = assertFileId(rawFileId)
  const meta = await getFileMetadata(fileId)

  if (meta.mimeType === GOOGLE_DOC_MIME) {
    const name = meta.name.toLowerCase().endsWith('.docx') ? meta.name : `${meta.name}.docx`
    return { name, mimeType: DOCX_MIME, bytes: await exportDocAsDocx(fileId) }
  }

  return { name: meta.name, mimeType: meta.mimeType, bytes: await downloadFileBytes(fileId) }
}

/**
 * Raw bytes of a non-Google file (.docx, .pdf, .txt, an image).
 *
 * Returned as a Uint8Array because that is what survives the IPC structured clone; the renderer
 * turns it back into an ArrayBuffer for mammoth or pdf.js.
 */
export async function downloadFileBytes(rawFileId: string): Promise<Uint8Array> {
  const fileId = assertFileId(rawFileId)
  const response = await authorized(`${DRIVE_FILES}/${fileId}?alt=media&supportsAllDrives=true`)
  if (!response.ok) throw await driveError(response, 'file')
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * Upload content to Drive, optionally converting it to a native Google format.
 *
 * The body is assembled as a Buffer rather than a string. The version this replaces built it with
 * `array.join('\r\n')`, which is fine for text/plain but corrupts any binary payload — every byte
 * outside the string's encoding is mangled on the way through. Since this is the path a generated
 * document takes into Drive, that mattered.
 */
export async function uploadToDrive(args: {
  content: string | Uint8Array
  name: string
  sourceMimeType: string
  targetMimeType?: string
  folderId?: string
}): Promise<UploadResult> {
  const accessToken = await getAccessToken()
  // Random, not Date.now(): the body below contains renderer-supplied content, and a
  // guessable boundary lets that content close the part and inject its own.
  const boundary = `rubriccreator${randomBytes(16).toString('hex')}`

  const metadata: Record<string, unknown> = { name: args.name }
  if (args.targetMimeType) metadata.mimeType = args.targetMimeType
  if (args.folderId) metadata.parents = [args.folderId]

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: ${args.sourceMimeType}\r\n\r\n`,
      'utf-8',
    ),
    typeof args.content === 'string' ? Buffer.from(args.content, 'utf-8') : Buffer.from(args.content),
    Buffer.from(`\r\n--${boundary}--`, 'utf-8'),
  ])

  const params = new URLSearchParams({
    uploadType: 'multipart',
    fields: 'id,webViewLink',
    supportsAllDrives: 'true',
  })

  const response = await fetch(`${DRIVE_UPLOAD}?${params.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  })

  if (!response.ok) throw await driveError(response, 'file')

  const created = (await response.json()) as { id: string; webViewLink: string }
  return { fileId: created.id, webViewLink: created.webViewLink }
}
