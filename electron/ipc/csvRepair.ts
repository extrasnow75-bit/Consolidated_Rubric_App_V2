/**
 * Checking an AI-proposed CSV repair before a human is ever shown it.
 *
 * The premise of the repair feature is that the model proposes and a deterministic check disposes.
 * A language model asked to fix a rubric CSV will always return something that looks like a fixed
 * rubric CSV, whether or not it is one, and the failure that matters here is not an obvious mess —
 * it is a file that deploys cleanly and quietly grades students differently from the one the
 * author wrote.
 *
 * So nothing in here asks the model what it changed. Everything is computed:
 *
 *   1. The parse gate runs the proposal through `buildRubricPayload` — the same function
 *      `pushRubric` uses — so "this will load into Canvas" is demonstrated rather than assumed.
 *   2. The no-loss gate refuses a repair that drops a criterion. A repair that silently removes a
 *      criterion is worse than the original failure: the original failure is visible.
 *   3. The diff is derived by comparing the two files cell by cell, never from the model's own
 *      account of its work, which is a claim and can under-report.
 *
 * These run in the main process on purpose. A proposal that fails a gate never crosses IPC, so
 * there is no path by which the renderer can display — or deploy — a repair that was not checked.
 */
import { parseCSV, buildRubricPayload } from './canvasUtils'

/**
 * Course id used only to exercise the payload builder.
 *
 * `buildRubricPayload` needs one for the association block, but nothing here sends a request, so
 * the value is irrelevant — it exists to prove the CSV half parses.
 */
const REPAIR_PROBE_COURSE_ID = '0'

/** One cell that differs between the original CSV and the proposed repair. */
export interface CsvCellChange {
  /** Which column, named the way the header names it, e.g. "Rating 2 Points". */
  column: string
  before: string
  after: string
  /**
   * Whether this cell holds a point value.
   *
   * The distinction the user needs: a structural fix costs nothing if it is wrong, because Canvas
   * either accepts the file or does not. A changed number changes what a student is graded on and
   * no amount of validation can tell whether it is the number the author meant.
   */
  isPointValue: boolean
}

/** The changes to one criterion, or its arrival or disappearance. */
export interface CsvCriterionDiff {
  criterion: string
  kind: 'changed' | 'added' | 'removed'
  changes: CsvCellChange[]
}

/** A point-value change, lifted out of the per-criterion list so the UI can lead with it. */
export interface CsvPointChange {
  criterion: string
  column: string
  before: string
  after: string
}

export interface CsvRepairDiff {
  /** True when the original had no header row and the repair supplies one. */
  headerAdded: boolean
  /** Per-cell header differences. Empty when `headerAdded`, which would otherwise list every column. */
  headerChanges: CsvCellChange[]
  criteria: CsvCriterionDiff[]
  pointChanges: CsvPointChange[]
  /** Total changed cells, for a one-line summary and for the "nothing changed" check. */
  changedCells: number
}

export type RepairCheck =
  | { ok: true; diff: CsvRepairDiff }
  | { ok: false; reason: string }

const norm = (value: string | undefined): string => (value ?? '').trim()
const key = (value: string): string => value.trim().toLowerCase()

/** The canonical first four columns, used to label a file that arrived with no header row. */
const CANONICAL_LEADING = [
  'Rubric Name',
  'Criteria Name',
  'Criteria Description',
  'Criteria Enable Range',
]
const RATING_PARTS = ['Name', 'Description', 'Points']

interface CsvView {
  /** The header row, or null when the file begins with data. */
  header: string[] | null
  rows: string[][]
  /** A display name per column index. */
  labels: string[]
  /** Which column holds the criterion name. */
  nameIdx: number
}

/**
 * Whether a row is the header rather than the first criterion.
 *
 * A missing header row is one of the breakages this feature exists to fix, so the first row cannot
 * simply be assumed to be one.
 */
