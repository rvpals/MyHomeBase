import Link from "next/link";
import type { CategoryTotal, ExpenseCategory } from "@/lib/expense";
import { expenseSectionHref } from "./expense-sections";
import { CategoryIconThumbnail, categoryIconUrlsByName, formatCents } from "./expense-shared";

/** One headline number. Highlighted when it represents outstanding work. */
function Tile({
  label,
  value,
  needsAttention = false,
  href,
}: {
  label: string;
  value: string;
  needsAttention?: boolean;
  href?: string;
}) {
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`font-display text-xl ${needsAttention ? "text-brass" : "text-ink"}`}>{value}</p>
    </>
  );

  // Counters that represent work link to the screen where you'd deal with it.
  return href ? (
    <Link
      href={href}
      className="rounded-xl border border-line p-4 transition-colors hover:border-brass/50"
    >
      {body}
    </Link>
  ) : (
    <div className="rounded-xl border border-line p-4">{body}</div>
  );
}

export function ExpenseDashboardView({
  totalCents,
  transactionCount,
  unprocessedCount,
  uncategorisedCount,
  toReconcileCount,
  topCategories,
  categories,
}: {
  totalCents: number;
  transactionCount: number;
  unprocessedCount: number;
  uncategorisedCount: number;
  toReconcileCount: number;
  topCategories: CategoryTotal[];
  /** Only for their icons — a rollup carries a category name, not its icon. */
  categories: ExpenseCategory[];
}) {
  const categoryIconUrls = categoryIconUrlsByName(categories);

  return (
    <div className="flex flex-col gap-8">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Total" value={formatCents(totalCents)} />
        <Tile
          label="To processed"
          value={String(unprocessedCount)}
          needsAttention={unprocessedCount > 0}
          href={expenseSectionHref("import")}
        />
        <Tile
          label="Uncategorised"
          value={String(uncategorisedCount)}
          needsAttention={uncategorisedCount > 0}
          href={expenseSectionHref("transactions")}
        />
        <Tile label="To reconcile" value={String(toReconcileCount)} />
      </section>

      <section>
        <h2 className="font-display text-xl text-ink">Top categories</h2>
        {topCategories.length === 0 ? (
          <p className="mt-1 text-sm text-muted">
            Nothing to show yet — {transactionCount === 0 ? "add or import some transactions" : "categorise a few transactions"} to see a breakdown.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted">
              The five biggest, out of {transactionCount} transaction(s).{" "}
              <Link href={expenseSectionHref("charts")} className="text-brass-dark hover:underline">
                See all
              </Link>
              .
            </p>
            <ul className="mt-3 flex flex-col gap-1">
              {topCategories.map((total) => (
                <li
                  key={total.categoryName || "uncategorised"}
                  className="flex items-center justify-between rounded-md border border-line bg-paper px-3 py-1.5 text-sm"
                >
                  <span className="flex items-center gap-2 text-ink">
                    {total.categoryName === "" ? (
                      <span className="text-muted">uncategorised</span>
                    ) : (
                      <>
                        <CategoryIconThumbnail iconUrl={categoryIconUrls.get(total.categoryName)} />
                        {total.categoryName}
                      </>
                    )}
                    <span className="text-xs text-muted">
                      {total.transactionCount} transaction(s)
                    </span>
                  </span>
                  <span className="font-mono text-ink">{formatCents(total.totalCents)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
