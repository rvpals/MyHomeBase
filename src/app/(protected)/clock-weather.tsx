// The weather strip: where, what it's doing now, and the week ahead.
//
// Originally the lower half of the home screen's Clock card. That card was retired,
// and this outlived it because the **Floating Clock** shows the same strip — the
// protected layout renders it and passes it down as a node. Kept here, beside the
// layout that mounts it, rather than promoted to `src/components/`: it has exactly one
// caller, and `components.md` keeps single-caller UI out of the registry.
//
// Presentation-only — it receives a fully-formed `WeatherForecast` and renders it. The
// fetch, the caching and the WMO mapping all happen in `@/lib/weather`; nothing here
// decides anything.
//
// A server component: none of this ticks or responds to input, so shipping it to the
// browser would buy nothing. That is also why it travels to the client-side floating
// clock as a rendered node rather than as forecast data — see `ClockFace`'s `weather`.

import { weatherShape, type WeatherShape } from "@/lib/weather";
import type { DailyForecast, WeatherForecast } from "@/lib/weather";

/**
 * The condition glyphs, drawn locally rather than through `SlotIcon`.
 *
 * These are **state glyphs** — the shape is chosen by the WMO code and changes with
 * the weather — which `src/lib/icons/slots.ts` explicitly excludes from the slot
 * registry: letting someone re-skin "rain" but not "snow" breaks the distinction the
 * set exists to carry. The floating window's *title* icon is a registered slot; these
 * are not.
 *
 * `currentColor` throughout, so they inherit the theme token of whatever they sit in.
 */
function ConditionIcon({ shape, className = "" }: { shape: WeatherShape; className?: string }) {
  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  // One <svg> per shape rather than a lookup of paths: each needs a different
  // combination of circle/path/line, and a table of fragments reads worse than this.
  switch (shape) {
    case "clear":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...stroke}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
        </svg>
      );
    case "partly":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...stroke}>
          <circle cx="8" cy="8" r="3.2" />
          <path d="M8 1.6v1.6M1.6 8h1.6M3.6 3.6l1.1 1.1M12.4 3.6l-1.1 1.1" />
          <path d="M7.5 18h9a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.5 1.2A3 3 0 0 0 7.5 18Z" />
        </svg>
      );
    case "cloud":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...stroke}>
          <path d="M7 18h10a4 4 0 0 0 .3-8 5.5 5.5 0 0 0-10.6 1.3A3.4 3.4 0 0 0 7 18Z" />
        </svg>
      );
    case "fog":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...stroke}>
          <path d="M7 15h10a4 4 0 0 0 .3-8 5.5 5.5 0 0 0-10.6 1.3A3.4 3.4 0 0 0 7 15Z" />
          <path d="M4 19h16M7 22h10" />
        </svg>
      );
    case "drizzle":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...stroke}>
          <path d="M7 15h10a4 4 0 0 0 .3-8 5.5 5.5 0 0 0-10.6 1.3A3.4 3.4 0 0 0 7 15Z" />
          <path d="M9 18.5v1.5M13 18.5v1.5M17 18.5v1.5" />
        </svg>
      );
    case "rain":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...stroke}>
          <path d="M7 14h10a4 4 0 0 0 .3-8 5.5 5.5 0 0 0-10.6 1.3A3.4 3.4 0 0 0 7 14Z" />
          <path d="M8.5 17.5 7.5 21M13 17.5 12 21M17.5 17.5 16.5 21" />
        </svg>
      );
    case "snow":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...stroke}>
          <path d="M7 14h10a4 4 0 0 0 .3-8 5.5 5.5 0 0 0-10.6 1.3A3.4 3.4 0 0 0 7 14Z" />
          <path d="M9 18v3M7.5 19.5h3M15 18v3M13.5 19.5h3" />
        </svg>
      );
    case "storm":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...stroke}>
          <path d="M7 14h10a4 4 0 0 0 .3-8 5.5 5.5 0 0 0-10.6 1.3A3.4 3.4 0 0 0 7 14Z" />
          <path d="m13 16.5-3 3.5h3l-1 3.5" />
        </svg>
      );
  }
}

