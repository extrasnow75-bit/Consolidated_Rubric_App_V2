import { GoogleGenAI, Chat, Type } from "@google/genai";
import mammoth from 'mammoth';
import { GenerationSettings, PointStyle, ProcessingType, RubricData, Attachment, RubricMeta } from "../types";

let client: GoogleGenAI | null = null;
let chatSession: Chat | null = null;

/**
 * Primary model — used for all complex generation tasks (rubric CSV, chat, etc.).
 * gemini-2.5-flash is the only model confirmed READY via diagnostic (HTTP 200).
 * gemini-2.0-flash and gemini-2.0-flash-lite are both DISABLED (limit:0).
 * gemini-1.5-* models return 404 (deprecated from v1beta).
 */
const PRIMARY_MODEL = 'gemini-2.5-flash';

/**
 * Fast model — used for lightweight tasks (key validation, rubric discovery).
 * gemini-2.5-flash-lite has a higher daily quota (1,000 RPD vs 250 RPD on Flash),
 * preserving the primary model's quota for the heavy per-rubric generation calls.
 */
const FAST_MODEL = 'gemini-2.5-flash-lite';

/** MIME type for Word documents */
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// ─── Client management ──────────────────────────────────────────────

const getClient = (): GoogleGenAI => {
  if (!client) {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("No Gemini API key found. Please enter your API key on the Dashboard.");
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
};

export const setGeminiApiKey = (apiKey: string): void => {
  client = null;
  chatSession = null;
  if (apiKey) {
    client = new GoogleGenAI({ apiKey });
  }
};

// ─── Rate limiter (throttle) ─────────────────────────────────────────

/**
 * Queue-based throttle — serialises all outgoing API calls with a
 * MIN_REQUEST_INTERVAL_MS gap between them regardless of how many
 * callers arrive concurrently.
 *
 * WHY queue-based instead of lastRequestTime:
 *   If 13 rubrics all call throttle() simultaneously, a simple
 *   lastRequestTime check lets them all read "elapsed = 0" at the
 *   same instant, schedule identical 4-second timers, and fire at
 *   the same time — triggering a burst of 13 simultaneous requests.
 *   The queue approach chains each call after the previous one so
 *   they execute one-at-a-time with a guaranteed 4 s gap.
 *
 * Abort behaviour: clearing the timer rejects the slot immediately
 *   and the rejection is swallowed in pendingThrottle so the NEXT
 *   queued caller can proceed without waiting.
 */
let pendingThrottle: Promise<void> = Promise.resolve();
const MIN_REQUEST_INTERVAL_MS = 2000; // 2 s between API calls — enough to respect rate limits without adding noticeable delay

async function throttle(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error('Request cancelled');

  const mySlot = pendingThrottle.then(
    () =>
      new Promise<void>((resolve, reject) => {
        if (signal?.aborted) { reject(new Error('Request cancelled')); return; }
        const timer = setTimeout(resolve, MIN_REQUEST_INTERVAL_MS);
        signal?.addEventListener(
          'abort',
          () => { clearTimeout(timer); reject(new Error('Request cancelled')); },
          { once: true },
        );
      }),
  );

  // Advance the global queue — swallow rejections so an abort on one
  // slot doesn't stall every subsequent caller.
  pendingThrottle = mySlot.catch(() => {});

  return mySlot;
}

// ─── Retry with exponential back-off ────────────────────────────────

/**
 * True when the 429 includes "limit: 0" — a hard daily cap.
 * Retrying won't help; the user needs a fresh project/key.
 */
function isHardQuotaLimit(error: any): boolean {
  return String(error?.message || error || '').includes('limit: 0');
}

/**
 * True for temporary rate-limit 429s that ARE worth retrying
 * (e.g. hit 15 RPM but daily quota is fine).
 */
function isTemporaryRateLimit(error: any): boolean {
  const msg = String(error?.message || error || '');
  return (
    (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) &&
    !isHardQuotaLimit(error)
  );
}

/**
 * Retry `fn` up to `maxRetries` times on temporary 429s using
 * exponential back-off with ±20 % jitter (60 s → 120 s → 240 s).
 * Hard "limit: 0" errors and non-quota errors surface immediately.
 *
 * Defaults are tuned for batch-then-split: 3 retries starting at 60 s
 * gives Gemini free-tier quota a full minute to reset between attempts.
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  signal?: AbortSignal,
  maxRetries = 3,
  initialDelayMs = 60000,
): Promise<T> {
  const JITTER = 0.2; // ±20 %
  let lastError: any;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (signal?.aborted) throw new Error('Request cancelled');
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      if (isHardQuotaLimit(error)) throw error;     // hard daily cap — stop
      if (!isTemporaryRateLimit(error)) throw error; // non-quota error — stop
      // Temporary rate limit — wait then retry with jitter
      const base = initialDelayMs * Math.pow(2, attempt);
      const delay = Math.round(base * (1 - JITTER + Math.random() * JITTER * 2));
      console.warn(`Rate limit hit. Retrying in ${(delay / 1000).toFixed(1)}s… (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('Request cancelled'));
        }, { once: true });
      });
    }
  }
  throw lastError;
}

// ─── Local .docx extraction ──────────────────────────────────────────

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

async function extractDocxText(attachment: Attachment): Promise<string> {
  const arrayBuffer = base64ToArrayBuffer(attachment.data);
  const result = await mammoth.extractRawText({ arrayBuffer });
  if (!result.value || result.value.trim().length === 0) {
    throw new Error('Could not extract text from the Word document. The file may be empty or protected.');
  }
  return result.value;
}

function isDocx(att: Attachment): boolean {
  return (
    att.mimeType === DOCX_MIME ||
    att.name?.toLowerCase().endsWith('.docx') ||
    att.name?.toLowerCase().endsWith('.doc')
  );
}

// ─── API key validation ──────────────────────────────────────────────

export const validateGeminiApiKey = async (apiKey: string): Promise<boolean> => {
  try {
    const testClient = new GoogleGenAI({ apiKey });
    await testClient.models.generateContent({
      model: FAST_MODEL,
      contents: 'Say "ok"',
    });
    return true;
  } catch (error: any) {
    const msg = String(error?.message || error || '');
    if (
      msg.includes('401') ||
      msg.includes('403') ||
      msg.includes('API_KEY_INVALID') ||
      msg.includes('invalid_api_key')
    ) {
      return false;
    }
    return true; // 429 or other errors → key reached Google → key is valid
  }
};

// ─── Chat session ────────────────────────────────────────────────────

const SYSTEM_INSTRUCTION = `You are the "Canvas Rubric Creator", an expert AI assistant specialized in instructional design and assessment.

**RUBRIC DETECTION GUIDELINES:**
A rubric is generally a table or structured list used for grading. It typically features:
1. Criteria (e.g., "Analysis", "Presentation").
2. Performance levels (e.g., "Excellent", "Poor").
3. Points or point ranges assigned to those levels.

**BE BALANCED:**
- If a document is purely narrative (like a simple memo, letter, or prompt) with NO grading structure, return an empty list.
- However, do NOT be so strict that you ignore tables just because they are inside a project description. If a table looks like it could be used for grading, even if it lacks some headers, attempt to identify it as a rubric.

**CRITICAL: CSV TEMPLATE ADHERENCE**
You must produce CSV files that match the standard Canvas Rubric Import template EXACTLY.

**CSV Structure Rules:**
1. **Header Row:** You MUST include the following exact header row:
   \`Rubric Name,Criteria Name,Criteria Description,Criteria Enable Range,Rating Name,Rating Description,Rating Points,Rating Name,Rating Description,Rating Points,Rating Name,Rating Description,Rating Points,Rating Name,Rating Description,Rating Points\`
2. **Column Order:**
   - Col A: Rubric Name.
   - Col B: Criteria Name.
   - Col C: Criteria Description.
   - Col D: Criteria Enable Range ('TRUE' or 'FALSE').
   - Col E, F, G: Rating triplets (repeating).
3. **Data Integrity:** Ratings MUST be ordered from HIGHEST points to LOWEST points.
4. **Formatting:** Wrap cells in double quotes if they contain commas. Output ONLY the CSV inside a markdown code block labeled "csv".

**Part 2 Behavior (Extraction):**
- Analyze the structure of the document text provided.
- Extract data into the CSV template.
- If multiple rubrics are present, transform the one specified in the user prompt.

**Screenshot Behavior:**
- If the user provides an image, treat it as a visual source.
- Extract the text and structure into a high-quality Markdown table that can be easily copied into MS Word.`;

export const startNewChat = (): void => {
  const ai = getClient();
  chatSession = ai.chats.create({
    model: PRIMARY_MODEL,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.1,
    },
    history: [],
  });
};

/**
 * Send a message to the chat session.
 * .docx attachments are extracted locally with mammoth and sent as text.
 * PDFs are sent as inline data (the API supports PDF natively).
 * Throttled to max 1 request / 4 s; retries up to 3× on temporary 429s.
 * Pass an AbortSignal to cancel pending throttle waits or retry delays.
 */
export const sendMessageToGemini = async (
  text: string,
  attachments: Attachment[] = [],
  signal?: AbortSignal,
): Promise<string> => {
  await throttle(signal);

  return retryWithBackoff(async () => {
    if (signal?.aborted) throw new Error('Request cancelled');

    if (!chatSession) startNewChat();
    if (!chatSession) throw new Error("Failed to initialize chat session.");

    const parts: any[] = [];
    if (text) parts.push({ text });

    for (const att of attachments) {
      if (isDocx(att)) {
        const extracted = await extractDocxText(att);
        parts.push({ text: `\n\n[Document content extracted from "${att.name}"]:\n${extracted}` });
      } else {
        parts.push({ inlineData: { mimeType: att.mimeType, data: att.data } });
      }
    }

    const result = await chatSession.sendMessage({ message: parts });
    return result.text || "";
  }, signal);
};

// ─── Standalone API calls ────────────────────────────────────────────

/**
 * Extract rubric metadata from attached files.
 * Throttled + retried automatically.
 */
export const extractRubricMetadata = async (
  attachments: Attachment[],
  signal?: AbortSignal,
): Promise<RubricMeta[]> => {
  await throttle(signal);

  return retryWithBackoff(async () => {
    if (signal?.aborted) throw new Error('Request cancelled');
    const ai = getClient();

    const parts: any[] = [
      {
        text: "Analyze the following content and identify any structured assessment rubrics. Look for tables containing criteria, performance ratings, and points. If the content is purely narrative with no evaluation criteria, return an empty array. If a grading structure is present, extract its Name, Total Points, and whether it uses Point Ranges or Fixed Points.",
      },
    ];

    for (const att of attachments) {
      if (isDocx(att)) {
        const extracted = await extractDocxText(att);
        parts.push({ text: `\n\n[Document content extracted from "${att.name}"]:\n${extracted}` });
      } else {
        parts.push({ inlineData: { mimeType: att.mimeType, data: att.data } });
      }
    }

    const response = await ai.models.generateContent({
      model: PRIMARY_MODEL,
      contents: [{ parts }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            rubrics: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  totalPoints: { type: Type.STRING },
                  scoringMethod: {
                    type: Type.STRING,
                    description: "Must be exactly 'ranges' or 'fixed'",
                  },
                },
                required: ["name", "totalPoints", "scoringMethod"],
              },
            },
          },
          required: ["rubrics"],
        },
      },
    });

    const result = JSON.parse(response.text || "{}");
    return (result.rubrics || []).map((r: any) => ({
      name: r.name || "",
      totalPoints: r.totalPoints || "",
      scoringMethod: r.scoringMethod === "fixed" ? "fixed" : "ranges",
    }));
  }, signal);
};

