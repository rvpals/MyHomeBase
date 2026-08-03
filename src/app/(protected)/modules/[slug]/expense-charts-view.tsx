"use client";

import { ChartBar } from "@/components/chart-bar";
import type { CategoryTotal } from "@/lib/expense";
import { formatCents } from "./expense-shared";

const UNCATEGORISED_LABEL = "uncategorised";

export function ExpenseChartsView({ totals }: { totals: CategoryTotal[] }) {
  if (totals.length === 0) {
    return (
      <p className="text-sm text-muted">
        Nothing to chart yet — add or import some transactions, then categorise them.
      </p>
    );
  }

  // Refunds make a category's total negative, which a bar chart can't express
  // meaningfully alongside spend, so only positive totals are charted. The table
  // below still shows everything.
  const spendItems = totals
    .filter((total) => total.totalCents > 0)
    .map((total) => ({
      key: total.categoryName || UNCATEGORISED_LABEL,
      label: total.categoryName || UNCATEGORISED_LABEL,
      value: total.totalCents / 100,
    }));

  const netCents = totals.reduce((sum, total) => sum + total.totalCents, 0);
  const transactionCount = totals.reduce((sum, total) => sum + total.transactionCount, 0);

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="font-display text-xl text-ink">Spend by category</h2>
        <p className="mt-1 text-sm text-muted">
          {transactionCount} transaction(s), {formatCents(netCents)} net.
          {spendItems.length < totals.length && " Categories in credit are listed below but not charted."}
        </p>
        {spendItems.length > 0 ? (
          <div className="mt-3">
            <ChartBar items={spendItems} formatValue={(value) => `$${value.toFixed(2)}`} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">No positive spend to chart.</p>
        )}
      </section>

      <section>
        <h2 className="font-display text-xl text-ink">Totals</h2>
        <ul className="mt-3 flex flex-col gap-1">
          {totals.map((total) => (
            <li
              key={total.categoryName || UNCATEGORISED_LABEL}
              className="flex items-center justify-between rounded-md border border-line bg-paper px-3 py-1.5 text-sm"
            >
              <span className="text-ink">
                {total.categoryName === "" ? (
                  <span className="text-muted">{UNCATEGORISED_LABEL}</span>
                ) : (
                  total.categoryName
                )}
                <span className="ml-2 text-xs text-muted">
                  {total.transactionCount} transaction(s)
                </span>
              </span>
              <span
                className={`font-mono ${total.totalCents < 0 ? "text-emerald-400" : "text-ink"}`}
              >
                {formatCents(total.totalCents)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
