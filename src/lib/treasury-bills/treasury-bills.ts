import { parseIsoDateLocal } from "@/lib/shared/date";
import type { TBillRepository } from "./ports";
import { createTBillPurchaseSchema, updateTBillPurchaseSchema } from "./schema";
import type { CreateTBillPurchaseInput, UpdateTBillPurchaseInput } from "./schema";
import type { TBillGainPoint, TBillPurchase, TBillPurchaseView, TBillStats } from "./types";

/** A year, for annualising the discount yield. 365 by convention, not 365.25. */
const DAYS_IN_YEAR = 365;

/**
 * Whole calendar days from one ISO date to another.
 *
 * Built on `Date.UTC`, not on the local-midnight `Date`s `parseIsoDateLocal`
 * returns, because a day is not always 86,400,000ms: across a DST boundary the
 * local difference is 23 or 25 hours and a naive division rounds to the wrong day
 * count. UTC has no such boundary, so the subtraction is exact. `parseIsoDateLocal`
 * is still used first — for its validation, which rejects 2026-02-31.
 *
 * A one-off here rather than in `shared/date`: nothing else needs it yet. Promote it
 * on the second caller.
 */
export function daysBetweenIso(fromIsoDate: string, toIsoDate: string): number {
  const from = parseIsoDateLocal(fromIsoDate);
  const to = parseIsoDateLocal(toIsoDate);
  const fromUtc = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const toUtc = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

/**
 * Attaches the four derived figures to one stored purchase.
 *
 * Pure: it takes a row and returns a row. Nothing here is a column — see the
 * migration log for why they are recomputed on every read instead.
 *
 * Both percentages come back `undefined` rather than 0 when there is nothing to
 * divide by. A zero would be indistinguishable from a real zero return, which is
 * the same call the Tax Lots XIRR makes.
 */
export function describePurchase(purchase: TBillPurchase): TBillPurchaseView {
  const gainAmountCents = purchase.payoutAmountCents - purchase.amountSpentCents;
  const daysToMaturity = daysBetweenIso(purchase.datePurchased, purchase.datePayout);

  const gainPct =
    purchase.amountSpentCents > 0
      ? (gainAmountCents / purchase.amountSpentCents) * 100
      : undefined;

  // (100 - price) / price * 100 * 365 / days, with the two divisors guarded. A
  // same-day maturity is not an error — it is a bill with no term to annualise over.
  const yieldPct =
    daysToMaturity > 0 && purchase.purchasePrice > 0
      ? ((100 - purchase.purchasePrice) / purchase.purchasePrice) *
        100 *
        (DAYS_IN_YEAR / daysToMaturity)
      : undefined;

  return { ...purchase, gainAmountCents, gainPct, daysToMaturity, yieldPct };
}

/**
 * The running total of realised gain, by payout date.
 *
 * **The axis is the payout date, not the purchase date.** A bill's gain arrives when
 * it matures, so plotting it against the day it was bought would credit the money
 * months before it existed and make the line climb ahead of the account.
 *
 * Bills maturing on the same date collapse into one point: two lines at the same x
 * would overplot, and the question the chart answers ("how much had I made by then")
 * has one answer per date.
 */
export function buildGainOverTime(purchases: readonly TBillPurchaseView[]): TBillGainPoint[] {
  const gainByDate = new Map<string, { gainCents: number; count: number }>();
  for (const purchase of purchases) {
    const existing = gainByDate.get(purchase.datePayout) ?? { gainCents: 0, count: 0 };
    existing.gainCents += purchase.gainAmountCents;
    existing.count += 1;
    gainByDate.set(purchase.datePayout, existing);
  }

  let cumulativeGainCents = 0;
  let maturedCount = 0;
  return [...gainByDate.entries()]
    // ISO dates sort correctly as strings.
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { gainCents, count }]) => {
      cumulativeGainCents += gainCents;
      maturedCount += count;
      return { date, cumulativeGainCents, maturedCount };
    });
}

/**
 * Everything the T-Bill Stats card shows, including the chart series.
 *
 * Both averages are **plain, unweighted means** of their column, as specified: a
 * $500 bill counts the same as a $50,000 one. The average yield is taken over the
 * rows that *have* a yield, not over all rows — dividing by a count that includes
 * rows contributing nothing would drag the mean toward zero and misreport it.
 */
export function computeStats(purchases: readonly TBillPurchaseView[]): TBillStats {
  const totalInvestedCents = purchases.reduce((sum, row) => sum + row.amountSpentCents, 0);
  const totalGainedCents = purchases.reduce((sum, row) => sum + row.gainAmountCents, 0);

  const yields = purchases
    .map((row) => row.yieldPct)
    .filter((value): value is number => value !== undefined);

  return {
    purchaseCount: purchases.length,
    totalInvestedCents,
    totalGainedCents,
    totalReturnPct:
      totalInvestedCents > 0 ? (totalGainedCents / totalInvestedCents) * 100 : undefined,
    averageYieldPct:
      yields.length > 0 ? yields.reduce((sum, value) => sum + value, 0) / yields.length : undefined,
    averageGainCents:
      purchases.length > 0 ? totalGainedCents / purchases.length : undefined,
    gainOverTime: buildGainOverTime(purchases),
  };
}

/** Every purchase, newest first, each with its derived figures. */
export function listPurchases(repo: TBillRepository): TBillPurchaseView[] {
  return repo.listPurchases().map(describePurchase);
}

export function getPurchaseById(
  repo: TBillRepository,
  id: number,
): TBillPurchaseView | undefined {
  const purchase = repo.getPurchaseById(id);
  return purchase ? describePurchase(purchase) : undefined;
}

export function createPurchase(
  repo: TBillRepository,
  input: CreateTBillPurchaseInput,
): TBillPurchaseView {
  const validated = createTBillPurchaseSchema.parse(input);
  return describePurchase(repo.createPurchase(validated));
}

export function updatePurchase(
  repo: TBillRepository,
  id: number,
  input: UpdateTBillPurchaseInput,
): TBillPurchaseView {
  const validated = updateTBillPurchaseSchema.parse(input);
  // Checked here rather than left to the UPDATE's zero-row result, so the web form
  // and the CLI both get a sentence instead of a silent no-op.
  if (!repo.getPurchaseById(id)) throw new Error(`No T-Bill purchase with id ${id}.`);
  return describePurchase(repo.updatePurchase(id, validated));
}

export function deletePurchase(repo: TBillRepository, id: number): void {
  if (!repo.getPurchaseById(id)) throw new Error(`No T-Bill purchase with id ${id}.`);
  repo.deletePurchase(id);
}

/** The stats card's figures, read straight from the repository. */
export function summarizePurchases(repo: TBillRepository): TBillStats {
  return computeStats(listPurchases(repo));
}