/**
 * Validate whether text is a recognizable assignment description.
 */
export async function validateAssignmentDescription(
  text: string,
  signal?: AbortSignal,
): Promise<{ isValid: boolean; message: string }> {
  await throttle(signal);

  return retryWithBackoff(async () => {
    if (signal?.aborted) throw new Error('Request cancelled');
    const ai = getClient();

    const prompt = `
    You are an expert in educational assessment and instructional design.
    Analyze the following text and determine whether it is a recognizable assignment description
    for an educational course. A valid assignment description typically describes what students
    are expected to do, the objectives, deliverables, or assessment criteria for a course assignment.

    TEXT TO ANALYZE:
    ${text}

    Respond with a JSON object:
    - "isValid": true if the text is a recognizable assignment description, false if it is nonsensical,
      random characters, gibberish, completely off-topic, or otherwise not an assignment description.
    - "message": A brief explanation of your determination.
    `;

    const response = await ai.models.generateContent({
      model: PRIMARY_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isValid: { type: Type.BOOLEAN },
            message: { type: Type.STRING },
          },
          required: ["isValid", "message"],
        },
      },
    });

    if (!response.text) {
      return { isValid: true, message: "Validation could not be completed." };
    }
    return JSON.parse(response.text.trim()) as { isValid: boolean; message: string };
  }, signal);
}

