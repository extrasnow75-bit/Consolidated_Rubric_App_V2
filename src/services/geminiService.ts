/**
 * Gemini, as seen from the renderer.
 *
 * The implementation moved to the main process (electron/ipc/gemini.ts); this is the thin layer
 * that gets calls across the boundary. It keeps the old module's export names and signatures on
 * purpose, so the six components that import from here did not have to change.
 *
 * The one thing worth understanding is how cancellation survives the trip. Callers here pass an
 * `AbortSignal`, which cannot be sent over IPC. So each call invents a job id, hands that to main,
 * and wires the signal's `abort` event to a `gemini:cancel` message carrying the same id. Main
 * turns the id back into a real AbortSignal (see electron/ipc/jobs.ts), which is what the throttle
 * queue and retry back-off in gemini.ts have always used. The abort semantics the components
 * relied on still hold; only the transport is different.
 */
import {
  GenerationSettings,
  RubricData,
  Attachment,
  RubricMeta,
} from '../types';

// These mirror the declarations in electron/ipc/gemini.ts. Kept in step by hand: the two
// processes compile separately, so there is no shared source to import from.

export interface CsvAnalysisResult {
  rubricName: string;
  criteriaCount: number;
  totalPoints: number;
  isValid: boolean;
  notes: string;
}

export interface RubricDiscovery {
  name: string;
  scoringMethod: 'ranges' | 'fixed';
}

export interface BatchRubricResult {
  title: string;
  csv: string;
}

let jobCounter = 0;

/**
 * Run an IPC call under a cancellable job id.
 *
 * The listener is removed in `finally` whether the call resolved, rejected or was cancelled. Left
 * attached, every generation would leak a listener onto a long-lived AbortSignal — and the batch
 * paths reuse one signal across a whole run of rubrics, so it would accumulate quickly.
 */
async function withCancellation<T>(
  signal: AbortSignal | undefined,
  run: (jobId: string) => Promise<T>,
): Promise<T> {
  const jobId = `job-${++jobCounter}-${Date.now()}`;

  if (signal?.aborted) throw new Error('Request cancelled');

  const onAbort = () => {
    void window.api.gemini.cancel(jobId);
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    return await run(jobId);
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

// ─── API key ──────────────────────────────────────────────────────────────────

/**
 * Check a key before it is saved.
 *
 * Takes the candidate directly, because at this point it is something the user has typed and not
 * yet committed. Once saved it goes to the OS keychain and is never read back out here.
 */
export const validateGeminiApiKey = (apiKey: string): Promise<boolean> =>
  window.api.gemini.validateKey(apiKey);

// ─── Chat ─────────────────────────────────────────────────────────────────────

export const startNewChat = (): Promise<void> => window.api.gemini.startNewChat();

export const sendMessageToGemini = (
  text: string,
  attachments: Attachment[] = [],
  signal?: AbortSignal,
): Promise<string> =>
  withCancellation(signal, (jobId) =>
    window.api.gemini.sendMessage({ text, attachments, jobId }),
  );

// ─── Rubric generation and extraction ─────────────────────────────────────────

export const extractRubricMetadata = (
  attachments: Attachment[],
  signal?: AbortSignal,
): Promise<RubricMeta[]> =>
  withCancellation(signal, (jobId) =>
    window.api.gemini.extractRubricMetadata({ attachments, jobId }),
  );

export const validateAssignmentDescription = (
  text: string,
  signal?: AbortSignal,
): Promise<{ isValid: boolean; message: string }> =>
  withCancellation(signal, (jobId) =>
    window.api.gemini.validateAssignmentDescription({ text, jobId }),
  );

export const generateRubricFromDescription = (
  assignmentDescription: string,
  settings: GenerationSettings,
  signal?: AbortSignal,
): Promise<RubricData> =>
  withCancellation(signal, (jobId) =>
    window.api.gemini.generateRubricFromDescription({ assignmentDescription, settings, jobId }),
  );

export const generateRubricFromScreenshot = (
  imageData: { data: string; mimeType: string },
  settings: GenerationSettings,
  signal?: AbortSignal,
): Promise<RubricData> =>
  withCancellation(signal, (jobId) =>
    window.api.gemini.generateRubricFromScreenshot({ imageData, settings, jobId }),
  );

export const extractRubricFromDocument = (
  documentText: string,
  signal?: AbortSignal,
): Promise<RubricData> =>
  withCancellation(signal, (jobId) =>
    window.api.gemini.extractRubricFromDocument({ documentText, jobId }),
  );

export const applyRubricChanges = (
  rubric: RubricData,
  changeRequest: string,
  signal?: AbortSignal,
): Promise<RubricData> =>
  withCancellation(signal, (jobId) =>
    window.api.gemini.applyRubricChanges({ rubric, changeRequest, jobId }),
  );

// ─── CSV ──────────────────────────────────────────────────────────────────────

export const analyzeCsvForCanvas = (
  csvContent: string,
  signal?: AbortSignal,
): Promise<CsvAnalysisResult> =>
  withCancellation(signal, (jobId) =>
    window.api.gemini.analyzeCsvForCanvas({ csvContent, jobId }),
  );

export const generateCsvForRubric = (
  rubricName: string,
  totalPoints: string,
  scoringMethod: 'ranges' | 'fixed',
  attachment: Attachment,
  signal?: AbortSignal,
): Promise<string> =>
  withCancellation(signal, (jobId) =>
    window.api.gemini.generateCsvForRubric({
      rubricName,
      totalPoints,
      scoringMethod,
      attachment,
      jobId,
    }),
  );

export const discoverRubricTitles = (
  attachment: Attachment,
  signal?: AbortSignal,
): Promise<RubricDiscovery[]> =>
  withCancellation(signal, (jobId) =>
    window.api.gemini.discoverRubricTitles({ attachment, jobId }),
  );

export const generateAllCsvsFromDoc = (
  attachment: Attachment,
  signal?: AbortSignal,
): Promise<BatchRubricResult[]> =>
  withCancellation(signal, (jobId) =>
    window.api.gemini.generateAllCsvsFromDoc({ attachment, jobId }),
  );

/**
 * Re-exported from its new home so existing imports keep working.
 *
 * It never involved Gemini — it is a pure formatter — so it lives in the renderer rather than
 * making an IPC round trip to do string work.
 */
export { generateCsvFromRubricObject } from '../utils/rubricCsv';
