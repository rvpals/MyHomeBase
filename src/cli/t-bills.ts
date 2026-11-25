import { formatCents } from "@/lib/shared/money";
import {
  createPurchase,
  deletePurchase,
  listPurchases,
  summarizePurchases,
  updatePurchase,
} from "@/lib/treasury-bills";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

/**
 * The T-Bill section from the terminal — the same use-cases the web app calls.
 *
 *   t-bills                                     list every purchase, newest first
 *   t-bills --stats                             the T-Bill Stats card's figures
 *   t-bills --chart                             total gain over time, by payout date
 *   t-bills --add 912797LS4 --purchased 2026-01-05 --payout 2026-04-05
 *           --shares 100 --price 98.75 [--spent 9875.00] [--payout-amount 10000.00]
 *           [--description "…"]
 *   t-bills --edit 3 --price 98.80              change one field of a purchase
 *   t-bills --delete 3,4
 *
 * `--spent` defaults to shares × price, exactly as the web form auto-fills it;
 * `--payout-amount` defaults to shares × 100, a bill's face value. Both can be given
 * explicitly when the broker's settled figures differ.
 *
 * The price is per $100 of face value. Every rule — a required symbol, a price at or
 * below par, a payout no earlier than the purchase — lives in the module's zod
 * schema, so this refuses exactly what the web form refuses.
 */
export async function tbillsCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  try {
    if (flags.delete) {
      const ids = String(flags.delete)
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((id) => Number.isInteger(id) && id > 0);
      if (ids.length === 0) {
        console.error("Usage: t-bills --delete <id>[,<id>…]");
        process.exitCode = 1;
        return;
      }
      for (const id of ids) deletePurchase(deps.tbillRepo, id);
      console.log(`Deleted ${ids.length} T-Bill ${ids.length === 1 ? "purchase" : "purchases"}.`);
      return;
    }

    if (flags.add) {
      const shares = Number(flags.shares ?? 0) || 0;
      const price = Number(flags.price ?? 0) || 0;
      const created = createPurchase(deps.tbillRepo, {
        symbol: String(flags.add),
        description: flags.description ? String(flags.description) : "",
        datePurchased: String(flags.purchased ?? ""),
        datePayout: String(flags.payout ?? ""),
        sharesPurchased: shares,
        purchasePrice: price,
        // The same defaults the web form fills in, so a purchase recorded either
        // way comes out identical.
        amountSpentCents:
          flags.spent !== undefined
            ? Math.round(Number(flags.spent) * 100)
            : Math.round(shares * price * 100),
        payoutAmountCents:
          flags["payout-amount"] !== undefined
            ? Math.round(Number(flags["payout-amount"]) * 100)
            : Math.round(shares * 100 * 100),
      });
      console.log(
        `Added #${created.id} ${created.symbol}: spent ${formatCents(created.amountSpentCents)}, ` +
          `pays ${formatCents(created.payoutAmountCents)} on ${created.datePayout} ` +
          `(${created.daysToMaturity} days, yield ${
            created.yieldPct === undefined ? "—" : `${created.yieldPct.toFixed(3)}%`
          }).`,
      );
      return;
    }

    if (flags.edit) {
      const id = Number(flags.edit);
      const existing = listPurchases(deps.tbillRepo).find((row) => row.id === id);
      if (!existing) {
        console.error(`No T-Bill purchase with id ${id}.`);
        process.exitCode = 1;
        return;
      }
      // Only the flags given change; everything else keeps its stored value, so a
      // one-field edit does not need the whole record retyped.
      const updated = updatePurchase(deps.tbillRepo, id, {
        symbol: flags.symbol ? String(flags.symbol) : existing.symbol,
        description: flags.description ? String(flags.description) : existing.description,
        datePurchased: flags.purchased ? String(flags.purchased) : existing.datePurchased,
        datePayout: flags.payout ? String(flags.payout) : existing.datePayout,
        sharesPurchased:
          flags.shares !== undefined ? Number(flags.shares) : existing.sharesPurchased,
        purchasePrice: flags.price !== undefined ? Number(flags.price) : existing.purchasePrice,
        amountSpentCents:
          flags.spent !== undefined
            ? Math.round(Number(flags.spent) * 100)
            : existing.amountSpentCents,
        payoutAmountCents:
          flags["payout-amount"] !== undefined
            ? Math.round(Number(flags["payout-amount"]) * 100)
            : existing.payoutAmountCents,
      });
      console.log(
        `Updated #${updated.id} ${updated.symbol}: gain ${formatCents(updated.gainAmountCents)}, ` +
          `yield ${updated.yieldPct === undefined ? "—" : `${updated.yieldPct.toFixed(3)}%`}.`,
      );
      return;
    }

    if ("chart" in flags) {
      const { gainOverTime } = summarizePurchases(deps.tbillRepo);
      if (gainOverTime.length === 0) {
        console.log("No T-Bill purchases recorded.");
        return;
      }
      console.log("Total gain over time (by payout date):");
      for (const point of gainOverTime) {
        console.log(
          `  ${point.date}  ${formatCents(point.cumulativeGainCents).padStart(14)}  ` +
            `(${point.maturedCount} matured)`,
        );
      }
      return;
    }

    if ("stats" in flags) {
      const stats = summarizePurchases(deps.tbillRepo);
      const pct = (value: number | undefined, digits = 2) =>
        value === undefined ? "—" : `${value.toFixed(digits)}%`;
      console.log(`Purchases:               ${stats.purchaseCount}`);
      console.log(`Total Cash Invested:     ${formatCents(stats.totalInvestedCents)}`);
      console.log(`Total Cash Gained:       ${formatCents(stats.totalGainedCents)}`);
      console.log(`Total Return:            ${pct(stats.totalReturnPct)}`);
      console.log(`Total Average Yield:     ${pct(stats.averageYieldPct, 3)}`);
      console.log(
        `Total Average Gain:      ${
          stats.averageGainCents === undefined
            ? "—"
            : formatCents(Math.round(stats.averageGainCents))
        }`,
      );
      return;
    }

    const purchases = listPurchases(deps.tbillRepo);
    if (purchases.length === 0) {
      console.log("No T-Bill purchases recorded.");
      return;
    }
    for (const row of purchases) {
      console.log(
        `#${row.id}  ${row.symbol.padEnd(12)} ${row.datePurchased} -> ${row.datePayout}  ` +
          `${String(row.daysToMaturity).padStart(4)}d  ` +
          `spent ${formatCents(row.amountSpentCents).padStart(14)}  ` +
          `gain ${formatCents(row.gainAmountCents).padStart(12)}  ` +
          `yield ${(row.yieldPct === undefined ? "—" : `${row.yieldPct.toFixed(3)}%`).padStart(8)}`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed to run the T-Bill command.");
    process.exitCode = 1;
  }
}
