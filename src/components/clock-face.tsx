"use client";

// The clock itself — the face, the date lines and the week chip — with no card around
// it. Promoted out of the home screen's Clock card when the floating clock
// needed the same thing in a different container: the toggles (digital/analog, date,
// weekday, weather) are properties of the *clock*, so implementing them twice would
// have guaranteed the two drifted apart.
//
// Pure presentation. It receives a `ClockReading` and `ClockFaceOptions` as props and
// draws them; the weather arrives as an already-rendered node (see `weather`). The one
// thing it owns is the ticking time, which is genuinely client state — see below.

import { useEffect, useState, type ReactNode } from "react";
import { handAngles, hourMarkAngles, type ClockFaceOptions, type ClockReading } from "@/lib/clock";

export interface ClockFaceProps {
  /** The server's reading of today — date, weekday, ISO week. */
  reading: ClockReading;
  /** Which face to draw and what to show around it. */
  options: ClockFaceOptions;
  /**
   * The weather strip, already rendered by the server, or `undefined` when the reader
   * has set no location.
   *
   * A node rather than forecast data: this is a client component and the weather strip
   * is not, so taking the `WeatherForecast` would drag the whole strip into the browser
   * bundle to render markup that never changes. As a child it stays a server component
   * and arrives as finished markup. (`options.showWeather` still gates it — a caller
   * may pass the node and have it withheld.)
   */
  weather?: ReactNode;
  /** `"sm"` is the floating window's tighter face; `"md"` is the home card's. */
  size?: "sm" | "md";
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

/** The reader's wall clock as `HH:MM:SS`, zero-padded. */
function formatTime(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

/**
 * The ticking clock, as a `Date`.
 *
 * `undefined` until the browser has mounted, never a server-rendered time — a clock is
 * the textbook hydration mismatch, and the original widget's comment explains the
 * reasoning at length: render `new Date()` on the server and React re-renders against a
 * value that has already moved on. Starting empty means the server's markup and the
 * client's first render are identical by construction.
 *
 * A `Date` rather than a formatted string, because the analog face needs the parts.
 */
function useTick(): Date | undefined {
  const [now, setNow] = useState<Date | undefined>(undefined);

  useEffect(() => {
    // Re-read the clock each tick rather than incrementing a counter: a `setInterval`
    // drifts and is throttled hard in a background tab, so a counter would quietly fall
    // minutes behind on a page left open all day. Reading the real clock means a
    // throttled tick is late but never wrong.
    const tick = () => setNow(new Date());

    // Scheduled rather than called from the effect body — a synchronous setState here
    // would paint and then immediately re-render, which is the cascading-render pattern
    // `react-hooks/set-state-in-effect` exists to catch. A 0ms timeout lands in the next
    // task, so the visible delay is one frame and the effect stays a pure subscription.
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  return now;
}

/**
 * The analog dial.
 *
 * All geometry comes from `handAngles` / `hourMarkAngles` in `lib` — nothing here
 * computes an angle. `currentColor` and theme tokens throughout, so the face reads
 * correctly on a light theme as well as a dark one.
 */
function AnalogFace({ now, className = "" }: { now: Date | undefined; className?: string }) {
  // Before the first tick, draw the dial with no hands rather than hands at midnight:
  // a clock that shows 12:00:00 for a frame looks broken in a way an empty dial doesn't.
  const angles = now ? handAngles(now) : undefined;

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label={now ? `Analog clock showing ${formatTime(now)}` : "Analog clock"}
    >
      {/* The dial. `bg-paper` as a fill via currentColor isn't available in SVG, so
          these use the token variables directly — the one sanctioned way to reach a
          theme token from an attribute. */}
      <circle cx="50" cy="50" r="48" fill="var(--paper)" stroke="var(--line)" strokeWidth="1.5" />

      {/* Hour marks. The quarters are longer and brighter, which is what makes a dial
          readable at a glance without numerals — at puck size numerals would be mud. */}
      {hourMarkAngles().map((angle, index) => {
        const isQuarter = index % 3 === 0;
        return (
          <line
            key={angle}
            x1="50"
            y1={isQuarter ? 8 : 10}
            x2="50"
            y2={isQuarter ? 16 : 14}
            stroke={isQuarter ? "var(--brass)" : "var(--line)"}
            strokeWidth={isQuarter ? 3 : 2}
            strokeLinecap="round"
            transform={`rotate(${angle} 50 50)`}
          />
        );
      })}

      {angles && (
        <>
          {/* Each hand is drawn pointing up from the centre and rotated into place by
              `.clock-hand`, which reads `--hand-angle`. `transform-box: fill-box` plus
              a bottom origin is why each hand's geometry ends at y=50 (the centre).

              Hands are `<line>`s with a bottom-anchored origin rather than paths, so
              the rotation origin is the dial's centre without further arithmetic. */}
          <line
            className="clock-hand"
            style={{ "--hand-angle": angles.hour } as React.CSSProperties}
            x1="50"
            y1="28"
            x2="50"
            y2="52"
            stroke="var(--ink)"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <line
            className="clock-hand"
            style={{ "--hand-angle": angles.minute } as React.CSSProperties}
            x1="50"
            y1="16"
            x2="50"
            y2="52"
            stroke="var(--ink)"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <line
            className="clock-hand"
            style={{ "--hand-angle": angles.second } as React.CSSProperties}
            x1="50"
            y1="14"
            x2="50"
            y2="58"
            stroke="var(--brass)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      )}

      {/* The cap, drawn last so it sits over the hands' shared pivot. */}
      <circle cx="50" cy="50" r="3" fill="var(--brass)" />
    </svg>
  );
}

export function ClockFace({
  reading,
  options,
  weather,
  size = "md",
  className = "",
}: ClockFaceProps) {
  const now = useTick();
  const isAnalog = options.face === "analog";

  // Both date lines can be off, in which case the left column has nothing in it and the
  // face should not be pushed to one side by an empty box.
  const hasDateLines = options.showWeekday || options.showDate;

  return (
    <div className={className}>
      <div
        // `gap-8` rather than `justify-between`. The latter was right when this lived
        // in a full-width home-screen card, but in a content-sized floating window it
        // shoves the date and the time to opposite edges of whatever width is
        // available — which is what made the window look mostly empty. An explicit
        // gap lets the row be as wide as its content and no wider.
        className={`flex items-center gap-8 ${
          hasDateLines ? "max-lg:flex-col max-lg:items-start max-lg:gap-3" : "justify-center"
        }`}
      >
        {hasDateLines && (
          <div className="min-w-0">
            {options.showWeekday && (
              <p
                className={`font-display text-ink ${
                  size === "sm" ? "text-lg" : "text-2xl max-lg:text-xl"
                }`}
              >
                {reading.weekday}
              </p>
            )}
            {options.showDate && (
              <p className={`text-muted ${options.showWeekday ? "mt-1" : ""} text-sm`}>
                {reading.longDate}
              </p>
            )}
          </div>
        )}

        <div className={`flex flex-col gap-2 ${hasDateLines ? "items-end max-lg:items-start" : "items-center"}`}>
          {isAnalog ? (
            <AnalogFace now={now} className={size === "sm" ? "h-24 w-24" : "h-32 w-32"} />
          ) : (
            /* `font-mono` because this is a ledger-style number that changes every
               second — a proportional face would jiggle the whole string on every tick.
               `tabular-nums` pins the digit width even so, since not every theme's mono
               face is truly fixed-width for digits. `aria-live="off"`: a clock
               announcing itself once a second would make the page unusable with a
               screen reader. */
            <p
              className={`font-mono leading-none text-ink tabular-nums ${
                size === "sm" ? "text-3xl" : "text-4xl max-lg:text-3xl"
              }`}
              aria-live="off"
            >
              {/* A non-breaking space, not an empty string, for the pre-mount frame: it
                  reserves the line's full height so nothing below it jumps when the
                  time arrives. */}
              {now ? formatTime(now) : " "}
            </p>
          )}

          <span className="rounded-full bg-brass-soft px-2 py-0.5 text-xs font-semibold text-brass-dark">
            {/* The ISO week *year*, not the calendar year: on 1 January 2027 this reads
                "Week 53 · 2026", which is correct and would confuse if it said 2027. */}
            Week {reading.weekNumber} · {reading.weekYear}
          </span>
        </div>
      </div>

      {options.showWeather ? weather : null}
    </div>
  );
}
