"use client";

// The Floating Clock: the first floating component, and the shape the rest follow.
//
// It is deliberately thin. The clock's *appearance* is `ClockFace` (shared with the home
// screen card), the window and puck chrome is `FloatingWindow` / `FloatingPuck`, the
// state is the provider's and the rules are `lib`'s. What is left here is the wiring —
// which is what a floating component should cost once the layer exists.

import { ClockFace } from "@/components/clock-face";
import { FloatingPuck, FloatingWindow } from "@/components/floating-window";
import { useFloatingLayer } from "@/components/floating-layer";
import { SlotIcon } from "@/components/slot-icon";
import { handAngles, hourMarkAngles, type ClockFaceOptions, type ClockReading } from "@/lib/clock";
import { getIconSlot } from "@/lib/icons";
import { useEffect, useState, type ReactNode } from "react";

// Resolved once at module scope — `getIconSlot` reads the static registry, no I/O. The
// guard is for the registry, not the user: if the id is ever removed the window loses
// its glyph rather than crashing. Same pattern as the home card's.
const CLOCK_SLOT = getIconSlot("homescreen_card_clock");

/**
 * The puck's image: a live analog dial, small enough to read at 56px.
 *
 * Always analog, whatever the reader's face preference, and that is a deliberate
 * divergence from the window. `HH:MM:SS` at puck size is either illegibly small or
 * clipped, whereas a dial is recognisable as a clock at a glance and *shows the time*
 * without being read — which is the whole job of a minimized image. The digits are one
 * tap away.
 *
 * A trimmed-down dial rather than `ClockFace`'s: no hour marks beyond the quarters and
 * no second hand, because at this size both are noise.
 */
function PuckClock() {
  const [now, setNow] = useState<Date | undefined>(undefined);

  useEffect(() => {
    // The same real-clock read as `ClockFace`, and the same reasoning: a counter drifts
    // and gets throttled in a background tab. Once a *minute* here, not once a second —
    // the puck draws no second hand, so a per-second timer would repaint an identical
    // picture 59 times for nothing.
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  const angles = now ? handAngles(now) : undefined;

  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true">
      {hourMarkAngles()
        // Quarters only — twelve ticks at this size is a grey smudge.
        .filter((_, index) => index % 3 === 0)
        .map((angle) => (
          <line
            key={angle}
            x1="50"
            y1="12"
            x2="50"
            y2="20"
            stroke="var(--line)"
            strokeWidth="4"
            strokeLinecap="round"
            transform={`rotate(${angle} 50 50)`}
          />
        ))}

      {angles && (
        <>
          <line
            className="clock-hand"
            style={{ "--hand-angle": angles.hour } as React.CSSProperties}
            x1="50"
            y1="30"
            x2="50"
            y2="52"
            stroke="var(--ink)"
            strokeWidth="7"
            strokeLinecap="round"
          />
          <line
            className="clock-hand"
            style={{ "--hand-angle": angles.minute } as React.CSSProperties}
            x1="50"
            y1="18"
            x2="50"
            y2="52"
            stroke="var(--brass)"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </>
      )}
      <circle cx="50" cy="50" r="4" fill="var(--brass)" />
    </svg>
  );
}

export function FloatingClock({
  reading,
  options,
  weather,
}: {
  /** The server's reading of today. Same prop the home card takes. */
  reading: ClockReading;
  /** The reader's face and toggle choices. */
  options: ClockFaceOptions;
  /**
   * The weather strip, pre-rendered on the server — see `ClockFace`'s `weather`.
   * Passed down from the layout so this stays a client component without dragging
   * the forecast markup into the bundle.
   */
  weather?: ReactNode;
}) {
  const layer = useFloatingLayer();
  // `undefined` outside the provider, per `useFloatingLayer`'s contract. Nothing to
  // draw in that case rather than a crash.
  if (!layer) return null;

  const state = layer.states.clock ?? "closed";
  if (state === "closed") return null;

  const slot = CLOCK_SLOT ? <SlotIcon slot={CLOCK_SLOT} className="h-4 w-4" /> : undefined;
  const puck = layer.puckSlots.find((candidate) => candidate.id === "clock");

  if (state === "minimized") {
    return (
      <FloatingPuck
        label="Floating Clock"
        // `?? 0` is unreachable while `resolvePuckSlots` derives its list from the same
        // states this branch read, but a puck rendering at index 0 is a better failure
        // than one that doesn't render.
        index={puck?.index ?? 0}
        // The reader's docked corner, defaulting when the slot is somehow missing.
        corner={puck?.corner ?? "bottom-right"}
        onRestore={() => layer.restore("clock")}
        onClose={() => layer.close("clock")}
      >
        <PuckClock />
      </FloatingPuck>
    );
  }

  return (
    <FloatingWindow
      title="Clock"
      titleIcon={slot}
      onClose={() => layer.close("clock")}
      onMinimize={() => layer.minimize("clock")}
    >
      {/* `size="sm"` — the window is smaller than the home card's column, so the face
          steps down with it. */}
      <ClockFace reading={reading} options={options} weather={weather} size="sm" />
    </FloatingWindow>
  );
}
