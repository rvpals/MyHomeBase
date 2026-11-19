"use client";

// A row of colour swatches from the shared tint palette, plus "Default".
//
// Pure presentation: it draws the palette and raises the chosen key. What is being
// recoloured, and what happens after, is the caller's business. Promoted from Clips'
// card-colour picker when Journal categories took the same palette (migration 0172);
// the swatches look exactly as they did there.

import type { TintColor } from "@/lib/shared/tint";

/** A palette key, or `""` for "no colour". */
export type TintChoice = TintColor | "";

/**
 * Every choice in display order: Default first, then the palette in the order it
 * is declared in `@/lib/shared/tint`. A local list rather than an import of
 * `TINT_COLORS` because components take types, not values, from `lib` — and the
 * `satisfies` below makes a new key a compile error here until its swatch exists.
 */
const OPTIONS: readonly TintChoice[] = ["", "rose", "amber", "sage", "ocean", "indigo", "slate"];

/**
 * The swatch class for each key. Spelled out rather than interpolated: Tailwind and
 * the CSS bundle are scanned as source text, so `clip-tint-${color}` is never
 * emitted. The `clip-tint-*` names predate the shared palette and are kept so
 * stored Clips colours render unchanged.
 */
const SWATCH_CLASS = {
  "": "bg-paper-raised",
  rose: "clip-tint clip-tint-rose",
  amber: "clip-tint clip-tint-amber",
  sage: "clip-tint clip-tint-sage",
  ocean: "clip-tint clip-tint-ocean",
  indigo: "clip-tint clip-tint-indigo",
  slate: "clip-tint clip-tint-slate",
} satisfies Record<TintChoice, string>;

/** On-screen names. The stored key is lowercase; a reader should see a word. */
const SWATCH_LABEL = {
  "": "Default",
  rose: "Rose",
  amber: "Amber",
  sage: "Sage",
  ocean: "Ocean",
  indigo: "Indigo",
  slate: "Slate",
} satisfies Record<TintChoice, string>;

export interface TintPickerProps {
  /** The current key, or `""` for the default. */
  value: TintChoice;
  /**
   * Raised with the chosen key. Typed as the union rather than `string` so a caller
   * cannot forward an arbitrary value into an action — the keys are persisted, and
   * the schema refusing an unknown one should be the second line of defence.
   */
  onChange: (color: TintChoice) => void;
  /** Names the group for screen readers, e.g. "Card colour". */
  ariaLabel: string;
  /** Disables every swatch while a save is in flight. */
  disabled?: boolean;
  className?: string;
}

export function TintPicker({
  value,
  onChange,
  ariaLabel,
  disabled = false,
  className = "",
}: TintPickerProps) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`flex flex-wrap items-center gap-1.5 ${className}`}
    >
      {OPTIONS.map((color) => (
        <button
          key={color || "default"}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={SWATCH_LABEL[color]}
          title={SWATCH_LABEL[color]}
          disabled={disabled}
          onClick={() => onChange(color)}
          // The ring, not a border, carries the selection: a border would change the
          // swatch's size and shuffle the row by a pixel as the choice moves.
          className={`h-7 w-7 rounded-full border border-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass disabled:opacity-50 ${
            SWATCH_CLASS[color]
          } ${value === color ? "ring-2 ring-brass ring-offset-1 ring-offset-paper" : ""}`}
        />
      ))}
    </div>
  );
}
