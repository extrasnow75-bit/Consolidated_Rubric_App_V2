import { useEffect, useRef } from 'react';

/**
 * Focus behaviour shared by every dialog and drawer in the app.
 *
 * Three separate overlays had three different amounts of this — the Drive browser handled
 * Escape, the others handled nothing — so a keyboard user's experience depended on which panel
 * they happened to open. It is one hook now.
 *
 * What it does when `isOpen`:
 *
 *   - Moves focus into the dialog. Without this the dialog is invisible to a screen reader: it
 *     appears on screen, focus stays wherever it was, and nothing is announced.
 *   - Keeps Tab inside it. Otherwise Tab walks out into the page behind the overlay — content
 *     the user has just been told is unavailable.
 *   - Closes on Escape.
 *   - Restores focus to whatever opened it. Without this, closing drops focus to <body> and a
 *     keyboard user restarts from the top of the page.
 *
 * Pass `trapFocus: false` for a panel that should take focus and close on Escape but not hold
 * Tab captive.
 */
export function useDialogFocus<T extends HTMLElement = HTMLElement>(
  isOpen: boolean,
  onClose: () => void,
  options?: {
    trapFocus?: boolean;
    /**
     * Use a ref the caller already has, instead of the one this hook creates.
     *
     * HelpCenter keeps its own ref on the panel for scroll-to-section, and attaching a second
     * one is not possible. Without this the hook held a ref nobody wired up, so `focusable()`
     * searched an empty container and focus silently never moved — which is exactly the bug it
     * was added to fix.
     */
    ref?: React.RefObject<T | null>;
    /**
     * Element to focus on open, instead of the first focusable one in the container.
     *
     * The Drive browser wants focus in its search box, because typing a filename is the fastest
     * way to find something. Its first focusable element is the Close button in the header, so
     * without this the hook would take focus away from where the dialog wants it and the two
     * would race each other through their timers.
     */
    initialFocus?: React.RefObject<HTMLElement | null>;
  },
) {
  const ownRef = useRef<T | null>(null);
  const containerRef = options?.ref ?? ownRef;
  const restoreRef = useRef<HTMLElement | null>(null);
  const trapFocus = options?.trapFocus !== false;
  const initialFocus = options?.initialFocus;

  /**
   * The close callback, held in a ref so the effect below does not depend on its identity.
   *
   * Callers pass an inline arrow — `onCancel={() => settle(null)}` in DrivePickerContext, for
   * one — which is a new function on every render of the parent. If the effect depended on it,
   * every such render would tear the effect down and set it up again, and teardown *restores
   * focus*. The dialog would keep throwing focus back to the button that opened it while the
   * user was still typing in it.
   */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!isOpen) return;

    restoreRef.current = document.activeElement as HTMLElement | null;

    const focusable = (): HTMLElement[] => {
      const root = containerRef.current;
      if (!root) return [];
      return Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
            'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
        // offsetParent is null for anything display:none or in a hidden ancestor, which keeps
        // controls that are only visually present out of the trap.
      ).filter((el) => el.offsetParent !== null);
    };

    // A frame's delay: the dialog may still be mid-transition, and focusing an element that is
    // not yet laid out silently does nothing.
    const timer = window.setTimeout(() => {
      const first = initialFocus?.current ?? focusable()[0];
      (first ?? containerRef.current)?.focus();
    }, 50);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (!trapFocus || e.key !== 'Tab') return;

      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (containerRef.current && !containerRef.current.contains(active)) {
        // Focus escaped some other way (a click outside, a programmatic move); pull it back.
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown, true);
      restoreRef.current?.focus?.();
    };
  }, [isOpen, trapFocus, initialFocus]);

  return containerRef;
}

/**
 * Mark a subtree `inert` while it is hidden.
 *
 * For panels that stay mounted and slide off-screen. A CSS transform moves it out of view but
 * leaves every control focusable and readable by assistive tech, so Tab lands on buttons nobody
 * can see and a screen reader announces a panel that is not open. `inert` removes the whole
 * subtree from focus and from the accessibility tree without disturbing the transition.
 */
export function useInertWhenHidden(
  ref: React.RefObject<HTMLElement | null>,
  isHidden: boolean,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (isHidden) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }, [ref, isHidden]);
}
