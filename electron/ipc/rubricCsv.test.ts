import { describe, expect, it } from 'vitest'
import { buildRubricCsv, ExtractedRubric } from './rubricCsv'
import { buildRubricPayload } from './canvasUtils'

/**
 * Canvas's rubric payload is an indexed object, not an array: criteria are keyed "1", "2", … and
 * so are each criterion's ratings. A rating's `description` is its name and `long_description` is
 * its text. These helpers keep that shape in one place rather than in every assertion.
 */
interface PayloadRating { description: string; long_description: string; points: number }
interface PayloadCriterion { description: string; long_description: string; ratings: Record<string, PayloadRating> }

const criterion = (payload: unknown, key: string): PayloadCriterion =>
  (payload as { rubric: { criteria: Record<string, PayloadCriterion> } }).rubric.criteria[key]

const ratings = (c: PayloadCriterion): PayloadRating[] => Object.values(c.ratings)

/**
 * The rubric that broke the first real deployment.
 *
 * Text taken verbatim from eCampus Demo Rubrics.docx. Asked to emit finished CSV, the model
 * wrote these descriptions unquoted, so "errors in grammar, spelling, and punctuation" became
 * three columns and the word `spelling` arrived in Rating Points. Five of ten rubrics in that
 * document failed this way; the five that survived had no commas in their descriptions.
 */
const BIRD_COUNT: ExtractedRubric = {
  title: 'Bird Count Rubric',
  criteria: [
    {
      name: 'Quality of Writing',
      description: 'Grammar, spelling and professionalism',
      ratings: [
        { name: 'Great Work', description: 'Your writing is concise and free of errors.', points: '4' },
        {
          name: 'Good Work',
          description:
            'Your writing includes some unnecessary words and has minor errors in grammar, spelling, and punctuation.',
          points: '3',
        },
        {
          name: 'Developing Work',
          description: 'Your writing has errors in grammar, spelling, and punctuation.',
          points: '2',
        },
        {
          name: 'Unsatisfactory Work',
          description:
            'Your writing includes many unnecessary words and has errors in grammar, spelling, and punctuation, that can negatively affect your credibility and professionalism.',
          points: '1',
        },
      ],
    },
  ],
}

describe('buildRubricCsv', () => {
  it('quotes descriptions containing commas', () => {
    const csv = buildRubricCsv(BIRD_COUNT, 'fixed')
    expect(csv).toContain(
      '"Your writing includes many unnecessary words and has errors in grammar, spelling, and punctuation, that can negatively affect your credibility and professionalism."',
    )
  })

  /**
   * The regression that matters. Not "is there a quote character somewhere" but "does the value
   * Canvas would be sent still line up with the rating it belongs to". Every failure in the
   * v0.9.2 deployment was a column shift, and only a round trip through the real payload builder
   * proves there is none.
   */
  it('round-trips through buildRubricPayload with points intact', () => {
    const csv = buildRubricCsv(BIRD_COUNT, 'fixed')
    const result = buildRubricPayload(csv, '82')

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const c = criterion(result.payload, '1')
    expect(c.description).toBe('Quality of Writing')
    expect(ratings(c).map((r) => r.points)).toEqual([4, 3, 2, 1])
    expect(ratings(c).map((r) => r.description)).toEqual([
      'Great Work',
      'Good Work',
      'Developing Work',
      'Unsatisfactory Work',
    ])
  })

  it('escapes embedded double quotes by doubling them', () => {
    const csv = buildRubricCsv(
      {
        title: 'Quoting',
        criteria: [
          {
            name: 'Voice',
            description: 'Uses the word "we" appropriately',
            ratings: [{ name: 'Good', description: 'Says "we" throughout', points: '5' }],
          },
        ],
      },
      'fixed',
    )
    expect(csv).toContain('"Uses the word ""we"" appropriately"')
    expect(buildRubricPayload(csv, '1').ok).toBe(true)
  })

  it('writes the rubric name on the first data row only', () => {
    const csv = buildRubricCsv(
      {
        title: 'Two Criteria',
        criteria: [
          { name: 'A', description: 'first', ratings: [{ name: 'Good', description: 'x', points: '2' }] },
          { name: 'B', description: 'second', ratings: [{ name: 'Good', description: 'y', points: '1' }] },
        ],
      },
      'fixed',
    )
    const [, row1, row2] = csv.split('\n')
    expect(row1.startsWith('Two Criteria,')).toBe(true)
    expect(row2.startsWith(',')).toBe(true)
  })

  it('normalises a range to its highest value so a downloaded CSV imports by hand', () => {
    const csv = buildRubricCsv(
      {
        title: 'Ranges',
        criteria: [
          {
            name: 'Thesis',
            description: 'clarity',
            ratings: [
              { name: 'Exemplary', description: 'top band', points: '4 to >3 pts' },
              { name: 'Proficient', description: 'next band', points: '3-2.5 points' },
            ],
          },
        ],
      },
      'ranges',
    )
    expect(csv).toContain('Exemplary,top band,4')
    expect(csv).toContain('Proficient,next band,3')
  })

  /**
   * A point value the grammar refuses is written through untouched rather than replaced with a
   * guess, so buildRubricPayload still refuses the file and names the rating. Inventing a number
   * here would turn a visible failure into a wrong grade.
   */
  it('passes an unreadable point value through so the deploy path still refuses it', () => {
    const csv = buildRubricCsv(
      {
        title: 'Unreadable',
        criteria: [
          {
            name: 'Effort',
            description: 'how hard',
            ratings: [{ name: 'Good', description: 'fine', points: '>90' }],
          },
        ],
      },
      'fixed',
    )
    expect(csv).toContain('Good,fine,>90')

    const result = buildRubricPayload(csv, '1')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('Rating Points column')
  })

  it('forces Criteria Enable Range from the caller rather than the model', () => {
    const rubric: ExtractedRubric = {
      title: 'Forced',
      criteria: [
        {
          name: 'A',
          description: 'x',
          enableRange: false, // the model said false; discovery says the rubric uses ranges
          ratings: [{ name: 'Good', description: 'y', points: '5' }],
        },
      ],
    }
    expect(buildRubricCsv(rubric, 'ranges').split('\n')[1]).toContain(',TRUE,')
    expect(buildRubricCsv(rubric, 'fixed').split('\n')[1]).toContain(',FALSE,')
  })

  it('pads criteria with fewer ratings so every row matches the header width', () => {
    const csv = buildRubricCsv(
      {
        title: 'Ragged',
        criteria: [
          {
            name: 'Four levels',
            description: 'x',
            ratings: [
              { name: 'A', description: 'a', points: '4' },
              { name: 'B', description: 'b', points: '3' },
              { name: 'C', description: 'c', points: '2' },
              { name: 'D', description: 'd', points: '1' },
            ],
          },
          {
            name: 'Two levels',
            description: 'y',
            ratings: [
              { name: 'Pass', description: 'ok', points: '1' },
              { name: 'Fail', description: 'no', points: '0' },
            ],
          },
        ],
      },
      'fixed',
    )
    const rows = csv.split('\n')
    const widths = rows.map((r) => r.split(',').length)
    expect(new Set(widths).size).toBe(1)

    const result = buildRubricPayload(csv, '1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(ratings(criterion(result.payload, '2'))).toHaveLength(2)
    expect(ratings(criterion(result.payload, '1'))).toHaveLength(4)
  })
})
