"use client";

// A dim over the whole screen with a spinner and a message, shown while a write
// is in flight — everything goes quiet except what you are waiting for.
//
// Why it exists: a write that takes a moment (a taxonomy merge over a few
// thousand entries, a bulk delete, a batch icon fill) otherwise shows nothing
// but a button whose label changed. That is easy to miss, and a reader who
// misses it assumes the click didn't land and clicks something else. Dimming
// the page removes every other thing to look at, so the wait is unmistakable
// and a stray second click lands on the scrim instead of a control.
//
// **It does not trap focus or block navigation.** Escape, the backdrop and the
// close button are `Modal`'s business through its own `isBusy` prop — pass that
// too when the work must not be abandoned. This component covers the screen,
// swallows clicks, and says what is happening.
//
// Rendered **outside** any `Modal` it accompanies (as a sibling, not a child),
// so the dialog dims along with the rest of the page rather than sitting lit
// above it.
//
// Pure presentation: it renders what it is told and raises no events. The caller
// owns the busy flag, because the caller is the one awaiting the work.

import { type ReactNode } from "react";
import { Progress3D } from "./progress-3d";

/** How heavily the screen is dimmed. */
type Tone = "default" | "subtle";

export interface BusyOverlayProps {
  /** Shown only while true. False renders nothing at all. */
  isBusy: boolean;
  /** What is happening, e.g. "Merging…". Keep it short — it sits beside a spinner. */
  message: string;
  /**
   * A second line under the message, for the consequence rather than the action
   * — "Don't close this window". Omit when there is nothing to warn about.
   */
  detail?: ReactNode;
  /**
   * Shows a progress bar under the message.
   *
   * `"indeterminate"` is the common case here and the honest one for most work this
   * overlay covers: a server action returns once, so a caller awaiting one knows the
   * job is running but cannot know how far along it is. A sweeping bar says "still
   * working" where a spinner alone can read as a stalled page on a job that runs for a
   * minute.
   *
   * Pass `{ value, max }` only when something genuinely counts the work -- a client-side
   * loop, or a polled run row. Inventing a fraction the caller cannot measure would be
   * worse than no bar.
   */
  progress?: "indeterminate" | { value: number; max: number };
  /**
   * Lets the reader stop the work.
   *
   * Only offer it when pressing it ACTUALLY STOPS SOMETHING -- a loop the client drives,
   * or a chunked series of requests. A button that merely hides the overlay while the
   * server keeps working is worse than none: it claims a power the page does not have.
   */
  onCancel?: () => void;
  /** The cancel button's label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** `subtle` dims less, when the work is quick enough that a heavy scrim jars. */
  tone?: Tone;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

const toneClasses: Record<Tone, string> = {
  // Dimming means darkening, so the scrim is ink-based rather than paper-based:
  // a paper scrim on a light theme would *brighten* the page instead. Token-based
  // either way — a literal colour would invert wrongly when the theme changes.
  default: "bg-ink/60",
  subtle: "bg-ink/40",
};

export function BusyOverlay({
  isBusy,
  message,
  detail,
  progress,
  onCancel,
  cancelLabel = "Cancel",
  tone = "default",
  className = "",
}: BusyOverlayProps) {
  if (!isBusy) return null;

  return (
    <div
      // `fixed inset-0` so it covers the viewport, and `z-[60]` to sit **above**
      // `Modal`, which is itself `z-50`. The dialog that started the work has to
      // dim along with everything else, or the thing the reader is told to wait
      // on is the brightest thing on screen. An equal z-index would not do it:
      // ties fall back to DOM order, and this renders before the modal.
      // Clicks land here rather than on anything behind it.
      className={`fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 ${toneClasses[tone]} ${className}`}
      // Announced to a screen reader, which otherwise gets no hint that the UI
      // went unresponsive on purpose.
      role="status"
      aria-live="polite"
    >
      {/* The message sits on its own raised card: against a dimmed page, plain
          text reads as part of the scrim rather than as the thing to look at. */}
      <div className="mx-4 flex max-w-sm flex-col items-center gap-3 rounded-xl border border-line bg-paper px-6 py-5 shadow-lg">
        <Spinner />
        <p className="text-center text-sm font-medium text-ink">{message}</p>

        {/* Full width of the card, so it reads as the job's own bar rather than a
            decoration beside the spinner. */}
        {progress !== undefined && (
          <Progress3D
            value={progress === "indeterminate" ? undefined : progress.value}
            max={progress === "indeterminate" ? undefined : progress.max}
            size="sm"
            ariaLabel={message}
            className="w-full"
          />
        )}

        {detail && <p className="text-center text-xs text-muted">{detail}</p>}

        {onCancel !== undefined && (
          <button
            type="button"
            onClick={onCancel}
            className="mt-1 rounded-full border border-line bg-paper-raised px-4 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          >
            {cancelLabel}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The spinning ring. Hand-drawn rather than a `SlotIcon`: this marks a *state*,
 * not a place, which `coding-guide.md` keeps out of the slot system.
 *
 * `border-brass` on three sides with a transparent fourth is what makes the
 * rotation visible — a full ring would look static while it spins.
 */
function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-6 w-6 animate-spin rounded-full border-2 border-brass border-t-transparent"
    />
  );
}
