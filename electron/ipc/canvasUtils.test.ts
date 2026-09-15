import { describe, it, expect } from 'vitest'
import { parseCSV, parseCourseUrl, buildRubricPayload } from './canvasUtils'

describe('parseCSV', () => {
  it('splits a simple grid', () => {
    expect(parseCSV('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('keeps commas inside quoted fields', () => {
    // The case that makes a naive split(',') wrong on real rubric text.
    expect(parseCSV('name,desc\nClarity,"Clear, well-organised argument"')).toEqual([
      ['name', 'desc'],
      ['Clarity', 'Clear, well-organised argument'],
    ])
  })

  it('unescapes doubled quotes', () => {
    expect(parseCSV('a\n"She said ""hello"""')).toEqual([['a'], ['She said "hello"']])
  })

  it('keeps newlines inside quoted fields', () => {
    expect(parseCSV('a,b\n"line one\nline two",x')).toEqual([
      ['a', 'b'],
      ['line one\nline two', 'x'],
    ])
  })

  it('handles CRLF line endings', () => {
    // Files that have been through Excel on Windows arrive this way.
    expect(parseCSV('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('does not emit a trailing empty row for a trailing newline', () => {
    expect(parseCSV('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('trims surrounding whitespace on each field', () => {
    expect(parseCSV('a ,  b\n 1 , 2 ')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('parseCourseUrl', () => {
  it('extracts origin and course id', () => {
    expect(parseCourseUrl('https://boisestate.instructure.com/courses/12345')).toEqual({
      origin: 'https://boisestate.instructure.com',
      host: 'boisestate.instructure.com',
      courseId: '12345',
    })
  })

  it('accepts a deep link from inside the course', () => {
    const ref = parseCourseUrl('https://school.instructure.com/courses/999/assignments/42')
    expect(ref?.courseId).toBe('999')
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseCourseUrl('  https://s.instructure.com/courses/7  ')?.courseId).toBe('7')
  })

  it('preserves a non-default port in the origin', () => {
    const ref = parseCourseUrl('https://canvas.example.edu:8443/courses/5')
    expect(ref?.origin).toBe('https://canvas.example.edu:8443')
  })

  // Everything below returns null, which means the Canvas token is never attached to a request
  // aimed at it. These are the security-relevant cases.

  it('rejects plain HTTP, which would send the token in the clear', () => {
    expect(parseCourseUrl('http://school.instructure.com/courses/1')).toBeNull()
  })

  it('rejects a URL with no course id', () => {
    expect(parseCourseUrl('https://school.instructure.com/')).toBeNull()
  })

  it('rejects unparseable input', () => {
    expect(parseCourseUrl('not a url')).toBeNull()
    expect(parseCourseUrl('')).toBeNull()
  })

  it('rejects loopback hosts', () => {
    expect(parseCourseUrl('https://localhost/courses/1')).toBeNull()
    expect(parseCourseUrl('https://127.0.0.1/courses/1')).toBeNull()
  })

  it('rejects private and link-local ranges', () => {
    expect(parseCourseUrl('https://10.0.0.5/courses/1')).toBeNull()
    expect(parseCourseUrl('https://172.16.4.4/courses/1')).toBeNull()
    expect(parseCourseUrl('https://192.168.1.1/courses/1')).toBeNull()
    // Cloud instance-metadata endpoint.
    expect(parseCourseUrl('https://169.254.169.254/courses/1')).toBeNull()
  })

  it('allows a public IPv4 host outside the private ranges', () => {
    // 172.32 is outside 172.16.0.0/12, so the range check must not over-reach.
    expect(parseCourseUrl('https://172.32.0.1/courses/1')?.courseId).toBe('1')
  })
})

describe('buildRubricPayload', () => {
  const HEADER =
    'Rubric Name,Criteria Name,Criteria Description,Rating Name,Rating Description,Points'

  it('builds criteria and ratings from a single row', () => {
    const result = buildRubricPayload(`${HEADER}\nMy Rubric,Clarity,Is it clear?,Good,Very clear,10`, '555')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.payload.rubric.title).toBe('My Rubric')
    expect(result.payload.rubric_association.association_id).toBe('555')
    expect(result.payload.rubric.criteria['1']).toEqual({
      description: 'Clarity',
      long_description: 'Is it clear?',
      ratings: {
        '1': { description: 'Good', long_description: 'Very clear', points: 10 },
      },
    })
  })

  it('reads repeating rating triples across the row', () => {
    const header = `${HEADER},Rating Name,Rating Description,Points`
    const row = 'R,Clarity,,Excellent,Top marks,10,Poor,Needs work,2'
    const result = buildRubricPayload(`${header}\n${row}`, '1')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const ratings = (result.payload.rubric.criteria['1'] as { ratings: Record<string, unknown> })
      .ratings
    expect(Object.keys(ratings)).toEqual(['1', '2'])
    expect(ratings['2']).toEqual({ description: 'Poor', long_description: 'Needs work', points: 2 })
  })

  it('locates columns by header name, not position', () => {
    const shuffled = 'Points,Rating Name,Criteria Name,Rubric Name,Rating Description'
    const result = buildRubricPayload(`${shuffled}\n5,Good,Clarity,My Rubric,Nice`, '1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payload.rubric.title).toBe('My Rubric')
    expect((result.payload.rubric.criteria['1'] as { description: string }).description).toBe(
      'Clarity',
    )
  })

  it('sets criterion_use_range only when the column says true', () => {
    const header = `${HEADER},Enable Range`
    const on = buildRubricPayload(`${header}\nR,C,,Good,Nice,5,TRUE`, '1')
    const off = buildRubricPayload(`${header}\nR,C,,Good,Nice,5,false`, '1')
    expect(on.ok && 'criterion_use_range' in (on.payload.rubric.criteria['1'] as object)).toBe(true)
    expect(off.ok && 'criterion_use_range' in (off.payload.rubric.criteria['1'] as object)).toBe(
      false,
    )
  })

  it('treats non-numeric points as zero rather than NaN', () => {
    // NaN would serialise to null and Canvas would reject the whole rubric.
    const result = buildRubricPayload(`${HEADER}\nR,C,,Good,Nice,not-a-number`, '1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const ratings = (result.payload.rubric.criteria['1'] as { ratings: Record<string, { points: number }> })
      .ratings
    expect(ratings['1'].points).toBe(0)
  })

  it('skips rows with no criteria name', () => {
    const result = buildRubricPayload(`${HEADER}\nR,Clarity,,Good,Nice,5\nR,,,,,`, '1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.payload.rubric.criteria)).toEqual(['1'])
  })

  it('reports unrecognised headers rather than producing an empty rubric', () => {
    const result = buildRubricPayload('col1,col2\nfoo,bar', '1')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('CSV headers not recognized')
  })

  it('reports an empty CSV', () => {
    expect(buildRubricPayload('', '1').ok).toBe(false)
    expect(buildRubricPayload(HEADER, '1').ok).toBe(false)
  })

  it('carries quoted rubric text through intact', () => {
    const result = buildRubricPayload(
      `${HEADER}\n"Essay, Final","Clarity & ""voice""",,Good,Nice,5`,
      '1',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payload.rubric.title).toBe('Essay, Final')
    expect((result.payload.rubric.criteria['1'] as { description: string }).description).toBe(
      'Clarity & "voice"',
    )
  })
})
