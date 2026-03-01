import { CanvasConfig, RubricConfig, RubricPayload, CanvasUser } from "../types";

/**
 * Robust CSV parser that handles quotes and escaped characters properly
 */
const parseCSV = (csvText: string): string[][] => {
  const result: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuote = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"' && inQuote && nextChar === '"') {
      cur += '"';
      i++;
    } else if (char === '"') {
      inQuote = !inQuote;
    } else if (char === "," && !inQuote) {
      row.push(cur.trim());
      cur = "";
    } else if ((char === "\n" || char === "\r") && !inQuote) {
      if (char === "\r" && nextChar === "\n") i++;
      row.push(cur.trim());
      if (row.length > 0) result.push(row);
      row = [];
      cur = "";
    } else {
      cur += char;
    }
  }
  if (cur || row.length > 0) {
    row.push(cur.trim());
    result.push(row);
  }
  return result;
};

/**
 * Push a rubric CSV to Canvas LMS (JSON approach matching working app)
 */
export const pushRubricToCanvas = async (
  config: CanvasConfig,
  csvContent: string
): Promise<{ success: boolean; message: string }> => {
  try {
    const { courseHomeUrl, accessToken } = config;

    if (!courseHomeUrl || !accessToken) {
      return {
        success: false,
        message:
          "Canvas configuration is incomplete. Please enter your Course URL and Access Token.",
      };
    }

    let instanceUrl = "";
    let courseId = "";

    const urlMatch = courseHomeUrl.match(
      /^(https?:\/\/[^\/]+)(?:\/courses\/(\d+))/i
    );
    if (!urlMatch) {
      return {
        success: false,
        message:
          "Could not find a Course ID in that URL. Please paste a link from inside your Canvas course (e.g., https://canvas.your-school.edu/courses/12345)",
      };
    }
    instanceUrl = urlMatch[1];
    courseId = urlMatch[2];

    // In development the Vite dev server proxies /canvas-proxy/* to the
    // Canvas instance (set via x-canvas-base header), bypassing browser CORS.
    const isDev = import.meta.env.DEV;
    const endpoint = isDev
      ? `/canvas-proxy/api/v1/courses/${courseId}/rubrics`
      : `${instanceUrl}/api/v1/courses/${courseId}/rubrics`;

    const data = parseCSV(csvContent);
    if (data.length < 2) {
      return {
        success: false,
        message: "The CSV appears to be empty or formatted incorrectly.",
      };
    }

    // Header-based column detection (matching working app approach)
    const headers = data[0].map((h) => h.toLowerCase().trim());
    const idxRubricName = headers.findIndex(
      (h) => h.includes("rubric name") || h.includes("rubric title")
    );
    const idxCriteriaName = headers.findIndex((h) =>
      h.includes("criteria name")
    );
    const idxCriteriaDesc = headers.findIndex((h) =>
      h.includes("criteria description")
    );
    const idxRatingStart = headers.findIndex(
      (h) => h.includes("rating") && (h.includes("name") || h.includes("1"))
    );

    if (idxRubricName === -1 || idxCriteriaName === -1 || idxRatingStart === -1) {
      return {
        success: false,
        message:
          "CSV headers not recognized. Expected columns: Rubric Name, Criteria Name, Criteria Description, Rating Name, Rating Description, Points, …",
      };
    }

    const dataRows = data
      .slice(1)
      .filter((r) => r.length > idxCriteriaName && r[idxCriteriaName]?.trim());

    if (dataRows.length === 0) {
      return {
        success: false,
        message: "The CSV appears to be empty or formatted incorrectly.",
      };
    }

    const rubricTitle = dataRows[0][idxRubricName] || "Imported Rubric";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const criteria: Record<string, any> = {};

    dataRows.forEach((row, rowIndex) => {
      const criterionKey = String(rowIndex + 1);
      const criterionName = row[idxCriteriaName] || `Criterion ${rowIndex + 1}`;
      const criterionDesc =
        idxCriteriaDesc >= 0 ? row[idxCriteriaDesc] || "" : "";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ratings: Record<string, any> = {};
      let ratingCounter = 1;

      for (let j = idxRatingStart; j < row.length; j += 3) {
        const rTitle = row[j];
        const rDesc = row[j + 1] || "";
        const rPointsRaw = row[j + 2];

        if (rTitle !== undefined && rTitle.trim() !== "" && rPointsRaw !== undefined) {
          const rPoints = parseFloat(rPointsRaw) || 0;
          ratings[String(ratingCounter)] = {
            description: rTitle.trim(),
            long_description: rDesc.trim(),
            points: rPoints,
          };
          ratingCounter++;
        }
      }

      criteria[criterionKey] = {
        description: criterionName,
        long_description: criterionDesc,
        ratings,
      };
    });

    const payload: RubricPayload = {
      rubric: { title: rubricTitle, criteria },
      rubric_association: {
        association_id: courseId,
        association_type: "Course",
        use_for_grading: false,
        purpose: "bookmarking",
      },
    };

    const fetchHeaders: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
    };
    if (isDev) fetchHeaders["x-canvas-base"] = instanceUrl;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: fetchHeaders,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        message: `Canvas Error (${response.status}): ${
          errorData.errors?.[0]?.message || response.statusText
        }. Check your course URL and Token.`,
      };
    }

    return {
      success: true,
      message:
        "Success! The rubric has been uploaded and can now be found in your Canvas 'Rubrics' list.",
    };
  } catch (error: any) {
    console.error("Canvas Push Error:", error);

    if (error.message === "Failed to fetch") {
      return {
        success: false,
        message:
          "**STILL BLOCKED BY BROWSER (CORS)**: If you have an extension installed and it's still failing, check these 3 things:\n\n" +
          "1. **Switch ON**: Click the extension icon and make sure the big power toggle is **ON/Green**.\n\n" +
          "2. **Whitelist**: Some extensions (like 'Allow CORS') require you to add your Canvas URL (e.g., `https://canvas.boisestate.edu/*`) into their internal 'Whitelisted Domains' list.\n\n" +
          "3. **Page Reload**: You MUST refresh this application page AFTER turning the extension on.\n\n" +
          "**GIVE UP?** If this is too much trouble, click the **'Download CSV'** button below and use **Option B** (Manual Upload). It works 100% of the time without any extensions.",
      };
    }

    return {
      success: false,
      message: `Communication Error: ${error.message}`,
    };
  }
};