/**
 * Generate a rubric from an assignment description.
 */
export async function generateRubricFromDescription(
  assignmentDescription: string,
  settings: GenerationSettings,
  signal?: AbortSignal,
): Promise<RubricData> {
  await throttle(signal);

  return retryWithBackoff(async () => {
    if (signal?.aborted) throw new Error('Request cancelled');
    const ai = getClient();

    const processingInstruction = settings.processingType === ProcessingType.MULTIPLE
      ? `The assignment description may contain MULTIPLE distinct assignments or components.
      Generate a SEPARATE rubric for each distinct assignment or component found in the description.
      Each rubric should have its own title, criteria, and point distribution.
      The total points constraint applies to EACH individual rubric.`
      : `Generate a SINGLE rubric that covers the entire assignment description.`;

    const prompt = `
    Act as an expert in instructional design and assessment.
    Based on the following assignment description, create a professional rubric.

    PROCESSING MODE: ${settings.processingType === ProcessingType.MULTIPLE ? 'MULTIPLE RUBRICS' : 'SINGLE RUBRIC'}
    ${processingInstruction}

    ASSIGNMENT DESCRIPTION:
    ${assignmentDescription}

    CONSTRAINTS:
    - Total points for the entire assignment must be exactly ${settings.totalPoints}.
    - Point style preference: ${
      settings.pointStyle === PointStyle.RANGE
        ? "Point ranges (e.g., 10-9 pts)"
        : "Single point values (e.g., 10 pts)"
    }.
    - Ratings columns MUST BE: Exemplary, Proficient, Developing, and Unsatisfactory.
    - Break down the ${settings.totalPoints} points across logical categories/criteria.
    - For each category, describe specific behaviors or qualities for each of the four ratings.

    Format the output as a JSON object matching the RubricData structure.
  `;

    const response = await ai.models.generateContent({
      model: PRIMARY_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            totalPoints: { type: Type.NUMBER },
            criteria: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  category: { type: Type.STRING },
                  description: { type: Type.STRING },
                  exemplary: {
                    type: Type.OBJECT,
                    properties: { text: { type: Type.STRING }, points: { type: Type.STRING } },
                    required: ["text", "points"],
                  },
                  proficient: {
                    type: Type.OBJECT,
                    properties: { text: { type: Type.STRING }, points: { type: Type.STRING } },
                    required: ["text", "points"],
                  },
                  developing: {
                    type: Type.OBJECT,
                    properties: { text: { type: Type.STRING }, points: { type: Type.STRING } },
                    required: ["text", "points"],
                  },
                  unsatisfactory: {
                    type: Type.OBJECT,
                    properties: { text: { type: Type.STRING }, points: { type: Type.STRING } },
                    required: ["text", "points"],
                  },
                  totalPoints: { type: Type.NUMBER },
                },
                required: ["category", "description", "exemplary", "proficient", "developing", "unsatisfactory", "totalPoints"],
              },
            },
          },
          required: ["title", "totalPoints", "criteria"],
        },
      },
    });

    if (!response.text) throw new Error("Failed to generate rubric content.");
    return JSON.parse(response.text.trim()) as RubricData;
  }, signal);
}

