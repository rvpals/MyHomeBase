// A progress bar that reads as a physical thing: a groove cut into the page,
// with a lit slab filling it. Use it for any determinate 0..max fraction of
// work -- an import, a scan, a refresh.
//
// The two gradients and the offset shadow live in `globals.css`
// (`.progress-3d-track` / `.progress-3d-fill`) rather than here, because the
// track's is cut from the theme's own surface tokens and the fill's carries the
// same hard offset shadow as `Button`. This file's job is the geometry, the
// clamping and the aria.
//
// Not for: a *scrubber* you can drag (that's the music player's own bar), or a
// used/total stat tile with a figure above it (that's `UsageMeter`).

type Size = "sm" | "md" | "lg";
type Tone = "accent" | "positive" | "negative";

export interface Progress3DProps {
  /**
   * Work done, in the same unit as `max`. Clamped into range, so a caller
   * that overshoots gets a full bar rather than one that overflows its track.
   * Pass `undefined` for a job that hasn't counted its total yet -- the bar
   * goes indeterminate instead of showing a misleading 0%.
   */
  value: number | undefined;
  /** The whole. Defaults to 100. Zero or negative renders an empty track rather than dividing by it. */
  max?: number;
  /** Bar thickness. Defaults to "md". */
  size?: Size;
  /**
   * Which fill. "accent" follows the color theme; "positive"/"negative" are
   * fixed semantic green/red -- up and down mean the same thing in every
   * theme, so they are deliberately not theme tokens (see design.md).
   */
  tone?: Tone;
  /** Shown above the bar, in the stat-tile label style. */
  label?: string;
  /** Shows the percentage at the label's right. Needs `label` to have a row to sit in. */
  showValue?: boolean;
  /**
   * Overrides the "42%" readout with the caller's own text -- "128 / 900 files".
   * Only the caller knows the unit. Receives the clamped value and the max.
   */
  formatValue?: (value: number, max: number) => string;
  /**
   * Accessible name. Required when there is no `label` for a screen reader to
   * pick up -- a nameless progressbar announces only a number.
   */
  ariaLabel?: string;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

// Thickness only. The bar is always fluid-width, so it needs nothing from
// `max-lg:` to work on a phone.
const sizeClasses: Record<Size, string> = {
  sm: "h-1.5",
  md: "h-2.5",
  lg: "h-4",
};

// The offset shadow reads as a solid edge, so it has to be the darker of the
// two stops -- the fill is lit from above and the edge is in shadow. `from` is
// therefore the dark end and also what `.progress-3d-fill` casts.
const toneVars: Record<Tone, { from: string; to: string }> = {
  accent: { from: "var(--brass-dark)", to: "var(--brass)" },
  // Semantic tones use the 400/500 shades design.md prescribes: bright enough
  // to hold up on the dark themes, which is where most of them are.
  positive: { from: "#047857", to: "#34D399" },
  negative: { from: "#B91C1C", to: "#F87171" },
};

export function Progress3D({
  value,
  max = 100,
  size = "md",
  tone = "accent",
  label,
  showValue = false,
  formatValue,
  ariaLabel,
  className = "",
}: Progress3DProps) {
  const indeterminate = value === undefined;
  const clamped = indeterminate ? 0 : Math.min(Math.max(value, 0), Math.max(max, 0));
  const fraction = !indeterminate && max > 0 ? clamped / max : 0;
  const percent = Math.round(fraction * 100);

  const readout = indeterminate
    ? "counting..."
    : formatValue
      ? formatValue(clamped, max)
      : `${percent}%`;

  const { from, to } = toneVars[tone];
  // Handed to CSS as custom properties so one `.progress-3d-fill` rule serves
  // all three tones -- see the comment on that class.
  const fillVars = {
    "--progress-3d-from": from,
    "--progress-3d-to": to,
  } as React.CSSProperties;

  return (
    <div className={className}>
      {label !== undefined && (
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
          {showValue && <p className="font-mono text-xs text-muted">{readout}</p>}
        </div>
      )}

      {/* `mb-[3px]` reserves the room the 3px offset shadow occupies, so the
          bar doesn't cast onto whatever sits directly beneath it. */}
      <div
        className={`progress-3d-track relative mb-[3px] w-full overflow-hidden rounded-full ${sizeClasses[size]} ${label !== undefined ? "mt-2" : ""}`}
        role="progressbar"
        aria-label={ariaLabel ?? label}
        aria-valuemin={0}
        aria-valuemax={indeterminate ? undefined : 100}
        aria-valuenow={indeterminate ? undefined : percent}
        aria-valuetext={indeterminate ? "In progress, total unknown" : readout}
      >
        {indeterminate ? (
          <div
            className="progress-3d-fill progress-3d-indeterminate h-full w-1/4 rounded-full"
            style={fillVars}
          />
        ) : (
          <div
            className="progress-3d-fill h-full rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none"
            style={{ ...fillVars, width: `${fraction * 100}%` }}
          />
        )}
      </div>
    </div>
  );
}
