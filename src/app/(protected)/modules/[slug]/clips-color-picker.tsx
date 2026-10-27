"use client";

// The seven swatches a clip card can wear, as a small popover row.
//
// Pure presentation: it draws the palette and raises the chosen key. Which clip is
// being recoloured, and what happens after, is the caller's business.

import { CLIP_CARD_COLORS, type ClipCardColor } from "@/lib/clips";

/**
 * The swatch class for each key, plus the default surface.
 *
 * Spelled out rather than interpolated, for the reason `ClipsCard` gives: Tailwind
 * and the CSS bundle are scanned as source text, so `clip-tint-${color}` is never
 * emitted.
 */
const SWATCH_CLASS: Record<string, string> = {
  "": "bg-paper-raised",
  rose: "clip-tint clip-tint-rose",
  amber: "clip-tint clip-tint-amber",
  sage: "clip-tint clip-tint-sage",
  ocean: "clip-tint clip-tint-ocean",
  indigo: "clip-tint clip-tint-indigo",
  slate: "clip-tint clip-tint-slate",
};

/** On-screen names. The stored key is lowercase; a reader should see a word. */
const SWATCH_LABEL: Record<string, string> = {
  "": "Default",
  rose: "Rose",
  amber: "Amber",
  sage: "Sage",
  ocean: "Ocean",
  indigo: "Indigo",
  slate: "Slate",
};

/** A palette key, or `""` for the default surface. */
export type ClipsColorChoice = ClipCardColor | "";

export interface ClipsColorPickerProps {
  /** The clip's current key, or `""` for the default surface. */
  value: ClipsColorChoice;
  /**
   * Raised with the chosen key.
   *
   * Typed as the union rather than `string` so a caller cannot forward an arbitrary
   * value into an action — the keys are persisted, and the schema refusing an
   * unknown one at the boundary should be the *second* line of defence, not the
   * first.
   */
  onChange: (color: ClipsColorChoice) => void;
  className?: string;
}

export function ClipsColorPicker({ value, onChange, className = "" }: ClipsColorPickerProps) {
  // The default surface first, then the palette in its declared order — which is
  // also the order the keys are declared in, so adding one appears here with no
  // change to this file.
  const options: ClipsColorChoice[] = ["", ...CLIP_CARD_COLORS];

  return (
    <div
      role="radiogroup"
      aria-label="Card colour"
      className={`flex flex-wrap items-center gap-1.5 ${className}`}
    >
      {options.map((color) => (
        <button
          key={color || "default"}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={SWATCH_LABEL[color]}
          title={SWATCH_LABEL[color]}
          onClick={() => onChange(color)}
          // The ring, not a border, carries the selection: a border would change the
          // swatch's size and shuffle the row by a pixel as the choice moves.
          className={`h-7 w-7 rounded-full border border-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
            SWATCH_CLASS[color]
          } ${value === color ? "ring-2 ring-brass ring-offset-1 ring-offset-paper" : ""}`}
        />
      ))}
    </div>
  );
}