/**
 * Generate a rubric from a screenshot image.
 */
export async function generateRubricFromScreenshot(
  imageData: { data: string; mimeType: string },
  settings: GenerationSettings,
  signal?: AbortSignal,
): Promise<RubricData> {
  await throttle(signal);

  return retryWithBackoff(async () => {
    if (signal?.aborted) throw new Error('Request cancelled');
    const ai = getClient();

    const textPrompt = `
    Act as an expert in instructional design and assessment digitization.

    TASK:
    Analyze the provided screenshot of a Canvas LMS rubric and convert it into a perfectly structured JSON format.

    EXTRACTION RULES:
    1. TITLE: Extract the assignment/rubric title from the top of the image.
    2. CRITERIA: Identify each row. Extract the 'Criteria' name and any supporting description text.
    3. RATINGS: Map the 4-column structure.
       - Column 1: Exemplary (or highest level)
       - Column 2: Proficient
       - Column 3: Developing
       - Column 4: Unsatisfactory (or lowest level)
       *Extract both the descriptor text AND the point value associated with each rating.*
    4. TOTALS: Capture the total points possible for each criterion row.

    OUTPUT REQUIREMENTS:
    - If the point values in the screenshot are ranges, format them as ranges (e.g., "40-36").
    - If they are single values, format as single values.
    - Ensure the 'totalPoints' field in JSON is the sum of all row totals found.

    Format the output as a JSON object matching the RubricData structure.
  `;

    const response = await ai.models.generateContent({
      model: PRIMARY_MODEL,
      contents: { parts: [{ inlineData: imageData }, { text: textPrompt }] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            totalPoints: { type: Type.NUMBER },
            criteria: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  category: { type: Type.STRING },
                  description: { type: Type.STRING },
                  exemplary: {
                    type: Type.OBJECT,
                    properties: { text: { type: Type.STRING }, points: { type: Type.STRING } },
                    required: ["text", "points"],
                  },
                  proficient: {
                    type: Type.OBJECT,
                    properties: { text: { type: Type.STRING }, points: { type: Type.STRING } },
                    required: ["text", "points"],
                  },
                  developing: {
                    type: Type.OBJECT,
                    properties: { text: { type: Type.STRING }, points: { type: Type.STRING } },
                    required: ["text", "points"],
                  },
                  unsatisfactory: {
                    type: Type.OBJECT,
                    properties: { text: { type: Type.STRING }, points: { type: Type.STRING } },
                    required: ["text", "points"],
                  },
                  totalPoints: { type: Type.NUMBER },
                },
                required: ["category", "description", "exemplary", "proficient", "developing", "unsatisfactory", "totalPoints"],
              },
            },
          },
          required: ["title", "totalPoints", "criteria"],
        },
      },
    });

    if (!response.text) throw new Error("Failed to process rubric screenshot.");
    return JSON.parse(response.text.trim()) as RubricData;
  }, signal);
}