function looksLikeHeader(row: string[]): boolean {
  const joined = row.join(' ').toLowerCase()
  return (
    joined.includes('criteria name') ||
    joined.includes('rubric name') ||
    joined.includes('rating')
  )
}

/**
 * Name every column.
 *
 * Rating columns repeat in unnamed groups of three, so "Rating Points" on its own would not tell
 * anyone which rating changed. They are numbered from the first rating column, counting in threes
 * exactly as `buildRubricPayload` reads them — so a label here describes the cell the deploy path
 * would actually use.
 */
function labelColumns(header: string[] | null, width: number): string[] {
  const ratingStart = header
    ? (() => {
        const i = header.findIndex((h) => key(h).includes('rating'))
        return i >= 0 ? i : CANONICAL_LEADING.length
      })()
    : CANONICAL_LEADING.length

  const labels: string[] = []
  for (let i = 0; i < width; i++) {
    if (i >= ratingStart) {
      const group = Math.floor((i - ratingStart) / 3) + 1
      const part = RATING_PARTS[(i - ratingStart) % 3]
      labels.push(`Rating ${group} ${part}`)
      continue
    }
    const fromHeader = norm(header?.[i])
    labels.push(fromHeader || CANONICAL_LEADING[i] || `Column ${i + 1}`)
  }
  return labels
}

function viewOf(csvText: string): CsvView {
  const grid = parseCSV(csvText).filter((row) => row.some((cell) => norm(cell) !== ''))
  const header = grid.length > 0 && looksLikeHeader(grid[0]) ? grid[0] : null
  const rows = header ? grid.slice(1) : grid
  const width = grid.reduce((max, row) => Math.max(max, row.length), 0)

  const headerNameIdx = header ? header.findIndex((h) => key(h).includes('criteria name')) : -1
  // Column B in the Canvas template. Used when there is no header to read it from.
  const nameIdx = headerNameIdx >= 0 ? headerNameIdx : 1

  return { header, rows, labels: labelColumns(header, width), nameIdx }
}

/**
 * The criterion names a CSV would deploy as.
 *
 * Read from the built payload when the file parses, because that is the list Canvas would receive.
 * A file that does not parse has no payload, so the raw rows are the best available answer — and
 * the original in a repair is often exactly that kind of file.
 */
export function criterionNames(csvText: string): string[] {
  const built = buildRubricPayload(csvText, REPAIR_PROBE_COURSE_ID)
  if (built.ok) {
    return Object.values(built.payload.rubric.criteria).map((criterion) =>
      norm((criterion as { description?: string }).description),
    )
  }
  const view = viewOf(csvText)
  return view.rows.map((row) => norm(row[view.nameIdx])).filter((name) => name !== '')
}

/**
 * Compare two CSVs cell by cell, grouped by criterion.
 *
 * Rows are matched on criterion name rather than position, so a repair that reorders criteria does
 * not read as every row having changed.
 *
 * One known coarseness: if the repair inserts a missing column, every cell to its right shifts and
 * is reported as changed. That over-reports rather than under-reports, which is the right direction
 * for something a human is about to approve.
 */
