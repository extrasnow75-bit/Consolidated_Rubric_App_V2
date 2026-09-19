import { useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';

/**
 * Text-size control for the ribbon.
 *
 * Ported from Canvas Extractor Tools, deliberately near-verbatim: the two apps are used by the
 * same people on the same day, and a control that works differently in each is worse than one
 * that looks the same and behaves the same. Only the focus ring changed, to this app's brand
 * token.
 *
 * Electron's zoom level is logarithmic (factor = 1.2 ** level), so the percentage shown is
 * derived rather than stored — it is what the user actually perceives, and "125%" means more to
 * them than "level 1".
 *
 * The buttons exist because the keyboard shortcuts are invisible. Ctrl/Cmd with + or − has
 * worked since the desktop rewrite, but the window has no menu bar, so there is nothing to
 * discover it from — the shortcut was documented in the Help Center and nowhere the user would
 * look. Both routes drive the same main-process state and this control follows along via
 * onZoomChanged, so the readout stays correct whichever one is used.
 */
export function ZoomControl() {
  const [level, setLevel] = useState(0);
  const [range, setRange] = useState({ min: -2, max: 5 });

  /**
   * Announcement text, kept separate from `level` so that restoring a saved zoom at startup does
   * not speak. The component mounts at 100%, then the saved level arrives — a change the user did
   * not make and does not need read to them.
   */
  const [announcement, setAnnouncement] = useState('');
  const ready = useRef(false);

  useEffect(() => {
    window.api.app.getZoom().then(({ level, min, max }) => {
      setLevel(level);
      setRange({ min, max });
      ready.current = true;
    });
    return window.api.app.onZoomChanged((next) => {
      setLevel(next);
      // Covers the keyboard shortcuts too, which change zoom without touching this UI.
      if (ready.current) setAnnouncement(`Text size ${Math.round(1.2 ** next * 100)} percent`);
    });
  }, []);

  const percent = Math.round(1.2 ** level * 100);
  const atMin = level <= range.min;
  const atMax = level >= range.max;

  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-gray-600 mr-0.5">Text size</span>

      {/* aria-disabled rather than disabled: a `disabled` button is dropped from the tab order,
          and Chromium blurs it if it was focused — so holding − to the floor threw focus to
          <body> and a keyboard user had to tab back from the start of the ribbon.
          border-gray-500 rather than -300, which was 1.47:1 against white; the border is the only
          thing marking these out as controls, and 1.4.11 wants 3:1 for that. */}
      <button
        onClick={() => {
          if (!atMin) void window.api.app.stepZoom(-1);
        }}
        aria-disabled={atMin}
        aria-label="Decrease text size"
        className={`rounded-lg border border-gray-500 p-1.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
          atMin ? 'text-gray-500 cursor-not-allowed' : 'text-gray-700 hover:bg-gray-50'
        }`}
      >
        <Minus className="w-3.5 h-3.5" aria-hidden="true" />
      </button>

      {/* Doubles as the reset control — clicking the percentage returns it to 100%. The accessible
          name opens with the visible string verbatim, so speech-input users can say what they see
          (2.5.3), and so the name is not re-announced on every change. */}
      <button
        onClick={() => void window.api.app.resetZoom()}
        aria-label={`${percent}% — reset text size to 100%`}
        title="Reset text size to 100%"
        className="min-w-[3.25rem] rounded-lg border border-gray-500 px-1.5 py-1 text-xs font-bold tabular-nums text-gray-700 hover:bg-gray-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {percent}%
      </button>

      <button
        onClick={() => {
          if (!atMax) void window.api.app.stepZoom(1);
        }}
        aria-disabled={atMax}
        aria-label="Increase text size"
        className={`rounded-lg border border-gray-500 p-1.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
          atMax ? 'text-gray-500 cursor-not-allowed' : 'text-gray-700 hover:bg-gray-50'
        }`}
      >
        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
      </button>

      {/* The percentage button is announced on focus, but a change made with Ctrl+= while focus is
          elsewhere would otherwise be silent. */}
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
