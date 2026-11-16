"use client";

// The Journal's half of "what did we spend around this date?".
//
// `DayExpensesDialog` is a registered shared component and may not fetch, so the
// server-action call lives here — and here rather than in each screen, because
// both Journal callers (the entry viewer and the calendar's day panel) need
// exactly the same three lines of state. The dialog itself stays pure.
//
// Route-local on purpose: it is the adapter between two modules' presentation
// layers, which is not a thing to register in `components.md`.

import { useEffect, useState } from "react";
import { DayExpensesDialog } from "@/components/day-expenses-dialog";
import type { ExpensesOnDateView } from "@/lib/expense";
import { expensesOnDateAction } from "./expense-actions";
import { expenseDateHref } from "./expense-sections";

export interface JournalDayExpensesProps {
  /** The day the reader asked about, "YYYY-MM-DD". */
  date: string;
  /** Fired by Escape, the overlay, the ✕ and the Close button. */
  onClose: () => void;
}

/** What came back, tagged with the day it was asked for. */
type Loaded = { date: string; view?: ExpensesOnDateView; error?: string };

export function JournalDayExpenses({ date, onClose }: JournalDayExpensesProps) {
  // One piece of state carrying the answer *and* which day it answers.
  //
  // Not three (`view` / `error` / `isLoading`): resetting those at the top of
  // the effect is a synchronous setState in an effect body, which cascades a
  // render and which the React compiler's lint rejects. Tagging the result with
  // its date says the same thing without writing state to say it — "loading"
  // becomes "nothing here answers the day being shown", which is derived below.
  const [loaded, setLoaded] = useState<Loaded | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    // The default window (±1 day) applies — no `days` argument — so a journal
    // entry catches the purchase that reached the statement a day late. The
    // "Open in Expense" link below leaves `days` off for the same reason: both
    // sides take the module's own default, and neither hard-codes a number that
    // could drift from it.
    void expensesOnDateAction(date).then((result) => {
      // The dialog may have been dismissed while this was in flight.
      if (cancelled) return;
      setLoaded(
        result.ok && result.view
          ? { date, view: result.view }
          : { date, error: result.error ?? "Could not read the expenses for that date." },
      );
    });

    return () => {
      cancelled = true;
    };
  }, [date]);

  // A result for a *different* day counts as not loaded: if the date ever
  // changes under this component, the previous day's figures must not sit under
  // the new day's heading even for one frame.
  const answer = loaded?.date === date ? loaded : undefined;

  return (
    <DayExpensesDialog
      date={date}
      view={answer?.view}
      isLoading={answer === undefined}
      error={answer?.error}
      openInExpenseHref={expenseDateHref(date)}
      onClose={onClose}
    />
  );
}
