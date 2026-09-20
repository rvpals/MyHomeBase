"use client";

// The music player's sleep timer: a clock button that opens a small panel of preset
// durations plus an hours/minutes pair, and reads out a live countdown once armed.
//
// Props in, events out. It owns the panel's open state and the two half-typed number
// fields, and nothing else -- the deadline, the interval and the stopping all live in
// `MusicPlayerProvider`, because a component that unmounts when you navigate cannot be
// trusted to hold a timer. The arithmetic (what a duration means, how a countdown
// reads) is in `src/lib/music/sleep-timer.ts`, where it is tested.
//
// The panel opens UPWARD. Every place this is mounted sits at or near the bottom edge
// of the window -- the player bar is pinned there, and the player screen's transport
// row is low on a phone -- so a panel hanging below the button would open off-screen.

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/button";
import {
  SLEEP_TIMER_PRESETS,
  clampTimerSeconds,
  describeCountdown,
  formatCountdown,
  hoursMinutesToSeconds,
} from "@/lib/music/sleep-timer";

export interface MusicSleepTimerProps {
  /** Seconds left, or `undefined` when no timer is armed. */
  remainingSeconds?: number;
  /** Arm the timer. Already-validated seconds; the component clamps before calling. */
  onStart: (seconds: number) => void;
  /** Disarm the timer, leaving the music playing. */
  onCancel: () => void;
  /**
   * `"bar"` is the icon button used in the player bar; `"inline"` is a labelled
   * secondary button for the player screen's transport row, where the neighbouring
   * controls are all text.
   *
   * A variant rather than two components: the panel, the validation and the countdown
   * are identical, and only the trigger differs.
   */
  variant?: "bar" | "inline";
  className?: string;
}

const FIELD_CLASS =
  "w-16 rounded-md border border-line bg-paper px-2 py-1 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export function MusicSleepTimer({
  remainingSeconds,
  onStart,
  onCancel,
  variant = "bar",
  className = "",
}: MusicSleepTimerProps) {
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  // Strings, not numbers: a number field being cleared passes through "", and storing
  // that as `0` makes the box refill itself with a zero the moment you delete a digit.
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");

  const isArmed = remainingSeconds !== undefined;
  const customSeconds = hoursMinutesToSeconds(Number(hours), Number(minutes));
  const canStartCustom = clampTimerSeconds(customSeconds) !== undefined;

  // Clicking elsewhere closes the panel. Registered only while open -- the player bar
  // is mounted on every page, so a permanent listener here would be one the whole app
  // carries to serve a panel that is almost never open.
  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const start = (seconds: number) => {
    const clamped = clampTimerSeconds(seconds);
    if (clamped === undefined) return;
    onStart(clamped);
    setHours("");
    setMinutes("");
    setIsOpen(false);
  };

  const cancel = () => {
    onCancel();
    setIsOpen(false);
  };

  const triggerLabel = isArmed
    ? `Sleep timer, ${describeCountdown(remainingSeconds)}`
    : "Set a sleep timer";

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {variant === "bar" ? (
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          aria-controls={panelId}
          aria-label={triggerLabel}
          title={triggerLabel}
          // 44px minimum touch target, matching the transport buttons beside it.
          // `w-auto` with padding when armed: the countdown needs the room, and a
          // fixed-width circle would clip "1:05:00".
          className={`grid h-11 shrink-0 place-items-center rounded-full text-ink hover:bg-brass-soft ${
            isArmed ? "w-auto gap-1 px-2" : "w-11"
          } ${isOpen ? "bg-brass-soft" : ""}`}
        >
          <span className={isArmed ? "flex items-center gap-1" : undefined}>
            <SleepTimerGlyph active={isArmed} />
            {isArmed && (
              <span className="font-mono text-xs text-brass" aria-hidden="true">
                {formatCountdown(remainingSeconds)}
              </span>
            )}
          </span>
        </button>
      ) : (
        <Button
          variant="secondary"
          onClick={() => setIsOpen(!isOpen)}
          ariaExpanded={isOpen}
          ariaControls={panelId}
          ariaLabel={triggerLabel}
          title={triggerLabel}
        >
          {isArmed ? `Sleep ${formatCountdown(remainingSeconds)}` : "Sleep timer"}
        </Button>
      )}

      {isOpen && (
        <div
          id={panelId}
          // Opens upward (`bottom-full`) -- see the note at the top of the file.
          // On a phone it stretches to a comfortable width and pins to the right edge
          // so it cannot overflow the viewport; that is a restyle, not a fork.
          className="absolute bottom-full right-0 z-30 mb-2 w-64 rounded-md border border-line bg-paper p-3 shadow-lg max-lg:w-[min(18rem,calc(100vw-2rem))]"
        >
          <p className="mb-2 text-xs font-medium text-muted">
            {isArmed ? "Music stops in" : "Stop the music after"}
          </p>

          {isArmed && (
            <p className="mb-3 font-mono text-2xl text-ink" aria-live="off">
              {formatCountdown(remainingSeconds)}
            </p>
          )}

          {/* Presets as a grid of buttons rather than a <select>: they are the
              common case, and a dropdown would cost an extra tap to reach the
              thing most people want. */}
          <div className="grid grid-cols-2 gap-1">
            {SLEEP_TIMER_PRESETS.map((preset) => (
              <button
                key={preset.minutes}
                type="button"
                onClick={() => start(preset.minutes * 60)}
                className="rounded-md border border-line px-2 py-2 text-sm text-ink hover:bg-brass-soft max-lg:py-2.5"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="mt-3 border-t border-line pt-3">
            <p className="mb-1 text-xs font-medium text-muted">Or a custom length</p>
            <div className="flex items-end gap-2">
              <label className="text-xs text-muted">
                <span className="mb-1 block">Hours</span>
                <input
                  type="number"
                  min={0}
                  max={12}
                  inputMode="numeric"
                  value={hours}
                  onChange={(event) => setHours(event.target.value)}
                  className={FIELD_CLASS}
                />
              </label>
              <label className="text-xs text-muted">
                <span className="mb-1 block">Minutes</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  inputMode="numeric"
                  value={minutes}
                  onChange={(event) => setMinutes(event.target.value)}
                  className={FIELD_CLASS}
                />
              </label>
              {/* Disabled rather than hidden until valid: a Start button that appears
                  only once the fields are right is a button people do not find. */}
              <Button
                size="sm"
                onClick={() => start(customSeconds)}
                disabled={!canStartCustom}
                title={canStartCustom ? "Start the timer" : "Choose at least one minute"}
              >
                Start
              </Button>
            </div>
          </div>

          {isArmed && (
            <div className="mt-3 border-t border-line pt-3">
              <Button variant="secondary" size="sm" onClick={cancel}>
                Cancel the timer
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A crescent moon, filled when a timer is running.
 *
 * Hand-drawn rather than a `SlotIcon`: this is a transport control sitting in a row
 * with play, pause and queue, and coding-guide.md keeps those hand-drawn so they read
 * as buttons rather than as places you can navigate to.
 */
function SleepTimerGlyph({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-5 w-5 ${active ? "fill-brass" : "fill-current"}`}
      aria-hidden="true"
    >
      <path d="M12.7 2a1 1 0 0 0-.9 1.5A7 7 0 0 1 3.5 12.9 1 1 0 0 0 2 13.8 9 9 0 1 0 12.7 2z" />
    </svg>
  );
}
