/**
 * Reading text out of a .docx, in the main process.
 *
 * Its own module for the reason csvRepair.ts is: nothing here imports Electron, so a test can
 * import it directly. gemini.ts cannot be imported under vitest at all — it reaches credentials.ts,
 * which calls app.getPath() at module load — and this is the one piece of it worth holding still.
 */
import mammoth from 'mammoth'
import type { Attachment } from './geminiTypes'

export async function extractDocxText(attachment: Attachment): Promise<string> {
  // `{ buffer }`, not `{ arrayBuffer }`.
  //
  // mammoth ships two input contracts and only documents one at a time. The browser build takes
  // `arrayBuffer`; the Node build reads `options.path` or `options.buffer` and nothing else, and
  // when it finds neither it throws "Could not find file in options" — a message that names no
  // option it actually wanted and reads like the file is missing rather than the argument.
  //
  // The web app ran mammoth in the browser, so `arrayBuffer` was right there and came across in
  // the move to the main process unchanged. It meant every .docx route through Gemini failed:
  // Part 2's batch extraction, the chat attachments, all of it. It surfaced as
  // "Error invoking remote method 'gemini:generateAllCsvsFromDoc': Could not find file in
  // options", which looks like an IPC fault and is not one.
  //
  // Exported solely so the test can hold the contract still — mammoth's own types accept both
  // shapes, so TypeScript will not catch this coming back.
  const result = await mammoth.extractRawText({ buffer: Buffer.from(attachment.data, 'base64') });
  if (!result.value || result.value.trim().length === 0) {
    throw new Error('Could not extract text from the Word document. The file may be empty or protected.');
  }
  return result.value;
}