// ─── Phase 3: CSV pre-upload analysis ───────────────────────────────

export interface CsvAnalysisResult {
  rubricName: string;
  criteriaCount: number;
  totalPoints: number;
  isValid: boolean;
  notes: string;
}

/**
 * Use Gemini to analyse a Canvas rubric CSV before it is uploaded to Canvas.
 * Returns the rubric name, criteria count, total points, validity flag and a
 * one-sentence summary.  Throttled + retried like every other API call.
 */
export async function analyzeCsvForCanvas(
  csvContent: string,
  signal?: AbortSignal,
): Promise<CsvAnalysisResult> {
  await throttle(signal);

  return retryWithBackoff(async () => {
    if (signal?.aborted) throw new Error('Request cancelled');
    const ai = getClient();

    const response = await ai.models.generateContent({
      model: PRIMARY_MODEL,
      contents: `Analyze this Canvas rubric CSV file and extract the following:
- rubricName: the rubric title from column A of the first data row
- criteriaCount: total number of criteria rows (data rows only, not the header)
- totalPoints: total points for the rubric
- isValid: true if this matches a properly-formatted Canvas rubric CSV (has the required header row and at least one data row), false if it appears malformed
- notes: one sentence summarising the rubric

CSV content (first 3000 characters):
${csvContent.slice(0, 3000)}`,
      config: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            rubricName:    { type: Type.STRING },
            criteriaCount: { type: Type.NUMBER },
            totalPoints:   { type: Type.NUMBER },
            isValid:       { type: Type.BOOLEAN },
            notes:         { type: Type.STRING },
          },
          required: ['rubricName', 'criteriaCount', 'totalPoints', 'isValid', 'notes'],
        },
      },
    });

    if (!response.text) throw new Error('No analysis response from Gemini');
    return JSON.parse(response.text.trim()) as CsvAnalysisResult;
  }, signal);
}

