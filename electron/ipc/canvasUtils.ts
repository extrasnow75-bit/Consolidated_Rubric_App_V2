/**
 * Pure helpers for turning a rubric CSV into a Canvas API payload.
 *
 * Split out from canvas.ts so they can be unit-tested without Electron: every defect this app has
 * had in the Canvas path has been in string handling — a quoted field, a stray CRLF, a header
 * spelled slightly differently — rather than in the HTTP call.
 */

/** A Canvas course, as parsed out of a URL the user pasted. */
export interface CourseRef {
  /** Scheme + host, e.g. "https://boisestate.instructure.com". No trailing slash. */
  origin: string
  /** Host only, for allowlist comparisons. */
  host: string
  courseId: string
}

/**
 * CSV parser that handles quoted fields, escaped quotes and either line ending.
 *
 * Rubric text routinely contains commas ("Clear, well-organised argument") and quotation marks,
 * so a naive `split(',')` mangles real input rather than edge cases.
 */
export const parseCSV = (csvText: string): string[][] => {
  const result: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQuote = false

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i]
    const nextChar = csvText[i + 1]

    if (char === '"' && inQuote && nextChar === '"') {
      cur += '"'
      i++
    } else if (char === '"') {
      inQuote = !inQuote
    } else if (char === ',' && !inQuote) {
      row.push(cur.trim())
      cur = ''
    } else if ((char === '\n' || char === '\r') && !inQuote) {
      if (char === '\r' && nextChar === '\n') i++
      row.push(cur.trim())
      if (row.length > 0) result.push(row)
      row = []
      cur = ''
    } else {
      cur += char
    }
  }
  if (cur || row.length > 0) {
    row.push(cur.trim())
    result.push(row)
  }
  return result
}

/**
 * Pull the Canvas origin and course id out of a URL the user pasted.
 *
 * Returns null for anything that is not an HTTPS Canvas course URL. The HTTPS requirement is not
 * pedantry: this origin is what the Canvas token gets sent to, and over plain HTTP that token —
 * and with it every student record the instructor can see — crosses the network in the clear.
 *
 * Private, loopback and link-local hosts are refused for the same reason the web app's proxy
 * refused them. There the concern was SSRF through a server-side proxy; here it is narrower but
 * real — a course URL pointing at 169.254.169.254 or a LAN address is not a Canvas instance, and
 * sending an instructor's token there is never the right outcome.
 */
export function parseCourseUrl(courseUrl: string): CourseRef | null {
  let parsed: URL
  try {
    parsed = new URL(courseUrl.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null

  const host = parsed.hostname
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return null
  const oct = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (oct) {
    const [, a, b] = oct.map(Number)
    if (a === 10) return null // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return null // 172.16.0.0/12
    if (a === 192 && b === 168) return null // 192.168.0.0/16
    if (a === 169 && b === 254) return null // 169.254.0.0/16 — link-local, cloud metadata
    if (a === 0) return null // 0.0.0.0/8
    if (a === 127) return null // loopback by address
  }

  const courseMatch = parsed.pathname.match(/\/courses\/(\d+)/)
  if (!courseMatch) return null

  return {
    origin: `${parsed.protocol}//${parsed.host}`,
    host: parsed.host,
    courseId: courseMatch[1],
  }
}

export interface RubricPayload {
  rubric: {
    title: string
    criteria: Record<string, unknown>
  }
  rubric_association: {
    association_id: string
    association_type: string
    use_for_grading: boolean
    purpose: string
  }
}

export type PayloadResult =
  | { ok: true; payload: RubricPayload }
  | { ok: false; message: string }

/**
 * Turn a rubric CSV into the JSON body Canvas's rubrics endpoint expects.
 *
 * Columns are located by header name rather than position, because the CSVs come from several
 * places — this app's own generator, a Google Sheet a colleague edited, a hand-built file — and
 * the column order is not stable across them. Rating columns repeat in groups of three
 * (name, description, points) from the first rating column to the end of the row.
 */
export function buildRubricPayload(csvContent: string, courseId: string): PayloadResult {
  const data = parseCSV(csvContent)
  if (data.length < 2) {
    return { ok: false, message: 'The CSV appears to be empty or formatted incorrectly.' }
  }

  const headers = data[0].map((h) => h.toLowerCase().trim())
  const idxRubricName = headers.findIndex(
    (h) => h.includes('rubric name') || h.includes('rubric title'),
  )
  const idxCriteriaName = headers.findIndex((h) => h.includes('criteria name'))
  const idxCriteriaDesc = headers.findIndex((h) => h.includes('criteria description'))
  const idxRatingStart = headers.findIndex(
    (h) => h.includes('rating') && (h.includes('name') || h.includes('1')),
  )
  const idxEnableRange = headers.findIndex((h) => h.includes('enable range'))

  if (idxRubricName === -1 || idxCriteriaName === -1 || idxRatingStart === -1) {
    return {
      ok: false,
      message:
        'CSV headers not recognized. Expected columns: Rubric Name, Criteria Name, ' +
        'Criteria Description, Rating Name, Rating Description, Points, …',
    }
  }

  const dataRows = data
    .slice(1)
    .filter((r) => r.length > idxCriteriaName && r[idxCriteriaName]?.trim())

  if (dataRows.length === 0) {
    return { ok: false, message: 'The CSV appears to be empty or formatted incorrectly.' }
  }

  const rubricTitle = dataRows[0][idxRubricName] || 'Imported Rubric'
  const criteria: Record<string, unknown> = {}

  dataRows.forEach((row, rowIndex) => {
    const criterionKey = String(rowIndex + 1)
    const criterionName = row[idxCriteriaName] || `Criterion ${rowIndex + 1}`
    const criterionDesc = idxCriteriaDesc >= 0 ? row[idxCriteriaDesc] || '' : ''
    const ratings: Record<string, unknown> = {}
    let ratingCounter = 1

    for (let j = idxRatingStart; j < row.length; j += 3) {
      const rTitle = row[j]
      const rDesc = row[j + 1] || ''
      const rPointsRaw = row[j + 2]

      if (rTitle !== undefined && rTitle.trim() !== '' && rPointsRaw !== undefined) {
        ratings[String(ratingCounter)] = {
          description: rTitle.trim(),
          long_description: rDesc.trim(),
          points: parseFloat(rPointsRaw) || 0,
        }
        ratingCounter++
      }
    }

    const enableRange =
      idxEnableRange >= 0 && row[idxEnableRange]?.toLowerCase().trim() === 'true'

    criteria[criterionKey] = {
      description: criterionName,
      long_description: criterionDesc,
      ratings,
      ...(enableRange ? { criterion_use_range: true } : {}),
    }
  })

  return {
    ok: true,
    payload: {
      rubric: { title: rubricTitle, criteria },
      rubric_association: {
        association_id: courseId,
        association_type: 'Course',
        use_for_grading: false,
        purpose: 'bookmarking',
      },
    },
  }
}
