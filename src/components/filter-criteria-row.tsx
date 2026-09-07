"use client";

// One line of a filter builder: pick a column, pick an operator, type the value(s),
// remove the row. The number of value inputs follows the operator — "is empty" needs
// none, "between" needs two, "is one of" takes a comma-separated list — which is the
// part that makes this worth having as a component rather than three inlined selects.
//
// Pure presentation: props in, events out. It holds no state and validates nothing;
// the caller owns the criteria array and the library decides whether a definition is
// saveable (see src/lib/csv-analytics/view-query.ts).

import { type ReactNode } from "react";

/** How many values the chosen operator takes. Mirrors `CsvViewOperatorArity` in lib. */
export type FilterCriteriaArity = "none" | "one" | "two" | "list";

export interface FilterCriteriaColumnOption {
  /** The value written back through `onChange`. */
  value: string;
  /** What the user reads — usually the original CSV header. */
  label: string;
}

export interface FilterCriteriaOperatorOption {
  value: string;
  /** Short symbol or phrase, e.g. ">=", "contains", "is empty". */
  label: string;
  /** Decides how many value inputs render for this operator. */
  arity: FilterCriteriaArity;
}

export interface FilterCriteriaRowProps {
  columns: FilterCriteriaColumnOption[];
  operators: FilterCriteriaOperatorOption[];
  /** The chosen column's value. `""` renders the placeholder option. */
  column: string;
  /** The chosen operator's value. */
  operator: string;
  /**
   * The typed values, positionally. A one-value operator reads `values[0]`, `between`
   * reads both, and a list operator reads `values[0]` as comma-separated text.
   */
  values: string[];
  onColumnChange: (column: string) => void;
  /**
   * Raised when the operator changes. The caller usually trims or pads `values` to the
   * new arity — this component doesn't, because dropping what someone typed is a
   * domain decision, not a rendering one.
   */
  onOperatorChange: (operator: string) => void;
  /** Raised with the whole values array, already updated at `index`. */
  onValuesChange: (values: string[]) => void;
  onRemove: () => void;
  /** Hides the remove button, e.g. while a save is in flight. */
  disabled?: boolean;
  /** Shown in place of the value inputs' placeholder when the operator takes a list. */
  listHint?: string;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

const CONTROL_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/** A labelled cell. The label is visually hidden on wide screens — the header row
 *  above the list carries it there — and shown when the row stacks below 1024px,
 *  where there is no header to align against. */
function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 hidden text-xs font-medium text-muted max-lg:block">{label}</span>
      {children}
    </label>
  );
}

export function FilterCriteriaRow({
  columns,
  operators,
  column,
  operator,
  values,
  onColumnChange,
  onOperatorChange,
  onValuesChange,
  onRemove,
  disabled = false,
  listHint = "Comma-separated",
  className = "",
}: FilterCriteriaRowProps) {
  const arity = operators.find((option) => option.value === operator)?.arity ?? "one";

  function setValueAt(index: number, value: string) {
    const next = [...values];
    while (next.length <= index) next.push("");
    next[index] = value;
    onValuesChange(next);
  }

  return (
    // Four columns wide; one stacked column below 1024px, where 304px of chrome
    // leaves no room for a four-up row. `max-lg:` only, so the desktop grid can't regress.
    <div
      className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto] items-end gap-2 max-lg:grid-cols-1 max-lg:gap-3 max-lg:rounded-md max-lg:border max-lg:border-line max-lg:bg-paper-raised max-lg:p-3 ${className}`}
    >
      <Cell label="Column">
        <select
          value={column}
          onChange={(event) => onColumnChange(event.target.value)}
          className={CONTROL_CLASS}
          aria-label="Column"
        >
          <option value="">Pick a column…</option>
          {columns.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Cell>

      <Cell label="Operator">
        <select
          value={operator}
          onChange={(event) => onOperatorChange(event.target.value)}
          className={CONTROL_CLASS}
          aria-label="Operator"
        >
          {operators.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Cell>

      <Cell label="Value">
        {arity === "none" ? (
          // No input at all rather than a disabled one: "is empty" takes no value, and
          // a greyed-out box invites someone to try to type in it.
          <p className="px-1 py-1.5 text-xs text-muted">No value needed</p>
        ) : arity === "two" ? (
          <div className="flex items-center gap-2">
            <input
              value={values[0] ?? ""}
              onChange={(event) => setValueAt(0, event.target.value)}
              placeholder="From"
              className={CONTROL_CLASS}
              aria-label="From"
            />
            <span className="text-xs text-muted">and</span>
            <input
              value={values[1] ?? ""}
              onChange={(event) => setValueAt(1, event.target.value)}
              placeholder="To"
              className={CONTROL_CLASS}
              aria-label="To"
            />
          </div>
        ) : (
          <input
            value={values[0] ?? ""}
            onChange={(event) => setValueAt(0, event.target.value)}
            placeholder={arity === "list" ? listHint : "Value"}
            className={CONTROL_CLASS}
            aria-label="Value"
          />
        )}
      </Cell>

      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        title="Remove this criterion"
        aria-label="Remove this criterion"
        className="rounded-md border border-line px-2 py-1.5 text-sm text-muted hover:border-red-400 hover:text-red-400 disabled:opacity-50 max-lg:w-full"
      >
        <span aria-hidden="true">✕</span>
        <span className="ml-1 hidden max-lg:inline">Remove</span>
      </button>
    </div>
  );
}