/**
 * Generate a Canvas-compatible CSV for a single named rubric extracted
 * from the given attachment.
 *
 * Uses a standalone generateContent call (not the shared chat session)
 * so multiple rubrics can be dispatched concurrently from Part 2 — the
 * queue-based throttle serialises their API calls at 1 per 4 s.
 */
export async function generateCsvForRubric(
  rubricName: string,
  totalPoints: string,
  scoringMethod: 'ranges' | 'fixed',
  attachment: Attachment,
  signal?: AbortSignal,
): Promise<string> {
  await throttle(signal);

  return retryWithBackoff(async () => {
    if (signal?.aborted) throw new Error('Request cancelled');
    const ai = getClient();

    const scoringDetail =
      scoringMethod === 'ranges'
        ? 'Set "Criteria Enable Range" to TRUE. Use point ranges (e.g., "90-100", "80-89").'
        : 'Set "Criteria Enable Range" to FALSE. Use fixed single points (e.g., "10", "8").';

    const prompt = `Extract the rubric named "${rubricName}" from this document and convert it to a Canvas-compatible CSV.

SPECIFICATIONS:
- Rubric name: "${rubricName}"
- Total points: ${totalPoints || 'as detected in the document'}
- Scoring: ${scoringDetail}

REQUIRED HEADER ROW (copy verbatim on line 1):
Rubric Name,Criteria Name,Criteria Description,Criteria Enable Range,Rating Name,Rating Description,Rating Points,Rating Name,Rating Description,Rating Points,Rating Name,Rating Description,Rating Points,Rating Name,Rating Description,Rating Points

DATA RULES:
1. One row per criterion.
2. "Rubric Name" column: populate ONLY on the first data row; leave blank on all subsequent rows.
3. Ratings must be ordered HIGHEST to LOWEST points.
4. Wrap any field containing a comma in double quotes.
5. Return ONLY the raw CSV — no markdown fences, no prose, no extra blank lines before the header.`;

    const parts: any[] = [{ text: prompt }];

    if (isDocx(attachment)) {
      const extracted = await extractDocxText(attachment);
      parts.push({ text: `\n\n[Document content from "${attachment.name}"]:\n${extracted}` });
    } else {
      parts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.data } });
    }

    const response = await ai.models.generateContent({
      model: PRIMARY_MODEL,
      contents: [{ parts }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.1,
      },
    });

    const text = response.text ?? '';
    // Strip markdown code fences if the model includes them despite instructions
    const fenceMatch = text.match(/```(?:csv)?\n?([\s\S]*?)\n?```/);
    return fenceMatch ? fenceMatch[1].trim() : text.trim();
  }, signal);
}

