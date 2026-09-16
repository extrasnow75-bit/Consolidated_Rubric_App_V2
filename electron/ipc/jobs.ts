/**
 * Cancellable work, addressed by an id the renderer chooses.
 *
 * An `AbortSignal` cannot cross the IPC boundary — it is not structured-cloneable, and the whole
 * point of one is the live link between the caller and the work. So the renderer generates a job
 * id, passes it with the call, and cancels by sending that id back. Main keeps the real
 * AbortController on this side.
 *
 * The upside of doing it this way rather than rewriting the cancellation checks: the functions in
 * gemini.ts keep their `signal?: AbortSignal` parameter and their existing abort handling — the
 * throttle queue, the retry back-off, the per-attempt checks — all of which is careful code that
 * had no reason to change just because it moved processes.
 */

const controllers = new Map<string, AbortController>()

/**
 * Run `fn` under a signal the renderer can cancel by `jobId`.
 *
 * Calling with no id runs uncancellable, which is right for the short calls where a cancel
 * button would never be reachable anyway.
 */
export async function withJob<T>(
  jobId: string | undefined,
  fn: (signal?: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!jobId) return fn(undefined)

  // A repeated id means the previous run never ended — abort it rather than losing the handle,
  // which would leave it running with nothing able to stop it.
  controllers.get(jobId)?.abort()

  const controller = new AbortController()
  controllers.set(jobId, controller)
  try {
    return await fn(controller.signal)
  } finally {
    // Only clear our own entry: a later call may already have replaced it.
    if (controllers.get(jobId) === controller) controllers.delete(jobId)
  }
}

/** Cancel a running job. Returns false when there was nothing to cancel. */
export function cancelJob(jobId: string): boolean {
  const controller = controllers.get(jobId)
  if (!controller) return false
  controller.abort()
  controllers.delete(jobId)
  return true
}

/** True when an error came from a cancellation rather than a real failure. */
export function isCancellation(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /cancelled|aborted/i.test(message)
}
