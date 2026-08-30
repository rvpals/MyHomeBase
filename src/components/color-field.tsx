"use client";

import { useState } from "react";

/**
 * One color token: a swatch that opens the OS color picker, plus the hex typed out.
 *
 * The two halves are the point. A native `<input type="color">` alone gives no way to
 * paste a brand hex, and a text field alone gives no way to explore a hue — a theme
 * builder needs both, and keeping them in one component means the parent holds one
 * value per token rather than two.
 */
export interface ColorFieldProps {
  /** Rendered above the control and used as the swatch's accessible name. */
  label: string;
  /** The current `#RRGGBB`. May be mid-edit and therefore invalid. */
  value: string;
  /** Raises every keystroke, valid or not — the parent validates and shows errors. */
  onChange: (next: string) => void;
  /** Small muted line under the control: what this token actually paints. */
  hint?: string;
  /** Shown in place of `hint`, in the danger color. */
  error?: string;
  disabled?: boolean;
  className?: string;
}

/** `<input type="color">` only accepts #rrggbb, so anything else would reset it to black. */
function swatchValue(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : "#000000";
}

export function ColorField({
  label,
  value,
  onChange,
  hint,
  error,
  disabled = false,
  className = "",
}: ColorFieldProps) {
  // The text field keeps its own copy so a half-typed "#1A2" survives a re-render
  // without the parent having to store invalid state.
  //
  // Resynced by comparing against the last prop we saw, rather than in an effect: an
  // effect calling setState triggers a second render pass on every keystroke, and React
  // flags it. Storing the previous prop alongside the draft means an outside change
  // (switching which theme is being edited) is noticed during render instead.
  const [draft, setDraft] = useState({ typed: value, lastValue: value });
  const typed = draft.lastValue === value ? draft.typed : value;
  if (draft.lastValue !== value) setDraft({ typed: value, lastValue: value });

  const commit = (next: string) => {
    setDraft({ typed: next, lastValue: value });
    onChange(next);
  };

  return (
    <div className={className}>
      <label className="block text-xs font-medium uppercase tracking-wider text-muted">
        {label}
      </label>
      <div className="mt-1.5 flex items-center gap-2">
        {/* Fixed size rather than a flex child: a swatch that stretches reads as a
            banner, and the hex beside it is what needs the room. */}
        <input
          type="color"
          value={swatchValue(typed)}
          onChange={(event) => commit(event.target.value.toUpperCase())}
          disabled={disabled}
          aria-label={`${label} color picker`}
          className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-line bg-paper-raised disabled:cursor-not-allowed disabled:opacity-50"
        />
        <input
          type="text"
          value={typed}
          onChange={(event) => commit(event.target.value.toUpperCase())}
          disabled={disabled}
          spellCheck={false}
          aria-label={`${label} hex value`}
          placeholder="#000000"
          className={`w-full rounded-lg border bg-paper-raised px-2.5 py-1.5 font-mono text-sm text-ink outline-none transition focus:border-brass disabled:cursor-not-allowed disabled:opacity-50 ${
            error ? "border-red-400" : "border-line"
          }`}
        />
      </div>
      {(error || hint) && (
        <p className={`mt-1 text-xs ${error ? "text-red-400" : "text-muted"}`}>
          {error || hint}
        </p>
      )}
    </div>
  );
}