// ─── Phase 2: Rubric discovery (pass 1 of 2) ────────────────────────

export interface RubricDiscovery {
  name: string;
  scoringMethod: 'ranges' | 'fixed';
}

/**
 * Lightweight first-pass: ask Gemini to list all rubric titles (and
 * scoring methods) in the document WITHOUT generating any CSV content.
 * Returns quickly because the output is tiny, regardless of how many
 * rubrics the document contains.  Used by the two-pass generation flow
 * so the UI can render all rubric cards (in pending state) before
 * per-rubric CSV generation begins.
 */
export async function discoverRubricTitles(
  attachment: Attachment,
  signal?: AbortSignal,
): Promise<RubricDiscovery[]> {
  await throttle(signal);

  return retryWithBackoff(async () => {
    if (signal?.aborted) throw new Error('Request cancelled');
    const ai = getClient();

    const prompt = `List every grading rubric in this document.

For each rubric return:
- name: the exact rubric title as it appears in the document
- scoringMethod: "ranges" if the rubric uses point ranges (e.g. "40–50 pts", "90-100"), "fixed" if it uses single point values (e.g. "10 pts", "8")

Do NOT generate CSV content — titles and scoring methods only.`;

    const parts: any[] = [{ text: prompt }];

    if (isDocx(attachment)) {
      const extracted = await extractDocxText(attachment);
      parts.push({ text: `\n\n[Document content from "${attachment.name}"]:\n${extracted}` });
    } else {
      parts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.data } });
    }

    const response = await ai.models.generateContent({
      model: FAST_MODEL,
      contents: [{ parts }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            rubrics: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name:          { type: Type.STRING },
                  scoringMethod: { type: Type.STRING },
                },
                required: ['name', 'scoringMethod'],
              },
            },
          },
          required: ['rubrics'],
        },
      },
    });

    if (!response.text) throw new Error('No response from rubric discovery call');
    const parsed = JSON.parse(response.text.trim()) as {
      rubrics: Array<{ name: string; scoringMethod: string }>;
    };
    if (!Array.isArray(parsed.rubrics) || parsed.rubrics.length === 0) {
      throw new Error('No rubrics found in document — check that the file contains rubric tables');
    }
    return parsed.rubrics.map((r) => ({
      name: r.name,
      scoringMethod: r.scoringMethod === 'fixed' ? ('fixed' as const) : ('ranges' as const),
    }));
  }, signal);
}

// ─── Phase 2: Batch rubric generation (legacy — kept for reference) ──

export interface BatchRubricResult {
  title: string;
  csv: string;
}

/**
 * Send ALL rubric tables in a single document to Gemini in ONE call and
 * return a structured array of {title, csv} pairs.
 *
 * This "batch-then-split" model avoids the N×throttle cost of calling
 * generateCsvForRubric once per rubric — the 15-second governor fires
 * once for the whole document, not per rubric.
 *
 * Retries use a 60-second initial cooldown (vs 5 s for per-rubric calls)
 * to give the free-tier quota time to fully reset before re-attempting a
 * large, token-heavy request.
 */
