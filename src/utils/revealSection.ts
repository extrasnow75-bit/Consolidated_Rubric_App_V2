/**
 * Bring a newly revealed section into view, and move focus to it.
 *
 * The problem this solves: choosing a Phase 1 option renders the next step *below the fold*, so
 * from the user's seat nothing happens — the button looks broken and they click it again. The
 * content was there the whole time, just off-screen.
 *
 * Scrolling alone only fixes it for people looking at the screen. A screen-reader user gets no
 * announcement at all, because focus stays on the button they just pressed; they are left in the
 * same "nothing happened" state permanently. So this moves focus into the new section as well,
 * which announces it and — as a bonus — is what makes the scroll reliable, since browsers scroll
 * to whatever receives focus.
 *
 * The target needs `tabIndex={-1}` to be focusable without joining the tab order.
 */
export function revealSection(el: HTMLElement | null): void {
  if (!el) return;

  // `matchMedia` is missing in some test environments; treat its absence as "no preference".
  const prefersReducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  el.scrollIntoView({
    behavior: prefersReducedMotion ? 'auto' : 'smooth',
    block: 'start',
  });

  // preventScroll because scrollIntoView above already owns the scrolling; without it the
  // browser jumps instantly to the element and the smooth scroll never appears.
  el.focus({ preventScroll: true });
}

/**
 * The delay before revealing.
 *
 * The section mounts in the same commit that triggers this, but its height is not final until
 * the browser has laid it out — scrolling too early lands at the wrong offset. One frame is
 * usually enough; this matches the 100ms the Analyze section already used.
 */
export const REVEAL_DELAY_MS = 100;
