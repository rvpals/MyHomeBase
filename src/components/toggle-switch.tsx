// An on/off switch with a label: a `role="switch"` button, not a styled checkbox.
//
// Pure presentation — the caller owns `checked` and decides what a flip means.
// Keyboard: Space/Enter flip it (native button behaviour). Theme tokens only, so it
// follows every colour theme.

"use client";

import { useId, type ReactNode } from "react";

export interface ToggleSwitchProps {
  /** Whether the switch is on. Controlled. */
  checked: boolean;
  /** Raised with the new value when the reader flips it. */
  onChange: (checked: boolean) => void;
  /** The visible label, to the left of the track. */
  label: ReactNode;
  /** An optional muted line under the label. */
  description?: ReactNode;
  disabled?: boolean;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

export function ToggleSwitch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  className = "",
}: ToggleSwitchProps) {
  const labelId = useId();
  const descriptionId = useId();

  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <span id={labelId} className="block text-sm text-ink">
          {label}
        </span>
        {description && (
          <span id={descriptionId} className="mt-0.5 block text-xs text-muted">
            {description}
          </span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={description ? descriptionId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:opacity-50 motion-reduce:transition-none ${
          checked ? "border-brass bg-brass" : "border-line bg-paper"
        }`}
      >
        <span
          aria-hidden="true"
          className={`inline-block h-4 w-4 rounded-full shadow transition-transform motion-reduce:transition-none ${
            checked ? "translate-x-6 bg-paper" : "translate-x-1 bg-muted"
          }`}
        />
      </button>
    </div>
  );
}