export async function generateAllCsvsFromDoc(
  attachment: Attachment,
  signal?: AbortSignal,
): Promise<BatchRubricResult[]> {
  await throttle(signal);

  return retryWithBackoff(async () => {
    if (signal?.aborted) throw new Error('Request cancelled');
    const ai = getClient();

    const prompt = `Extract ALL rubric tables from this document and convert each one to a Canvas-compatible CSV string.

REQUIRED CSV HEADER ROW (copy verbatim as the first line of every csv value):
Rubric Name,Criteria Name,Criteria Description,Criteria Enable Range,Rating Name,Rating Description,Rating Points,Rating Name,Rating Description,Rating Points,Rating Name,Rating Description,Rating Points,Rating Name,Rating Description,Rating Points

DATA RULES:
1. One row per criterion.
2. "Rubric Name" column: populate ONLY on the first data row of each CSV; leave blank on all subsequent rows.
3. Ratings must be ordered HIGHEST to LOWEST points.
4. Detect the scoring method from the source document for each rubric:
   - If the rubric uses point ranges (e.g., "40–50 pts", "90-100"), set "Criteria Enable Range" to TRUE and format Rating Points as ranges (e.g., "90-100", "80-89").
   - If the rubric uses single fixed values (e.g., "10 pts", "8"), set "Criteria Enable Range" to FALSE and use plain numbers only (e.g., "10", "8").
5. Wrap any field containing a comma in double quotes.
6. No markdown fences, no prose — only raw CSV content in each csv field.

Return a JSON object with a "rubrics" array. Each element must have:
- "title": the rubric name exactly as it appears in the document
- "csv": the complete CSV string including the header row`;

    const parts: any[] = [{ text: prompt }];

    if (isDocx(attachment)) {
      const extracted = await extractDocxText(attachment);
      parts.push({ text: `\n\n[Document content from "${attachment.name}"]:\n${extracted}` });
    } else {
      parts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.data } });
    }

    const response = await ai.models.generateContent({
      model: PRIMARY_MODEL,
      contents: [{ parts }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.4,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            rubrics: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  csv:   { type: Type.STRING },
                },
                required: ['title', 'csv'],
              },
            },
          },
          required: ['rubrics'],
        },
      },
    });

    if (!response.text) throw new Error('No response from Gemini batch call');
    const parsed = JSON.parse(response.text.trim()) as { rubrics: BatchRubricResult[] };
    if (!Array.isArray(parsed.rubrics) || parsed.rubrics.length === 0) {
      throw new Error('No rubrics found in document — check that the file contains rubric tables');
    }
    return parsed.rubrics;
  }, signal);
}

// ─── Phase 1 → Phase 2 direct carry-forward ─────────────────────────

/**
 * Build a Canvas-compatible CSV directly from a Phase 1 RubricData object.
 * No API call required — all data is already structured.
 *
 * @param rubric       The RubricData object produced by Phase 1.
 * @param scoringMethod 'ranges' sets Criteria Enable Range=TRUE; 'fixed' sets FALSE.
 * @returns Raw CSV string ready for Canvas import.
 */
export function generateCsvFromRubricObject(
  rubric: RubricData,
  scoringMethod: 'ranges' | 'fixed',
): string {
  const HEADER =
    'Rubric Name,Criteria Name,Criteria Description,Criteria Enable Range,' +
    'Rating Name,Rating Description,Rating Points,' +
    'Rating Name,Rating Description,Rating Points,' +
    'Rating Name,Rating Description,Rating Points,' +
    'Rating Name,Rating Description,Rating Points';

  const enableRange = scoringMethod === 'ranges' ? 'TRUE' : 'FALSE';

  /** Wrap a field in double-quotes if it contains commas, quotes, or newlines. */
  const q = (s: string): string => {
    const str = String(s ?? '');
    return str.includes(',') || str.includes('"') || str.includes('\n')
      ? `"${str.replace(/"/g, '""')}"`
      : str;
  };

  const rows = rubric.criteria.map((c, i) => {
    const rubricName = i === 0 ? q(rubric.title) : '';
    const ratings: [string, { text: string; points: string }][] = [
      ['Exemplary',      c.exemplary],
      ['Proficient',     c.proficient],
      ['Developing',     c.developing],
      ['Unsatisfactory', c.unsatisfactory],
    ];
    const ratingCols = ratings.flatMap(([name, r]) => [q(name), q(r.text), q(r.points)]);
    return [rubricName, q(c.category), q(c.description), enableRange, ...ratingCols].join(',');
  });

  return [HEADER, ...rows].join('\n');
}
