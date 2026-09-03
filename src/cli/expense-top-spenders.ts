// Prints the two rollups the Expense dashboard's "Interesting stats" card shows.
// Handy for eyeballing the vendor fuzzy-grouping against the real database.
import { listTransactions, totalsByCategory, vendorSpendTotals } from "@/lib/expense";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

const DEFAULT_LIMIT = 5;

function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function expenseTopSpendersCommand(args: string[]): void {
  const flags = parseFlags(args);
  const limit = flags.limit === undefined ? DEFAULT_LIMIT : Number(flags.limit);

  if (!Number.isInteger(limit) || limit < 1) {
    console.error("--limit must be a positive integer.");
    process.exitCode = 1;
    return;
  }

  console.log(`Top ${limit} by vendor:`);
  // `vendorSpendTotals` so the CLI ranks the same rows the dashboard does —
  // payment and redemption lines derive a fictional vendor from statement prose
  // and are excluded by sign. Reading the rows here keeps that one function call.
  for (const total of vendorSpendTotals(listTransactions(deps.expenseRepo)).slice(0, limit)) {
    const name = total.vendor === "" ? "(unknown)" : total.vendor;
    console.log(
      `  ${formatCents(total.totalCents).padStart(12)}  ${name}` +
        `  (${total.transactionCount} transaction(s)${total.isDerived ? ", name derived" : ""})`,
    );
  }

  console.log(`\nTop ${limit} by category:`);
  for (const total of totalsByCategory(deps.expenseRepo).slice(0, limit)) {
    const name = total.categoryName === "" ? "(uncategorised)" : total.categoryName;
    console.log(
      `  ${formatCents(total.totalCents).padStart(12)}  ${name}  (${total.transactionCount} transaction(s))`,
    );
  }
}
