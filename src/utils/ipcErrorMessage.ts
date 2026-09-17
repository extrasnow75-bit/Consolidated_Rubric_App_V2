/**
 * Strip Electron's IPC wrapper off an error before a user reads it.
 *
 * Anything thrown inside an `ipcMain.handle` comes back to the renderer re-wrapped, so a main
 * process message like "Could not extract text from the Word document" arrives as:
 *
 *     Error invoking remote method 'gemini:generateAllCsvsFromDoc': Error: Could not extract …
 *
 * The deployment timeline prints that verbatim, which means the first thing a user sees when
 * something goes wrong is an internal channel name and the word "remote method" — reading like a
 * network fault in an app whose whole design is that the renderer has no network. The real
 * sentence, the one written to be read, is at the end.
 *
 * This only removes framing. It never rewrites or invents a message: if nothing matches, the
 * original text comes back untouched.
 */
export function ipcErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : String((error as { message?: unknown })?.message ?? error ?? '');

  let message = raw.trim();

  // The wrapper, with the channel name in quotes. Non-greedy so a quote inside the real message
  // cannot extend the match past the colon that ends the prefix.
  message = message.replace(/^Error invoking remote method '[^']*':\s*/, '');

  // Electron leaves the original error's class name behind: "Error: ", "TypeError: ". Repeat,
  // because a re-thrown error can carry more than one.
  let previous: string;
  do {
    previous = message;
    message = message.replace(/^(?:[A-Z][A-Za-z]*)?Error:\s*/, '');
  } while (message !== previous);

  return message.trim() || raw.trim();
}
