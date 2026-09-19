/**
 * Build Canvas rubric CSV from structured data, deterministically.
 *
 * This exists because of a whole class of failure found the first time real rubrics were
 * deployed. The model was asked to return finished CSV text and to "wrap any field containing a
 * comma in double quotes". It did not. Rating descriptions in real rubrics are full of commas —
 * "errors in grammar, spelling, and punctuation" — and each unquoted comma opened a new column
 * and shifted every field after it one place right. The word `spelling` arrived in the Rating
 * Points column. Half the rubrics in a ten-rubric document failed that way, and the half that
 * survived did so only because their descriptions happened to have no commas.
 *
 * The lesson is not "write a better prompt". A language model is good at finding a rubric in a
 * document and bad at hand-escaping a serialization format, and it fails at the second job
 * silently — the output still looks like a CSV. So the model is now asked only for structured
 * data, which is the part it is good at, and the escaping happens here, in code that can be
 * tested. The renderer has done it this way for Phase 1 rubrics all along (src/utils/rubricCsv.ts)
 * and has never produced a misaligned row.
 */
import { parseRatingPoints } from './canvasUtils'

/** One rating level, as the model reports it. */
export interface ExtractedRating {
  name: string
  description: string
  /**
   * Left as a string rather than a number on purpose.
   *
   * A numeric field would force the model to return *some* number for a cell it could not read,
   * and an invented point value is the exact failure this codebase has already had to fix twice:
   * it deploys cleanly and grades students wrongly. As a string, an unreadable value survives to
   * `buildRubricPayload`, which refuses the file and names the rating. A visible refusal beats a
   * quietly wrong grade.
   */
  points: string
}

export interface ExtractedCriterion {
  name: string
  description: string
  enableRange?: boolean
  ratings: ExtractedRating[]
}

export interface ExtractedRubric {
  title: string
  criteria: ExtractedCriterion[]
}

/** Wrap a field in double quotes if it contains a comma, a quote or a newline. */
function q(value: string | undefined | null): string {
  const s = String(value ?? '')
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s
}

/**
 * Normalise a point value for the CSV.
 *
 * Runs the closed grammar the deploy path uses, so "4 to >3 pts" is written as "4" and the file
 * is valid if someone downloads it and imports it into Canvas by hand. Anything the grammar
 * refuses is written through untouched rather than guessed at — see the note on
 * `ExtractedRating.points`.
 */
function normalisePoints(raw: string): string {
  const parsed = parseRatingPoints(raw)
  return parsed === null ? String(raw ?? '').trim() : String(parsed)
}

/**
 * Serialize one rubric to Canvas CSV.
 *
 * @param rubric        Structured rubric as returned by the model.
 * @param scoringMethod When given, forces every "Criteria Enable Range" cell. The model is
 *                      unreliable about this column and the caller already knows the answer from
 *                      discovery, so the caller's value wins. Without it, each criterion's own
 *                      `enableRange` is used.
 */
export function buildRubricCsv(
  rubric: ExtractedRubric,
  scoringMethod?: 'ranges' | 'fixed',
): string {
  const criteria = rubric.criteria ?? []

  // The header repeats one rating triple per rating level. Width comes from the widest criterion
  // so a rubric with five levels is not truncated to four, and shorter rows are padded — which
  // buildRubricPayload already tolerates, since it stops a row's ratings at the first empty name.
  const width = criteria.reduce((max, c) => Math.max(max, c.ratings?.length ?? 0), 0)
  const header = [
    'Rubric Name',
    'Criteria Name',
    'Criteria Description',
    'Criteria Enable Range',
    ...Array.from({ length: width }, () => ['Rating Name', 'Rating Description', 'Rating Points']).flat(),
  ].join(',')

  const rows = criteria.map((c, i) => {
    const enableRange =
      scoringMethod !== undefined
        ? scoringMethod === 'ranges'
        : c.enableRange === true

    const ratings = (c.ratings ?? []).flatMap((r) => [
      q(r.name),
      q(r.description),
      q(normalisePoints(r.points)),
    ])
    // Pad to the header width so every row has the same number of columns.
    const padding = Array.from({ length: (width - (c.ratings?.length ?? 0)) * 3 }, () => '')

    return [
      // Canvas reads the rubric name from the first data row only.
      i === 0 ? q(rubric.title) : '',
      q(c.name),
      q(c.description),
      enableRange ? 'TRUE' : 'FALSE',
      ...ratings,
      ...padding,
    ].join(',')
  })

  return [header, ...rows].join('\n')
}