export function computeRepairDiff(originalCsv: string, repairedCsv: string): CsvRepairDiff {
  const before = viewOf(originalCsv)
  const after = viewOf(repairedCsv)
  const labels = after.labels.length >= before.labels.length ? after.labels : before.labels
  const labelAt = (i: number): string => labels[i] ?? `Column ${i + 1}`

  const headerAdded = before.header === null && after.header !== null
  const headerChanges: CsvCellChange[] = []
  if (!headerAdded) {
    const beforeHeader = before.header ?? []
    const afterHeader = after.header ?? []
    const width = Math.max(beforeHeader.length, afterHeader.length)
    for (let i = 0; i < width; i++) {
      const b = norm(beforeHeader[i])
      const a = norm(afterHeader[i])
      if (b !== a) {
        headerChanges.push({ column: labelAt(i), before: b, after: a, isPointValue: false })
      }
    }
  }

  const beforeByName = new Map<string, string[]>()
  for (const row of before.rows) {
    const k = key(norm(row[before.nameIdx]))
    if (k && !beforeByName.has(k)) beforeByName.set(k, row)
  }

  const criteria: CsvCriterionDiff[] = []
  const pointChanges: CsvPointChange[] = []
  const matched = new Set<string>()
  let changedCells = headerChanges.length + (headerAdded ? 1 : 0)

  for (const row of after.rows) {
    const name = norm(row[after.nameIdx])
    const k = key(name)
    const prior = k ? beforeByName.get(k) : undefined

    if (!prior) {
      criteria.push({ criterion: name || '(unnamed criterion)', kind: 'added', changes: [] })
      changedCells += 1
      continue
    }
    matched.add(k)

    const changes: CsvCellChange[] = []
    const width = Math.max(prior.length, row.length)
    for (let i = 0; i < width; i++) {
      const b = norm(prior[i])
      const a = norm(row[i])
      if (b === a) continue
      const column = labelAt(i)
      const isPointValue = /points$/i.test(column)
      changes.push({ column, before: b, after: a, isPointValue })
      if (isPointValue) pointChanges.push({ criterion: name, column, before: b, after: a })
    }

    if (changes.length > 0) {
      criteria.push({ criterion: name, kind: 'changed', changes })
      changedCells += changes.length
    }
  }

  for (const [k, row] of beforeByName) {
    if (matched.has(k)) continue
    criteria.push({ criterion: norm(row[before.nameIdx]), kind: 'removed', changes: [] })
    changedCells += 1
  }

  return { headerAdded, headerChanges, criteria, pointChanges, changedCells }
}

/**
 * Decide whether a proposed repair may be shown to the user at all.
 *
 * Returning `ok: false` means the app says the repair did not work, which is a worse outcome for
 * the user than a good suggestion and a much better one than a bad suggestion they approve.
 *
 * Note what the no-loss gate costs: a repair that renames a criterion is rejected, because from
 * the outside a rename and a deletion-plus-addition are indistinguishable. Canvas does not reject
 * rubrics over criterion names, so a rename is not a fix worth taking that risk for.
 */
export function checkRepair(originalCsv: string, repairedCsv: string): RepairCheck {
  if (!repairedCsv.trim()) {
    return { ok: false, reason: 'The AI returned an empty file.' }
  }

  // Gate 1 — the parse gate. This is the whole reason the feature can be trusted at all: the
  // proposal is run through the same builder the deploy path uses, so acceptance is evidence.
  const built = buildRubricPayload(repairedCsv, REPAIR_PROBE_COURSE_ID)
  if (!built.ok) {
    return { ok: false, reason: `The suggested fix still would not load: ${built.message}` }
  }

  // Gate 2 — no loss. A dropped criterion deploys successfully and is wrong, which is the one
  // failure mode this feature could introduce that the original bug did not have.
  const beforeNames = criterionNames(originalCsv)
  const afterNames = criterionNames(repairedCsv)
  const afterKeys = new Set(afterNames.map(key))
  const dropped = beforeNames.filter((name) => !afterKeys.has(key(name)))
  if (dropped.length > 0) {
    return {
      ok: false,
      reason:
        `The suggested fix leaves out ${dropped.length === 1 ? 'a criterion' : `${dropped.length} criteria`}` +
        ` (${dropped.join(', ')}), so it was discarded.`,
    }
  }
  if (afterNames.length < beforeNames.length) {
    return {
      ok: false,
      reason:
        `The suggested fix has ${afterNames.length} criteria where the original had ` +
        `${beforeNames.length}, so it was discarded.`,
    }
  }

  // Gate 3 — the diff, computed rather than reported.
  const diff = computeRepairDiff(originalCsv, repairedCsv)
  if (diff.changedCells === 0) {
    return {
      ok: false,
      reason:
        'The AI’s version contains exactly the same rubric data, so deploying it would fail the ' +
        'same way.',
    }
  }

  return { ok: true, diff }
}
