"use client";

// A dropdown whose options can carry a small image, which a native <select> or
// <datalist> can't do — that's the whole reason this exists. Props in, events out:
// the caller supplies the options (label + optional icon URL) and owns the value.

import { useEffect, useId, useRef, useState } from "react";
import { TaxonomyIcon } from "@/components/taxonomy-icon";

export interface IconSelectOption {
  /** The value written back through `onChange`. */
  value: string;
  /** What the user reads. */
  label: string;
  /**
   * URL of the option's icon. Omit for options that have none — the row still
   * indents so labels stay aligned with the ones that do.
   */
  iconUrl?: string;
}

export interface IconSelectProps {
  options: IconSelectOption[];
  /** The current value. Match it against `options` to show the icon and label. */
  value: string;
  onChange: (value: string) => void;
  /**
   * When true (the default) the field is a real text input: typing filters the
   * list *and* commits what you type, so a value that isn't in `options` is
   * allowed. Set false to make it a strict picker — typing only filters.
   */
  allowFreeText?: boolean;
  /**
   * Offer a trailing `+ Create "…"` row when what's typed matches no option.
   * Off by default, and ignored unless `allowFreeText` — a strict picker has
   * nothing to create. It only makes the existing behaviour visible: free text
   * already commits as you type, so this row says so rather than adding power.
   *
   * The word for what gets made, e.g. "category". Whether anything is actually
   * persisted is the caller's business — this component only raises the value.
   */
  createLabel?: string;
  /**
   * When set, adds a first row that clears the value to `""` — e.g.
   * "— uncategorised —". Omit it when empty isn't a meaningful choice.
   */
  clearLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Set when a <label> points at this field with `htmlFor`. */
  id?: string;
  /** Use instead of `id` when there's no visible label. */
  ariaLabel?: string;
  /** Merged last onto the input, so the caller wins (e.g. a width). */
  className?: string;
}

/** A row in the list: either an option to pick, or the create action. */
type Row = IconSelectOption & { isCreate?: boolean };

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/** One option's icon, or a same-size spacer so every label lines up. */
function OptionIcon({ iconUrl, label }: { iconUrl?: string; label: string }) {
  return <TaxonomyIcon url={iconUrl} name={label} fallback="spacer" />;
}

export function IconSelect({
  options,
  value,
  onChange,
  allowFreeText = true,
  createLabel,
  clearLabel,
  placeholder,
  disabled = false,
  id,
  ariaLabel,
  className = "",
}: IconSelectProps) {
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  // undefined means "not typing" — the field then shows the selected label.
  const [query, setQuery] = useState<string | undefined>(undefined);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const selected = options.find((option) => option.value === value);
  const filtered =
    query === undefined || query === ""
      ? options
      : options.filter((option) => option.label.toLowerCase().includes(query.toLowerCase()));

  // The create row appears only for text that is genuinely new: non-empty, and
  // matching no option's label. Compared case-insensitively against the *whole*
  // option list rather than `filtered`, so a name that differs only in case
  // can't be offered as a creation and quietly make a near-duplicate.
  const typed = (query ?? "").trim();
  const isNewName =
    createLabel !== undefined &&
    allowFreeText &&
    typed !== "" &&
    !options.some((option) => option.label.toLowerCase() === typed.toLowerCase());

  // With a clear row present it's index 0 and the options shift down by one, so
  // rows are addressed through one list rather than two sets of index maths.
  // The create row, when shown, is always last.
  const rows: Row[] =
    clearLabel === undefined ? [...filtered] : [{ value: "", label: clearLabel }, ...filtered];
  if (isNewName) rows.push({ value: typed, label: typed, isCreate: true });

  const displayText = query ?? (selected?.label ?? value);

  function close() {
    setIsOpen(false);
    setQuery(undefined);
  }

  function open() {
    if (disabled) return;
    setIsOpen(true);
    // Start the highlight on the current value so Enter re-picks it, not row 1.
    const current = rows.findIndex((row) => row.value === value);
    setHighlightedIndex(current >= 0 ? current : 0);
  }

  function commit(option: Row) {
    onChange(option.value);
    close();
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

  return (
    <div ref={containerRef} className="relative">
      {selected?.iconUrl && (
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2">
          <OptionIcon iconUrl={selected.iconUrl} label={selected.label} />
        </span>
      )}
      <input
        id={id}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        value={displayText}
        placeholder={placeholder}
        // Read-only rather than a <button> in strict mode: it keeps the same
        // focus ring, keyboard handling and layout as the free-text mode.
        readOnly={!allowFreeText}
        onChange={(event) => {
          if (!allowFreeText) return;
          const text = event.target.value;
          setQuery(text);
          onChange(text);
          setIsOpen(true);
          // Skip the clear row when there's something typed: Enter on a freshly
          // typed name must keep that name, not blank the field. With nothing
          // typed every row is a real option, so row 0 is the right landing spot.
          setHighlightedIndex(clearLabel !== undefined && text.trim() !== "" ? 1 : 0);
        }}
        onFocus={open}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!isOpen) {
              open();
              return;
            }
            setHighlightedIndex((current) => Math.min(current + 1, rows.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlightedIndex((current) => Math.max(current - 1, 0));
          } else if (event.key === "Enter") {
            const row = rows[highlightedIndex];
            if (isOpen && row) {
              // Enter picks the highlighted row instead of submitting the form.
              event.preventDefault();
              commit(row);
            } else {
              close();
            }
          } else if (event.key === "Escape") {
            close();
          } else if (event.key === "Tab") {
            close();
          }
        }}
        className={`${INPUT_CLASS} ${selected?.iconUrl ? "pl-9" : ""} ${className}`}
      />

      {isOpen && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-md border border-line bg-paper-raised py-1 shadow-[0_6px_16px_rgba(0,0,0,0.35)]"
        >
          {rows.length === 0 ? (
            <li className="px-3 py-1.5 text-sm text-muted">
              {allowFreeText ? "No match — keep typing to use this name." : "No match."}
            </li>
          ) : (
            rows.map((row, index) => {
              const isHighlighted = index === highlightedIndex;
              const isSelected = row.value === value;
              return (
                <li key={`${row.isCreate ? "create" : "option"}-${row.value}-${index}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    // Keeps focus in the input so the field doesn't flicker closed
                    // before the click lands.
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => commit(row)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                      isHighlighted ? "bg-brass-soft text-brass-dark" : "text-ink"
                    }`}
                  >
                    {row.isCreate ? (
                      <>
                        <span aria-hidden="true" className="text-muted">
                          +
                        </span>
                        <span>
                          Create {createLabel}{" "}
                          <span className="font-semibold">&ldquo;{row.label}&rdquo;</span>
                        </span>
                      </>
                    ) : (
                      <>
                        <OptionIcon iconUrl={row.iconUrl} label={row.label} />
                        <span className={row.value === "" ? "text-muted" : ""}>{row.label}</span>
                      </>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
