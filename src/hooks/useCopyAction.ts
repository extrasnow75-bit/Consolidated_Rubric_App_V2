import { useCallback, useEffect, useRef, useState } from 'react';

/** What the button should be saying right now. */
export type CopyState = 'idle' | 'copied' | 'failed';

const FEEDBACK_MS = 2000;

/**
 * Copy text, and tell the user whether it worked.
 *
 * Both halves matter. A copy button that succeeds silently is indistinguishable from one that
 * did nothing, so people click it repeatedly and paste on faith; a copy button that *fails*
 * silently is worse, and that is what these were. `navigator.clipboard.writeText` returns a
 * promise, it rejects when the document is not focused or the context is not judged secure, and
 * every call site here dropped it on the floor — no catch, no state, no visible change.
 *
 * That is a bad failure for this particular control. The deployment log's whole purpose is to be
 * sent to somebody who can read it, usually at the moment something has already gone wrong.
 *
 * The copy itself goes through the main process (see `clipboard:writeText`), which has none of
 * the renderer's preconditions.
 */
export function useCopyAction(): {
  state: CopyState;
  copy: (text: string) => Promise<void>;
} {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<number | undefined>(undefined);

  // Without this, a copy on a panel that unmounts before the reset fires sets state on a dead
  // component — and the next mount would open showing "Copied".
  useEffect(
    () => () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async (text: string) => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    let ok = false;
    try {
      ok = await window.api.app.copyText(text);
    } catch {
      ok = false;
    }
    setState(ok ? 'copied' : 'failed');
    timer.current = window.setTimeout(() => setState('idle'), FEEDBACK_MS);
  }, []);

  return { state, copy };
}
