/**
 * Allowlist of destinations the save dialog has actually handed out.
 *
 * The renderer picks a file through the native save dialog and then passes the resulting
 * path back to the main process on the extraction call. Nothing in that round trip proves the
 * path is the one the dialog returned — the extraction handlers receive an ordinary string from
 * the renderer, and a string is a string. Without this check, anything able to run script in
 * the renderer could write to any path the user can write, with content that is partly
 * author-controlled (Canvas item bodies pass through into the HTML verbatim).
 *
 * So the dialog records what it issues and an extraction redeems it. Single use: the renderer
 * opens the dialog immediately before each extraction, so there is no legitimate flow that
 * writes the same path twice without asking again.
 */
const issued = new Set<string>()

export function rememberSavePath(path: string): void {
  issued.add(path)
}

/** Throws unless `path` came from the save dialog and has not already been written. */
export function consumeSavePath(path: string): string {
  if (!issued.delete(path)) {
    throw new Error('Refusing to write to a location that was not chosen in the save dialog.')
  }
  return path
}
