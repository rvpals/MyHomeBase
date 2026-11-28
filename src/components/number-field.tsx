// A labelled whole-number input with − / + steppers and min/max bounds.
//
// Pure presentation — the caller owns `value`. The steppers and the arrow keys clamp
// into [min, max]; typing is free while the field has focus and is clamped on blur, so
// a reader can clear the box to type "12" without it snapping to the minimum first.
// Theme tokens only. The steppers are 40px targets so it works by thumb on a phone.

"use client";

import { useEffect, useId, useState, type ReactNode } from "react";

export interface NumberFieldProps {
  /** The current value. Controlled. */
  value: number;
  /** Raised with a whole number already clamped into [min, max]. */
  onChange: (value: number) => void;
  /** The visible label. */
  label: ReactNode;
  /** An optional muted line under the label, e.g. the allowed range. */
  description?: ReactNode;
  min: number;
  max: number;
  /** How far one stepper press moves. Default 1. */
  step?: number;
  disabled?: boolean;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

const STEPPER_CLASS =
  "grid h-10 w-10 shrink-0 place-items-center text-lg text-ink transition-colors hover:bg-paper-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brass disabled:opacity-40 disabled:hover:bg-transparent";

export function NumberField({
  value,
  onChange,
  label,
  description,
  min,
  max,
  step = 1,
  disabled = false,
  className = "",
}: NumberFieldProps) {
  const inputId = useId();
  const descriptionId = useId();
  // What is in the box while typing. Synced from `value` whenever the caller changes it.
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const clamp = (next: number) => Math.min(max, Math.max(min, Math.round(next)));

  function commit(raw: string) {
    const parsed = Number(raw.trim());
    const next = raw.trim() === "" || !Number.isFinite(parsed) ? value : clamp(parsed);
    setText(String(next));
    if (next !== value) onChange(next);
  }

  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <label htmlFor={inputId} className="block text-sm text-ink">
          {label}
        </label>
        {description && (
          <span id={descriptionId} className="mt-0.5 block text-xs text-muted">
            {description}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center overflow-hidden rounded-md border border-line bg-paper">
        <button
          type="button"
          className={STEPPER_CLASS}
          aria-label="Decrease"
          disabled={disabled || value <= min}
          onClick={() => onChange(clamp(value - step))}
        >
          −
        </button>
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          aria-describedby={description ? descriptionId : undefined}
          aria-valuemin={min}
          aria-valuemax={max}
          disabled={disabled}
          value={text}
          onChange={(event) => setText(event.target.value.replace(/[^0-9]/g, ""))}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit(event.currentTarget.value);
            if (event.key === "ArrowUp") {
              event.preventDefault();
              onChange(clamp(value + step));
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              onChange(clamp(value - step));
            }
          }}
          className="h-10 w-12 border-x border-line bg-paper text-center text-sm tabular-nums text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brass disabled:opacity-50"
        />
        <button
          type="button"
          className={STEPPER_CLASS}
          aria-label="Increase"
          disabled={disabled || value >= max}
          onClick={() => onChange(clamp(value + step))}
        >
          +
        </button>
      </div>
    </div>
  );
}
