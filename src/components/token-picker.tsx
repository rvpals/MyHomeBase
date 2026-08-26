"use client";

// A set of chosen names — categories, tags, anything from a known vocabulary
// that a record can hold several of. Two ways in (pick a known name from the
// dropdown, or type a new one) and one way out (click a chip's ×).
//
// Pure presentation: the caller owns the array and the list of known options.
// It never registers a new name itself — a name typed here is just a string in
// `value` until whatever saves the record decides what to do with it.

import { useState } from "react";

export interface TokenPickerProps {
  /** Field label, rendered above the control. */
  label: string;
  /** The chosen names, in the order they'll be saved. */
  value: string[];
  onChange: (next: string[]) => void;
  /** Known names, offered in the dropdown. Already-chosen ones are filtered out. */
  options: string[];
  /**
   * Show the "or type a new one" field. Off by default: a picker over a closed
   * vocabulary shouldn't invite additions to it.
   */
  allowCreate?: boolean;
  /** Placeholder for the create field. Ignored unless `allowCreate`. */
  createPlaceholder?: string;
  /** Hint under the control, e.g. what the names are for. */
  hint?: string;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

const CONTROL_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/**
 * Case-insensitive membership, so picking "Museum" when "museum" is already
 * chosen is a no-op rather than a near-duplicate chip. The stored casing is
 * whatever went in first.
 */
function has(values: string[], candidate: string): boolean {
  const folded = candidate.toLowerCase();
  return values.some((value) => value.toLowerCase() === folded);
}

export function TokenPicker({
  label,
  value,
  onChange,
  options,
  allowCreate = false,
  createPlaceholder = "Add a new one…",
  hint,
  className = "",
}: TokenPickerProps) {
  const [draft, setDraft] = useState("");

  // The dropdown only ever offers what isn't already on the record, so picking
  // from it can't produce a duplicate.
  const available = options.filter((option) => !has(value, option));

  function add(name: string) {
    const trimmed = name.trim();
    if (trimmed === "" || has(value, trimmed)) return;
    onChange([...value, trimmed]);
  }

  function remove(name: string) {
    onChange(value.filter((candidate) => candidate !== name));
  }

  function commitDraft() {
    add(draft);
    setDraft(""); // cleared either way — a duplicate has nothing left to say
  }

  return (
    <div className={`block text-sm ${className}`}>
      <span className="mb-1 block font-medium text-ink">{label}</span>

      {/* Each chosen name is its own box with its own delete, rather than one
          run of delimited text. Wraps on a narrow screen. */}
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded-full bg-brass-soft px-2 py-0.5 font-mono text-xs font-semibold text-brass-dark"
            >
              {name}
              <button
                type="button"
                onClick={() => remove(name)}
                aria-label={`Remove ${name}`}
                title={`Remove ${name}`}
                className="text-brass-dark/60 transition-colors hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Side by side on desktop, stacked on a phone where two half-width
          controls would both be too narrow to read. */}
      <div className="flex gap-2 max-lg:flex-col">
        <select
          // Value is always "" — this is an action, not a held choice. The
          // chosen name becomes a chip and the dropdown returns to its prompt.
          value=""
          onChange={(event) => add(event.target.value)}
          disabled={available.length === 0}
          aria-label={`Add an existing ${label.toLowerCase().replace(/s$/, "")}`}
          className={`${CONTROL_CLASS} flex-1 disabled:opacity-50`}
        >
          <option value="">
            {available.length === 0 ? "Nothing left to add" : "Choose from existing…"}
          </option>
          {available.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        {allowCreate && (
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            // Enter adds the name instead of submitting the surrounding form,
            // which would save a half-filled record.
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              commitDraft();
            }}
            onBlur={commitDraft}
            placeholder={createPlaceholder}
            aria-label={`Add a new ${label.toLowerCase().replace(/s$/, "")}`}
            className={`${CONTROL_CLASS} flex-1`}
          />
        )}
      </div>

      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </div>
  );
}
