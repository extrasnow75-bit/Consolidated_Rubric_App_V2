import { GoogleGenAI, Chat, Type } from "@google/genai";
import { GenerationSettings, PointStyle, RubricData, Attachment, RubricMeta } from "../types";

let client: GoogleGenAI | null = null;
let chatSession: Chat | null = null;

const getClient = (): GoogleGenAI => {
  if (!client) {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("Gemini API Key not found in environment variables");
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
};

/**
 * Utility to retry a function with exponential backoff.
 * Primarily handles 429 RESOURCE_EXHAUSTED errors.
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 2000
): Promise<T> {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const errorMessage = error.message || "";
      if (
        errorMessage.includes("429") ||
        errorMessage.includes("RESOURCE_EXHAUSTED") ||
        errorMessage.includes("quota")
      ) {
        const delay = initialDelay * Math.pow(2, i);
        console.warn(
          `Quota exceeded. Retrying in ${delay}ms... (Attempt ${i + 1}/${maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

/**
 * Start a new chat session with Canvas Rubric instruction
 */
export const startNewChat = (): void => {
  const ai = getClient();
  const systemInstruction = `You are the "Canvas Rubric Creator", an expert AI assistant specialized in instructional design and assessment.

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
- Analyze the structure of MS Word (.docx) or PDF docs.
- Extract data into the CSV template.
- If multiple rubrics are present, transform the one specified in the user prompt.

**Screenshot Behavior:**
- If the user provides an image, treat it as a visual source.
- Extract the text and structure into a high-quality Markdown table that can be easily copied into MS Word.`;

  chatSession = ai.chats.create({
    model: 'gemini-2.0-flash',
    config: {
      systemInstruction,
      temperature: 0.1,
    },
    history: [],
  });
};

/**
 * Extract rubric metadata from attached files
 */
export const extractRubricMetadata = async (
  attachments: Attachment[]
): Promise<RubricMeta[]> => {
  return retryWithBackoff(async () => {
    const ai = getClient();

    const parts: any[] = [
      {
        text: "Analyze the attached document and identify any structured assessment rubrics. Look for tables containing criteria, performance ratings, and points. If the document is purely a narrative memo or template with no evaluation criteria, return an empty array. If a grading structure is present, extract its Name, Total Points, and whether it uses Point Ranges or Fixed Points.",
      },
    ];

    attachments.forEach((att) => {
      parts.push({
        inlineData: {
          mimeType: att.mimeType,
          data: att.data,
        },
      });
    });

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
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
  });
};

/**
 * Send a message to the chat session (maintains context)
 */
export const sendMessageToGemini = async (
  text: string,
  attachments: Attachment[] = []
): Promise<string> => {
  return retryWithBackoff(async () => {
    if (!chatSession) {
      startNewChat();
    }

    if (!chatSession) {
      throw new Error("Failed to initialize chat session");
    }

    const parts: any[] = [];

    if (text) {
      parts.push({ text });
    }

    attachments.forEach((att) => {
      parts.push({
        inlineData: {
          mimeType: att.mimeType,
          data: att.data,
        },
      });
    });

    const result = await chatSession.sendMessage({
      message: parts,
    });
    return result.text || "";
  });
};

/**
 * Generate a rubric from assignment description
 */
export async function generateRubricFromDescription(
  assignmentDescription: string,
  settings: GenerationSettings
): Promise<RubricData> {
  return retryWithBackoff(async () => {
    const ai = getClient();

    const prompt = `
    Act as an expert in instructional design and assessment.
    Based on the following assignment description, create a professional rubric.

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
      model: 'gemini-2.0-flash',
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
                    properties: {
                      text: { type: Type.STRING },
                      points: { type: Type.STRING },
                    },
                    required: ["text", "points"],
                  },
                  proficient: {
                    type: Type.OBJECT,
                    properties: {
                      text: { type: Type.STRING },
                      points: { type: Type.STRING },
                    },
                    required: ["text", "points"],
                  },
                  developing: {
                    type: Type.OBJECT,
                    properties: {
                      text: { type: Type.STRING },
                      points: { type: Type.STRING },
                    },
                    required: ["text", "points"],
                  },
                  unsatisfactory: {
                    type: Type.OBJECT,
                    properties: {
                      text: { type: Type.STRING },
                      points: { type: Type.STRING },
                    },
                    required: ["text", "points"],
                  },
                  totalPoints: { type: Type.NUMBER },
                },
                required: [
                  "category",
                  "description",
                  "exemplary",
                  "proficient",
                  "developing",
                  "unsatisfactory",
                  "totalPoints",
                ],
              },
            },
          },
          required: ["title", "totalPoints", "criteria"],
        },
      },
    });

    if (!response.text) {
      throw new Error("Failed to generate rubric content.");
    }

    return JSON.parse(response.text.trim()) as RubricData;
  });
}

/**
 * Generate a rubric from screenshot image
 */
export async function generateRubricFromScreenshot(
  imageData: { data: string; mimeType: string },
  settings: GenerationSettings
): Promise<RubricData> {
  return retryWithBackoff(async () => {
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
      model: 'gemini-2.0-flash',
      contents: {
        parts: [
          { inlineData: imageData },
          { text: textPrompt }
        ]
      },
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
                    properties: {
                      text: { type: Type.STRING },
                      points: { type: Type.STRING },
                    },
                    required: ["text", "points"],
                  },
                  proficient: {
                    type: Type.OBJECT,
                    properties: {
                      text: { type: Type.STRING },
                      points: { type: Type.STRING },
                    },
                    required: ["text", "points"],
                  },
                  developing: {
                    type: Type.OBJECT,
                    properties: {
                      text: { type: Type.STRING },
                      points: { type: Type.STRING },
                    },
                    required: ["text", "points"],
                  },
                  unsatisfactory: {
                    type: Type.OBJECT,
                    properties: {
                      text: { type: Type.STRING },
                      points: { type: Type.STRING },
                    },
                    required: ["text", "points"],
                  },
                  totalPoints: { type: Type.NUMBER },
                },
                required: [
                  "category",
                  "description",
                  "exemplary",
                  "proficient",
                  "developing",
                  "unsatisfactory",
                  "totalPoints",
                ],
              },
            },
          },
          required: ["title", "totalPoints", "criteria"],
        },
      },
    });

    if (!response.text) {
      throw new Error("Failed to process rubric screenshot.");
    }

    return JSON.parse(response.text.trim()) as RubricData;
  });
}
