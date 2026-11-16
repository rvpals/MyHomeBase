"use client";

// "What did we spend around this date?" as a dialog.
//
// Three callers, which is why it lives here rather than beside one of them: the
// Journal's entry viewer, the Journal's calendar day panel, and the Expense
// module's own Transactions screen when it arrives with ?date= set.
//
// Pure presentation. It takes a finished `ExpensesOnDateView` — rows already
// flattened, card names already resolved, total already summed, all by
// `buildExpensesOnDateView` in `@/lib/expense` — and renders it. It does not
// fetch: the Journal callers run a server action and hand the result down, and
// the Expense screen builds the view from rows it already holds. That split is
// what lets the same dialog serve a module its callers have no other business
// importing from.

import { Modal } from "@/components/modal";
import { Button } from "@/components/button";
import { formatCents } from "@/lib/shared/money";
import type { ExpensesOnDateView } from "@/lib/expense";

export interface DayExpensesDialogProps {
  /**
   * The date the reader asked about, as "YYYY-MM-DD". Separate from
   * `view.window.date` because the heading has to be right *before* the rows
   * arrive — during the load there is no view yet, and a dialog that opens with
   * a blank title reads as broken rather than busy.
   */
  date: string;
  /** The finished view model. Undefined while loading, or after a failure. */
  view?: ExpensesOnDateView;
  /** True while the caller's fetch is in flight. */
  isLoading?: boolean;
  /** A message to show instead of the rows. Takes precedence over `view`. */
  error?: string;
  /**
   * Link to the Expense module's own screen for this window — build it with
   * `expenseDateHref` rather than by hand. Omit it and the footer link is not
   * drawn, which is what the Expense screen itself passes: it is already there.
   */
  openInExpenseHref?: string;
  /** Fired by Escape, the overlay, the ✕ and the Close button. */
  onClose: () => void;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

/** "2026-11-15" -> "Sun 15 Nov". Undefined-safe: a bad date renders as itself. */
function shortDateLabel(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const [, year, month, day] = match;
  // Local midnight, not `new Date(iso)` — that parses as UTC and prints the
  // previous day's name for anyone west of Greenwich.
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
}

/**
 * The sub-heading: which days are actually covered, and that no card is excluded.
 *
 * A window wider than the asked-for day has to say so. Without this line a reader
 * sees three dates in a dialog they opened from one, and the obvious reading is
 * that the list is wrong.
 */
function describeWindow(view: ExpensesOnDateView): string {
  // `dateWindow`, not `window` — this is a client component, and shadowing the
  // global here is a trap for whoever edits the function next.
  const dateWindow = view.window;
  const span =
    dateWindow.days === 0
      ? shortDateLabel(dateWindow.date)
      : `${shortDateLabel(dateWindow.from)} – ${shortDateLabel(dateWindow.to)}`;
  const count =
    view.rows.length === 1 ? "1 transaction" : `${view.rows.length} transactions`;
  return `${span} · ${count} · all cards`;
}

export function DayExpensesDialog({
  date,
  view,
  isLoading = false,
  error,
  openInExpenseHref,
  onClose,
  className = "",
}: DayExpensesDialogProps) {
  return (
    <Modal
      title={`Expenses around ${shortDateLabel(date)}`}
      description={view && !error ? describeWindow(view) : undefined}
      size="lg"
      onClose={onClose}
      className={className}
      footer={
        <>
          {openInExpenseHref && (
            <Button variant="secondary" size="sm" href={openInExpenseHref}>
              Open in Expense
            </Button>
          )}
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : isLoading || !view ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : view.rows.length === 0 ? (
        <p className="text-sm text-muted">Nothing was spent on these dates.</p>
      ) : (
        <>
          {/* One row per transaction. A list, not a `DataGrid`: nothing here is
              sortable, selectable or editable — the Expense module's own screen
              is where a reader does any of that, and the footer links to it. */}
          <ul className="flex flex-col divide-y divide-line border-y border-line">
            {view.rows.map((row, index) => (
              <li
                key={row.id}
                // Zebra striping with `--paper`, the sibling of the dialog's own
                // surface in every theme — tinting with `--paper-raised` over a
                // raised panel composites to the panel colour and stripes nothing.
                className={`flex items-baseline gap-3 px-2 py-2 max-lg:flex-wrap ${
                  index % 2 === 1 ? "bg-paper" : ""
                }`}
              >
                <span className="w-20 shrink-0 font-mono text-xs text-muted">
                  {shortDateLabel(row.date)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col max-lg:w-full max-lg:basis-full">
                  <span className="truncate text-sm text-ink">{row.vendor}</span>
                  {/* The card and the category under the name rather than in
                      columns of their own: at 390px four columns collapse into
                      an unreadable stack, and neither is the thing being
                      scanned for. */}
                  <span className="truncate text-xs text-muted">
                    {[row.accountName, row.categoryName === "" ? "uncategorised" : row.categoryName]
                      .filter((part) => part !== "")
                      .join(" · ")}
                  </span>
                </span>
                <span
                  className={`shrink-0 font-mono text-sm tabular-nums ${
                    row.amountCents < 0 ? "text-brass-dark" : "text-ink"
                  }`}
                >
                  {formatCents(row.amountCents)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-baseline justify-between gap-3 px-2">
            <span className="text-sm font-semibold text-ink">Total</span>
            <span className="font-mono text-sm font-semibold tabular-nums text-ink">
              {formatCents(view.totalCents)}
            </span>
          </div>
          {/* Said once, at the bottom, rather than per row: a negative figure in
              a list of charges is a refund, and the sign alone doesn't say so. */}
          <p className="mt-1 px-2 text-xs text-muted">
            Charges count up, refunds and payments count down.
          </p>
        </>
      )}
    </Modal>
  );
}
