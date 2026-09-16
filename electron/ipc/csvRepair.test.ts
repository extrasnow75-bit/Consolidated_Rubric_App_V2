import { describe, it, expect } from 'vitest'
import { checkRepair, computeRepairDiff, criterionNames } from './csvRepair'

/**
 * These gates are the only thing standing between a confident wrong answer from a language model
 * and a rubric that grades students. The model itself is not tested here — it cannot be, its
 * output is not deterministic — so the tests cover what is: given a proposal, is it let through,
 * and is the change list the user approves an accurate account of the change they are approving?
 *
 * The CSVs below are the real template shape, and the breakages are the ones that actually reach
 * Canvas: range strings in a points column, a missing header row, a blank point value.
 */

const HEADER =
  'Rubric Name,Criteria Name,Criteria Description,Criteria Enable Range,' +
  'Rating Name,Rating Description,Rating Points,Rating Name,Rating Description,Rating Points'

const GOOD = [
  HEADER,
  'Essay Rubric,Thesis,States a clear argument,TRUE,Exemplary,Clear and arguable,10,Developing,Vague,5',
  ',Evidence,Supports the argument,TRUE,Exemplary,Well sourced,10,Developing,Thin,5',
].join('\n')

/** Canvas rejects this: "10-8" is a range string where a single maximum belongs. */
const RANGE_STRINGS = [
  HEADER,
  'Essay Rubric,Thesis,States a clear argument,TRUE,Exemplary,Clear and arguable,10-8,Developing,Vague,5-0',
  ',Evidence,Supports the argument,TRUE,Exemplary,Well sourced,10,Developing,Thin,5',
].join('\n')

const RANGE_STRINGS_FIXED = [
  HEADER,
  'Essay Rubric,Thesis,States a clear argument,TRUE,Exemplary,Clear and arguable,10,Developing,Vague,5',
  ',Evidence,Supports the argument,TRUE,Exemplary,Well sourced,10,Developing,Thin,5',
].join('\n')

describe('checkRepair', () => {
  it('accepts a repair that fixes range strings, and says which cells moved', () => {
    const result = checkRepair(RANGE_STRINGS, RANGE_STRINGS_FIXED)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Both changed cells are point values, and both are reported as such — this is what the UI
    // leads with, because it is the part no validation can vouch for.
    expect(result.diff.pointChanges).toEqual([
      { criterion: 'Thesis', column: 'Rating 1 Points', before: '10-8', after: '10' },
      { criterion: 'Thesis', column: 'Rating 2 Points', before: '5-0', after: '5' },
    ])
    expect(result.diff.criteria).toHaveLength(1)
    expect(result.diff.criteria[0]).toMatchObject({ criterion: 'Thesis', kind: 'changed' })
  })

  it('rejects a repair that still would not load, rather than offering it', () => {
    const result = checkRepair(RANGE_STRINGS, 'Rubric Name,Criteria Name\nEssay Rubric,Thesis')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/would not load/i)
  })

  it('rejects a repair that drops a criterion, and names the one it dropped', () => {
    const dropped = [
      HEADER,
      'Essay Rubric,Thesis,States a clear argument,TRUE,Exemplary,Clear and arguable,10,Developing,Vague,5',
    ].join('\n')

    const result = checkRepair(GOOD, dropped)
    expect(result.ok).toBe(false)
    if (result.ok) return
    // A silently shorter rubric deploys cleanly and grades wrongly, so this is the gate that
    // matters most. Naming the criterion is what lets the user tell it was not a stray blank row.
    expect(result.reason).toMatch(/Evidence/)
  })

  it('rejects a repair that changes nothing, because it would fail identically', () => {
    const result = checkRepair(GOOD, GOOD)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/same/i)
  })

  it('rejects an empty response', () => {
    const result = checkRepair(GOOD, '   \n  ')
    expect(result.ok).toBe(false)
  })

  it('rejects a rename, which is indistinguishable from a drop plus an add', () => {
    const renamed = GOOD.replace('Evidence,Supports', 'Support,Supports')
    const result = checkRepair(GOOD, renamed)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/Evidence/)
  })

  it('accepts a repair that adds the missing header row', () => {
    const headerless = [
      'Essay Rubric,Thesis,States a clear argument,TRUE,Exemplary,Clear and arguable,10,Developing,Vague,5',
    ].join('\n')
    const repaired = [HEADER, headerless].join('\n')

    const result = checkRepair(headerless, repaired)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.diff.headerAdded).toBe(true)
    // Reported as one change, not as ten columns that each "changed" from blank.
    expect(result.diff.headerChanges).toHaveLength(0)
    expect(result.diff.criteria).toHaveLength(0)
  })

  it('accepts a filled-in blank point value and flags it as a point change', () => {
    const blank = GOOD.replace(
      'Exemplary,Clear and arguable,10,',
      'Exemplary,Clear and arguable,,',
    )
    const result = checkRepair(blank, GOOD)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The model cannot know what the criterion was worth — it guesses. Surfacing this as a point
    // change is the entire defence, so it is not allowed to be quiet about it.
    expect(result.diff.pointChanges).toEqual([
      { criterion: 'Thesis', column: 'Rating 1 Points', before: '', after: '10' },
    ])
  })
})

describe('computeRepairDiff', () => {
  it('labels rating columns by group so the user can tell which rating changed', () => {
    const changed = GOOD.replace('Developing,Vague,5', 'Developing,Vague,4')
    const diff = computeRepairDiff(GOOD, changed)
    expect(diff.pointChanges[0].column).toBe('Rating 2 Points')
  })

  it('reports a non-point edit without marking it as a point change', () => {
    const changed = GOOD.replace('States a clear argument', 'States a clear and arguable thesis')
    const diff = computeRepairDiff(GOOD, changed)
    expect(diff.pointChanges).toHaveLength(0)
    expect(diff.criteria[0].changes[0]).toMatchObject({
      column: 'Criteria Description',
      isPointValue: false,
    })
  })

  it('reports an added criterion as added rather than as a row of changed cells', () => {
    const extra = GOOD + '\n,Style,Reads well,TRUE,Exemplary,Polished,10,Developing,Rough,5'
    const diff = computeRepairDiff(GOOD, extra)
    expect(diff.criteria).toEqual([{ criterion: 'Style', kind: 'added', changes: [] }])
  })

  it('matches rows by name, so reordering criteria is not reported as a rewrite', () => {
    const lines = GOOD.split('\n')
    // Swap the two criteria, moving the rubric title onto the row that is now first.
    const reordered = [
      lines[0],
      lines[2].replace(/^,/, 'Essay Rubric,'),
      lines[1].replace(/^Essay Rubric,/, ','),
    ].join('\n')

    const diff = computeRepairDiff(GOOD, reordered)
    // Only the Rubric Name cells move; the criteria themselves are untouched.
    expect(diff.pointChanges).toHaveLength(0)
    for (const criterion of diff.criteria) {
      for (const change of criterion.changes) {
        expect(change.column).toBe('Rubric Name')
      }
    }
  })
})

describe('criterionNames', () => {
  it('reads names from a file that parses', () => {
    expect(criterionNames(GOOD)).toEqual(['Thesis', 'Evidence'])
  })

  it('still reads names from a file with no header row', () => {
    const headerless =
      'Essay Rubric,Thesis,States a clear argument,TRUE,Exemplary,Clear,10\n' +
      ',Evidence,Supports it,TRUE,Exemplary,Sourced,10'
    expect(criterionNames(headerless)).toEqual(['Thesis', 'Evidence'])
  })
})
