"use client";

// One-off home-screen widget (not a registered shared component), mirroring
// daily-quote-widget.tsx and today-in-history-widget.tsx.
//
// The split between server and client here is deliberate and is the whole design of
// this card. The **date and week number** are computed on the server and passed in as
// a `ClockReading`: they are the same for every reader, they change once a day, and
// rendering them server-side means the card has real content in its first paint. The
// **time** is client-only, because it belongs to the reader's own clock — a server
// timestamp would be wrong by the network round-trip and then frozen.

import { useEffect, useState, type ReactNode } from "react";
import { CollapsibleCard } from "@/components/collapsible-card";
import { SlotIcon } from "@/components/slot-icon";
import type { ClockReading } from "@/lib/clock";
import { getIconSlot } from "@/lib/icons";

// Resolved once at module scope. `getIconSlot` reads the static registry — no I/O — and
// the guard is for the registry, not the user: if this id is ever removed the card loses
// its icon rather than crashing.
const CLOCK_SLOT = getIconSlot("homescreen_card_clock");

/** The reader's wall clock as `HH:MM:SS`, zero-padded. */
function formatTime(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export function ClockWidget({
  reading,
  weather,
  className,
}: {
  /** The server's reading of today — date, weekday, ISO week. */
  reading: ClockReading;
  /**
   * The weather half of the card, already rendered by the server, or `undefined`
   * when the reader has set no location.
   *
   * Passed as a node rather than as forecast data because this is a client
   * component and the weather is not: handing it the `WeatherForecast` would drag
   * the whole strip into the browser bundle to render markup that never changes.
   * As a child it stays a server component and arrives as finished markup.
   */
  weather?: ReactNode;
  /** Spacing is the caller's call: the home screen owns each card's position. */
  className?: string;
}) {
  // `undefined` until the browser has mounted, never a server-rendered time.
  //
  // A clock is the textbook hydration mismatch: render `new Date()` on the server and
  // React re-renders on the client against a value that has already moved on, which
  // logs an error and — worse on a slow connection — shows a stale time until it does.
  // Starting empty and filling in on the first effect means the markup the server sent
  // and the markup the client hydrates are identical by construction. The gap is one
  // frame, and the slot holds its height so nothing below it jumps.
  const [time, setTime] = useState<string | undefined>(undefined);

  useEffect(() => {
    // Re-read the clock each tick rather than incrementing a counter. A `setInterval`
    // drifts, and is throttled hard in a background tab, so a counter would quietly
    // fall minutes behind on a dashboard left open all day; reading the real clock
    // means a throttled tick is late but never wrong.
    const tick = () => setTime(formatTime(new Date()));

    // The first reading is scheduled rather than called straight from the effect
    // body. Calling setState synchronously here would paint, then immediately
    // re-render — the cascading-render pattern `react-hooks/set-state-in-effect`
    // exists to catch. A 0ms timeout lands in the very next task, so the visible
    // delay is the same one frame, and the effect stays a pure subscription: it
    // starts two timers and tears both down.
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  return (
    // Open by default, unlike the Daily Quote: three lines of text won't push the
    // carousel anywhere, and a clock nobody can see is a clock that isn't working.
    <CollapsibleCard
      title="Clock"
      titleIcon={CLOCK_SLOT ? <SlotIcon slot={CLOCK_SLOT} className="h-4 w-4" /> : undefined}
      className={className}
      defaultOpen
    >
      <div className="flex items-baseline justify-between gap-4 max-lg:flex-col max-lg:items-start max-lg:gap-2">
        <div className="min-w-0">
          <p className="font-display text-2xl text-ink max-lg:text-xl">{reading.weekday}</p>
          <p className="mt-1 text-sm text-muted">{reading.longDate}</p>
        </div>

        <div className="flex flex-col items-end gap-2 max-lg:items-start">
          {/* `font-mono` because this is a ledger-style number that changes every
              second — a proportional face would jiggle the whole string every time
              a 1 replaced a 0. `tabular-nums` pins the digit width even so, since
              not every theme's mono face is truly fixed-width for digits.
              `aria-live="off"`: a clock announcing itself once a second would make
              the home screen unusable with a screen reader. */}
          <p
            className="font-mono text-4xl leading-none text-ink tabular-nums max-lg:text-3xl"
            aria-live="off"
          >
            {/* A non-breaking space, not an empty string, for the pre-mount frame:
                it reserves the line's full height so the card doesn't resize when
                the time arrives. */}
            {time ?? " "}
          </p>
          <span className="rounded-full bg-brass-soft px-2 py-0.5 text-xs font-semibold text-brass-dark">
            {/* The ISO week year, not the calendar year: on 1 January 2027 this card
                reads "Week 53 · 2026", which is correct and would be confusing if it
                claimed 2027. See `describeClock`. */}
            Week {reading.weekNumber} · {reading.weekYear}
          </span>
        </div>
      </div>

      {weather}
    </CollapsibleCard>
  );
}