/** Temperatures are whole degrees here — a tenth of a degree is noise on a dashboard. */
function degrees(value: number): string {
  return String(Math.round(value));
}

/**
 * The weekday for a forecast row.
 *
 * The date string is parsed by hand rather than with `new Date(iso)`, which reads a
 * bare "YYYY-MM-DD" as **UTC midnight** and so names the previous day for any reader
 * west of Greenwich — the forecast would be labelled Sunday-to-Saturday while actually
 * covering Monday-to-Sunday. Splitting the fields and building a local date keeps the
 * label on the same day the service filed the row under.
 */
function weekdayLabel(isoDate: string, index: number): string {
  if (index === 0) return "Today";

  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;

  return new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(
    new Date(year, month - 1, day),
  );
}

function ForecastDay({ day, index, unit }: { day: DailyForecast; index: number; unit: string }) {
  return (
    <li
      // `shrink-0` with a floor width: on a phone the row scrolls sideways rather than
      // squeezing seven columns into 320px, which is what would turn "Wed" into "W…".
      // A fixed column width rather than `w-full`. `w-full` made each of the seven
      // columns stretch to a seventh of whatever the container offered, so in a
      // content-sized window the strip was the thing *defining* the width — 2000px of
      // mostly-empty forecast. At a fixed 4rem the strip asks for the ~28rem it
      // actually needs and the window sizes to that.
      className="flex w-16 shrink-0 flex-col items-center gap-1 rounded-lg px-2 py-2"
      title={day.description}
    >
      <span className="text-xs font-medium text-muted">{weekdayLabel(day.date, index)}</span>
      <ConditionIcon shape={weatherShape(day.code)} className="h-6 w-6 text-brass" />
      <span className="font-mono text-xs tabular-nums text-ink">
        {degrees(day.high)}
        <span className="text-muted">/{degrees(day.low)}</span>
      </span>
      {/* The unit once per column would be noise; it's on the current reading above.
          Kept in the accessible name so a screen reader isn't left guessing. */}
      <span className="sr-only">
        {day.description}, high {degrees(day.high)}
        {unit}, low {degrees(day.low)}
        {unit}
      </span>
    </li>
  );
}

export function ClockWeather({
  forecast,
  placeName,
}: {
  forecast: WeatherForecast;
  /** Where this is for — the card says so rather than making the reader assume. */
  placeName: string;
}) {
  const { current, days, unit } = forecast;

  return (
    <section className="mt-4 border-t border-line pt-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <ConditionIcon shape={weatherShape(current.code)} className="h-10 w-10 shrink-0 text-brass" />
          <div className="min-w-0">
            <p className="font-mono text-2xl leading-none tabular-nums text-ink">
              {degrees(current.temperature)}
              {current.unit}
            </p>
            <p className="mt-1 truncate text-sm text-muted">{current.description}</p>
          </div>
        </div>

        {/* The location, right-aligned against the current reading. `truncate` because
            a Nominatim display name can be a full postal address. */}
        <p className="min-w-0 truncate text-right text-sm font-medium text-ink" title={placeName}>
          {placeName}
        </p>
      </div>

      {days.length > 0 && (
        // A flex row of fixed-width columns, not a 7-column grid. The grid made each
        // column a seventh of whatever the container offered, so the strip *defined*
        // the width and a content-sized floating window came out 2000px wide with a
        // mostly-empty forecast. Fixed columns ask for the ~28rem they need, and
        // scroll sideways on a narrow screen rather than squeezing into 320px.
        <ul className="mt-3 flex gap-1 overflow-x-auto pb-1">
          {days.map((day, index) => (
            <ForecastDay key={day.date} day={day} index={index} unit={unit} />
          ))}
        </ul>
      )}
    </section>
  );
}
