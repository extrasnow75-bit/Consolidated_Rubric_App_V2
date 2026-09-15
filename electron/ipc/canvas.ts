/**
 * Canvas API calls, made from the main process.
 *
 * In the web app these ran in the browser, which meant every request had to be bounced through a
 * proxy — a Vite dev-server plugin in development, a Vercel serverless function in production —
 * because Canvas sends no CORS headers. That proxy layer is gone: a main-process `fetch` is not
 * subject to CORS at all, so the requests go straight to Canvas. The README used to instruct
 * users to install a CORS-bypassing browser extension; that instruction is gone too.
 *
 * The token never travels through the renderer. Handlers here take the CSV and the course URL,
 * and load the token from the keychain themselves at the moment they build the request.
 */
import { getCanvasToken } from './credentials'
import { buildRubricPayload, parseCourseUrl, type CourseRef } from './canvasUtils'

export interface CanvasResult {
  success: boolean
  message: string
}

const BAD_URL_MESSAGE =
  'That is not a recognised Canvas course URL. It should look like ' +
  'https://yourschool.instructure.com/courses/12345 — paste a link from inside your course.'

const NO_TOKEN_MESSAGE =
  'No Canvas token is saved. Add one in Initial Setup so rubrics can be sent to your course.'

/**
 * Build the headers for a Canvas request.
 *
 * This is the only place the token is attached to anything, and it is reached only via
 * `parseCourseUrl`, which has already established that the destination is an HTTPS host that is
 * not loopback, private or link-local. The endpoint path is assembled here from a numeric course
 * id — never from rubric text, a filename, or anything else that passed through Gemini or a
 * user-supplied document — so there is no route by which generated content can redirect where
 * this token is sent.
 */
function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

/** Canvas prefixes some JSON responses with `while(1);` as an anti-hijacking measure. */
function stripJsonGuard(text: string): string {
  return text.replace(/^while\(1\);/, '')
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  try {
    const body = JSON.parse(stripJsonGuard(text)) as {
      errors?: Array<{ message?: string }>
      message?: string
    }
    return body.errors?.[0]?.message ?? body.message ?? response.statusText
  } catch {
    return response.statusText
  }
}

/**
 * Check that the saved token works, and say who it belongs to.
 *
 * Worth doing before an upload rather than after: a 401 at the end of a long workflow reads as
 * "the app is broken", whereas the same failure in the setup panel reads as "my token expired",
 * which is both true and actionable.
 */
export async function verifyToken(args: {
  courseUrl: string
}): Promise<{ ok: boolean; name?: string; message?: string }> {
  const ref = parseCourseUrl(args.courseUrl)
  if (!ref) return { ok: false, message: BAD_URL_MESSAGE }

  const token = getCanvasToken()
  if (!token) return { ok: false, message: NO_TOKEN_MESSAGE }

  try {
    const response = await fetch(`${ref.origin}/api/v1/users/self/profile`, {
      headers: authHeaders(token),
    })
    if (response.status === 401) {
      return {
        ok: false,
        message:
          'Canvas rejected that token. It may have expired or been deleted — ' +
          'generate a new one in Canvas under Account → Settings → Approved Integrations.',
      }
    }
    if (!response.ok) {
      return { ok: false, message: `Canvas responded with ${response.status}.` }
    }
    const profile = JSON.parse(stripJsonGuard(await response.text())) as { name?: string }
    return { ok: true, name: profile.name }
  } catch (e) {
    return {
      ok: false,
      message: `Could not reach Canvas: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

/** Look up the course name, so the UI can confirm the user is pointed at the right course. */
export async function getCourseName(args: {
  courseUrl: string
}): Promise<{ ok: boolean; name?: string; message?: string }> {
  const ref = parseCourseUrl(args.courseUrl)
  if (!ref) return { ok: false, message: BAD_URL_MESSAGE }

  const token = getCanvasToken()
  if (!token) return { ok: false, message: NO_TOKEN_MESSAGE }

  try {
    const response = await fetch(`${ref.origin}/api/v1/courses/${ref.courseId}`, {
      headers: authHeaders(token),
    })
    if (!response.ok) return { ok: false, message: await readError(response) }
    const course = JSON.parse(stripJsonGuard(await response.text())) as { name?: string }
    return { ok: true, name: course.name }
  } catch (e) {
    return {
      ok: false,
      message: `Could not reach Canvas: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

/** Push one rubric CSV to a course's Rubrics list. */
export async function pushRubric(args: {
  csvContent: string
  courseUrl: string
}): Promise<CanvasResult> {
  const ref: CourseRef | null = parseCourseUrl(args.courseUrl)
  if (!ref) return { success: false, message: BAD_URL_MESSAGE }

  const token = getCanvasToken()
  if (!token) return { success: false, message: NO_TOKEN_MESSAGE }

  const built = buildRubricPayload(args.csvContent, ref.courseId)
  if (!built.ok) return { success: false, message: built.message }

  try {
    const response = await fetch(`${ref.origin}/api/v1/courses/${ref.courseId}/rubrics`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(built.payload),
    })

    if (response.status === 401) {
      return {
        success: false,
        message:
          'Canvas rejected your token. It may have expired — generate a new one under ' +
          'Account → Settings → Approved Integrations, then save it in Initial Setup.',
      }
    }
    if (response.status === 403) {
      return {
        success: false,
        message:
          'Canvas refused the upload. Your account may not have permission to add rubrics to ' +
          'this course — check that you are a teacher or designer there, not a student or observer.',
      }
    }
    if (!response.ok) {
      return {
        success: false,
        message: `Canvas error (${response.status}): ${await readError(response)}`,
      }
    }

    return {
      success: true,
      message:
        "Success. The rubric has been uploaded and can now be found in your Canvas 'Rubrics' list.",
    }
  } catch (e) {
    // No CORS case to explain any more: this request is made from the main process, so a failure
    // here is a real network problem rather than the browser refusing to make the call.
    return {
      success: false,
      message: `Could not reach Canvas: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}
