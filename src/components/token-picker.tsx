"use client";

// A set of chosen names — categories, tags, anything from a known vocabulary
// that a record can hold several of. One combobox in (type to filter the known
// names, pick one, or create the name you typed) and one way out (click a
// chip's ×).
//
// Pure presentation: the caller owns the array and the list of known options.
// It never registers a new name itself — a name typed here is just a string in
// `value` until whatever saves the record decides what to do with it.

import { useEffect, useId, useRef, useState } from "react";

export interface TokenPickerProps {
  /** Field label, rendered above the control. */
  label: string;
  /** The chosen names, in the order they'll be saved. */
  value: string[];
  onChange: (next: string[]) => void;
  /** Known names, offered in the list. Already-chosen ones are filtered out. */
  options: string[];
  /**
   * Offer a `+ Create "…"` row when what's typed matches no known name. Off by
   * default: a picker over a closed vocabulary shouldn't invite additions to it.
   */
  allowCreate?: boolean;
  /** Placeholder for the combobox. */
  createPlaceholder?: string;
  /** Hint under the control, e.g. what the names are for. */
  hint?: string;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

const CONTROL_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/**
 * Case-insensitive membership, so picking "Museum" when "museum" is already
 * chosen is a no-op rather than a near-duplicate chip. The stored casing is
 * whatever went in first.
 */
function has(values: string[], candidate: string): boolean {
  const folded = candidate.toLowerCase();
  return values.some((value) => value.toLowerCase() === folded);
}

/** A row in the popup: either a known name to pick, or the create action. */
type Row = { kind: "option"; name: string } | { kind: "create"; name: string };

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
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  // The list only ever offers what isn't already on the record, so picking from
  // it can't produce a duplicate.
  const available = options.filter((option) => !has(value, option));
  const trimmed = draft.trim();
  const filtered =
    trimmed === ""
      ? available
      : available.filter((option) => option.toLowerCase().includes(trimmed.toLowerCase()));

  // The create row appears only for a name that is genuinely new — not one
  // that's merely filtered out of the list because it's already a chip, which
  // would offer to "create" a name the record already holds.
  const isNewName =
    allowCreate && trimmed !== "" && !has(options, trimmed) && !has(value, trimmed);

  const rows: Row[] = [
    ...(isNewName ? [{ kind: "create" as const, name: trimmed }] : []),
    ...filtered.map((name) => ({ kind: "option" as const, name })),
  ];

  function close() {
    setIsOpen(false);
    // Blur and Escape discard the draft rather than committing it: tabbing out
    // of a half-typed filter shouldn't mint a tag called "Mus".
    setDraft("");
  }

  function add(name: string) {
    const candidate = name.trim();
    if (candidate === "" || has(value, candidate)) return;
    onChange([...value, candidate]);
  }

  /** Take a row, then clear the field so the next name can be typed straight in. */
  function commit(row: Row) {
    add(row.name);
    setDraft("");
    setHighlightedIndex(0);
    // Deliberately stays open: these fields get three or four names in a row.
  }

  // Clicking anywhere else closes the list. Registered only while open so a page
  // full of these doesn't keep a listener each.
  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (!containerRef.current?.contains(event.target as Node)) close();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [isOpen]);

  const singular = label.toLowerCase().replace(/s$/, "");

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
                onClick={() => onChange(value.filter((candidate) => candidate !== name))}
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

      {/* One full-width control at every width — the filter and the "or make a
          new one" field are the same box, so there's no pair to squeeze. */}
      <div ref={containerRef} className="relative">
        <input
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-autocomplete="list"
          autoComplete="off"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setIsOpen(true);
            setHighlightedIndex(0);
          }}
          onFocus={() => setIsOpen(true)}
          onClick={() => setIsOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              if (!isOpen) {
                setIsOpen(true);
                setHighlightedIndex(0);
                return;
              }
              setHighlightedIndex((current) => Math.min(current + 1, rows.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setHighlightedIndex((current) => Math.max(current - 1, 0));
            } else if (event.key === "Enter") {
              const row = rows[highlightedIndex];
              // Always swallowed: Enter here picks a name, and must never submit
              // the surrounding form and save a half-filled record.
              event.preventDefault();
              if (isOpen && row) commit(row);
            } else if (event.key === "Escape" || event.key === "Tab") {
              close();
            }
          }}
          // Blur, not click-away, is what discards a half-typed draft — but it
          // must ignore focus moving *inside* this control (onto a row), or the
          // list would unmount before the click landed. Click-away is handled by
          // the pointer-down effect above, which also catches a click that never
          // moves focus.
          onBlur={(event) => {
            if (containerRef.current?.contains(event.relatedTarget as Node | null)) return;
            close();
          }}
          placeholder={createPlaceholder}
          aria-label={allowCreate ? `Add or create a ${singular}` : `Add a ${singular}`}
          className={CONTROL_CLASS}
        />

        {isOpen && (
          <ul
            id={listboxId}
            role="listbox"
            aria-label={label}
            className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-md border border-line bg-paper-raised py-1 shadow-[0_6px_16px_rgba(0,0,0,0.35)]"
          >
            {rows.length === 0 ? (
              <li className="px-3 py-1.5 text-sm text-muted">
                {available.length === 0 && trimmed === ""
                  ? "Nothing left to add."
                  : allowCreate
                    ? "Already added."
                    : "No match."}
              </li>
            ) : (
              rows.map((row, index) => {
                const isHighlighted = index === highlightedIndex;
                return (
                  <li key={`${row.kind}-${row.name}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isHighlighted}
                      // Keeps focus in the input so the field doesn't flicker
                      // closed before the click lands.
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      onClick={() => commit(row)}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                        isHighlighted ? "bg-brass-soft text-brass-dark" : "text-ink"
                      }`}
                    >
                      {row.kind === "create" ? (
                        <>
                          <span aria-hidden="true" className="text-muted">
                            +
                          </span>
                          <span>
                            Create <span className="font-mono font-semibold">{row.name}</span>
                          </span>
                        </>
                      ) : (
                        <span className="font-mono">{row.name}</span>
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        )}
      </div>

      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </div>
  );
}