/**
 * Get base URL from Canvas URL (App4 approach)
 */
export const getBaseUrl = (canvasUrl: string) => {
  let inputUrl = canvasUrl.trim();
  inputUrl = inputUrl.replace(/^https?:\/\//, "");
  const domain = inputUrl.split("/")[0];
  return `https://${domain}`;
};

/**
 * Clean Canvas API token
 */
export const getCleanToken = (token: string) => {
  if (!token) return "";
  return token.trim().replace(/^Bearer\s+/i, "");
};

/**
 * Wrap URL with proxy if needed
 */
export const wrapUrl = (targetUrl: string, config: RubricConfig) => {
  return config.useProxy ? `${config.proxyService}${targetUrl}` : targetUrl;
};

/**
 * Test Canvas API token (App4 approach)
 */
export const testCanvasToken = async (
  config: RubricConfig
): Promise<CanvasUser> => {
  const base = getBaseUrl(config.canvasUrl);
  const isDev = import.meta.env.DEV;
  const fetchUrl = isDev
    ? `/canvas-proxy/api/v1/users/self/profile`
    : wrapUrl(`${base}/api/v1/users/self/profile`, config);

  const fetchHeaders: Record<string, string> = {
    Authorization: `Bearer ${getCleanToken(config.token)}`,
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
  };
  if (isDev) fetchHeaders["x-canvas-base"] = base;

  const response = await fetch(fetchUrl, {
    method: "GET",
    headers: fetchHeaders,
  });

  const text = await response.text();
  const cleanText = text.replace(/^while\(1\);/, "");

  if (!response.ok) {
    throw new Error(
      `Canvas API responded with ${response.status}: ${cleanText}`
    );
  }

  return JSON.parse(cleanText) as CanvasUser;
};

/**
 * Create rubric via JSON payload (App4 approach)
 */
export const createRubric = async (
  config: RubricConfig,
  payload: RubricPayload
): Promise<any> => {
  const targetUrl = `${getBaseUrl(
    config.canvasUrl
  )}/api/v1/courses/${config.courseId}/rubrics`;
  const fetchUrl = wrapUrl(targetUrl, config);

  const response = await fetch(fetchUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getCleanToken(config.token)}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  const cleanText = text.replace(/^while\(1\);/, "");

  if (!response.ok) {
    throw new Error(`Canvas API Error (${response.status}): ${cleanText}`);
  }

  return JSON.parse(cleanText);
};
