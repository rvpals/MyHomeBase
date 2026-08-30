"use client";

// A segmented control for "same data, shown a different way".
//
// Deliberately not `Tabs`. Tabs put *different content* in one space, and their
// panels read as separate places; this switch says the thing on screen is one
// dataset being re-cut, which is a different promise to the reader. Use `Tabs`
// when the panels hold unrelated things (as expense-accounts-view does for cards
// / categories / vendors) and this when every option answers the same question
// about the same rows.
//
// Narrow screens get a real `<select>` rather than a squeezed row of buttons: at
// five options the segments would either wrap into a ragged block or scroll
// sideways, and a native picker is both smaller and easier to hit. That is the
// `max-lg:` boundary from design.md, done as two elements with one visible at a
// time — no `useIsCompact()`, so the desktop classes can't regress.

export interface ViewModeOption<K extends string> {
  key: K;
  label: string;
  /** Native tooltip and the select option's title. Optional. */
  hint?: string;
}

export interface ViewModeSwitchProps<K extends string> {
  /** The options, in the order they should read. */
  options: readonly ViewModeOption<K>[];
  /** The currently selected key. */
  value: K;
  onChange: (key: K) => void;
  /**
   * Label shown before the control, e.g. "View". Also the accessible name of the
   * group and of the compact `<select>`.
   */
  label: string;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

const SELECT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export function ViewModeSwitch<K extends string>({
  options,
  value,
  onChange,
  label,
  className = "",
}: ViewModeSwitchProps<K>) {
  return (
    <div className={className}>
      {/* Wide: the segmented row. Hidden below the 1024px boundary. */}
      <div className="flex items-center gap-2 max-lg:hidden">
        <span className="text-sm font-medium text-muted">{label}</span>
        {/*
          A radiogroup, not a tablist: nothing here is a panel, and one of a set
          of mutually exclusive choices is exactly what a radio is. Each segment
          carries aria-checked so a screen reader reads the state, which the
          visual fill alone doesn't convey.
        */}
        <div
          role="radiogroup"
          aria-label={label}
          className="inline-flex overflow-hidden rounded-md border border-line"
        >
          {options.map((option) => {
            const isActive = option.key === value;
            return (
              <button
                key={option.key}
                type="button"
                role="radio"
                aria-checked={isActive}
                title={option.hint}
                onClick={() => onChange(option.key)}
                // The divider is a left border on every segment but the first,
                // so segments never double up a 2px line between them.
                className={`border-line px-3 py-1.5 text-sm font-medium transition-colors first:border-l-0 [&:not(:first-child)]:border-l focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brass motion-reduce:transition-none ${
                  isActive
                    ? "bg-brass-soft text-brass-dark"
                    : "bg-paper text-muted hover:bg-brass-soft/50 hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Narrow: a native picker, full width so it's thumb-sized. */}
      <label className="block text-sm lg:hidden">
        <span className="mb-1 block font-medium text-muted">{label}</span>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value as K)}
          className={SELECT_CLASS}
        >
          {options.map((option) => (
            <option key={option.key} value={option.key} title={option.hint}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
