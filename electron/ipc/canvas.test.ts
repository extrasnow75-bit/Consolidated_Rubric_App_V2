import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Host pinning: the Canvas token must only ever be sent to the saved Canvas site.
 *
 * These tests exist because the first version of this code did NOT pin. It validated the URL the
 * renderer supplied — HTTPS, not loopback, not a private range, path matching /courses/\d+ — and
 * then used it. `https://attacker.example/courses/1` satisfies every one of those, so one IPC call
 * was enough to send an instructor's Canvas token, and every student record it can read, anywhere
 * on the internet.
 *
 * It was reported as verified, because the test at the time exercised the URL *validator* rather
 * than the code that attaches the token. So these tests assert on `fetch` itself: what was
 * requested, and what header went with it. A pinning check that stops being called cannot pass
 * them.
 */

const TOKEN = 'cnvs~TESTTOKEN0123456789'
const SAVED = 'https://school.instructure.com/courses/555'

let savedCourseUrl: string | undefined = SAVED

vi.mock('./settings', () => ({
  readSettings: () => ({ canvasCourseUrl: savedCourseUrl }),
  updateSettings: () => undefined,
}))

vi.mock('./credentials', () => ({
  getCanvasToken: () => TOKEN,
}))

const { pushRubric, verifyToken, getCourseName } = await import('./canvas')

const CSV =
  'Rubric Name,Criteria Name,Rating Name,Rating Description,Points\nR,Clarity,Good,Nice,5'

/** Every fetch this test file makes, as [url, init] pairs. */
let calls: Array<[string, RequestInit | undefined]>

beforeEach(() => {
  savedCourseUrl = SAVED
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([String(url), init])
      return new Response(JSON.stringify({ name: 'Some Course' }), { status: 200 })
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

/** True if the token went anywhere at all during this test. */
const tokenWasSent = () =>
  calls.some(([, init]) => JSON.stringify(init?.headers ?? {}).includes(TOKEN))

const hostsContacted = () => calls.map(([url]) => new URL(url).host)

describe('host pinning — pushRubric', () => {
  it('sends the token to the saved host when no course URL is supplied', async () => {
    const result = await pushRubric({ csvContent: CSV })
    expect(result.success).toBe(true)
    expect(hostsContacted()).toEqual(['school.instructure.com'])
    expect(tokenWasSent()).toBe(true)
  })

  it('accepts a different course on the SAME host, and uses that course id', async () => {
    const result = await pushRubric({
      csvContent: CSV,
      courseUrl: 'https://school.instructure.com/courses/999',
    })
    expect(result.success).toBe(true)
    expect(calls[0][0]).toContain('/courses/999/rubrics')
  })

  // The vulnerability, stated directly.
  it('REFUSES a different host, and makes no request at all', async () => {
    const result = await pushRubric({
      csvContent: CSV,
      courseUrl: 'https://attacker.example/courses/1',
    })
    expect(result.success).toBe(false)
    expect(calls).toHaveLength(0)
    expect(tokenWasSent()).toBe(false)
  })

  it('refuses a lookalike host that merely contains the saved one', async () => {
    const result = await pushRubric({
      csvContent: CSV,
      courseUrl: 'https://school.instructure.com.attacker.example/courses/1',
    })
    expect(result.success).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('refuses a subdomain of the saved host', async () => {
    const result = await pushRubric({
      csvContent: CSV,
      courseUrl: 'https://evil.school.instructure.com/courses/1',
    })
    expect(result.success).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('refuses plain HTTP on the saved host, which would put the token on the wire', async () => {
    const result = await pushRubric({
      csvContent: CSV,
      courseUrl: 'http://school.instructure.com/courses/1',
    })
    expect(result.success).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('makes no request when no course has been saved yet', async () => {
    savedCourseUrl = undefined
    const result = await pushRubric({ csvContent: CSV })
    expect(result.success).toBe(false)
    expect(calls).toHaveLength(0)
    expect(tokenWasSent()).toBe(false)
  })
})

describe('host pinning — verifyToken and getCourseName', () => {
  it('verifyToken refuses a foreign host', async () => {
    const result = await verifyToken({ courseUrl: 'https://attacker.example/courses/1' })
    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('getCourseName refuses a foreign host', async () => {
    const result = await getCourseName({ courseUrl: 'https://attacker.example/courses/1' })
    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('both use the saved host when called with no argument', async () => {
    await verifyToken()
    await getCourseName()
    expect(hostsContacted()).toEqual(['school.instructure.com', 'school.instructure.com'])
  })
})
