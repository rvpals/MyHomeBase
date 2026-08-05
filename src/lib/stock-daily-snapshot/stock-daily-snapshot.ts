import { startOfMonthIso, startOfWeekIso, startOfYearIso, todayIsoLocal } from "@/lib/shared/date";
import type { StockPosition } from "@/lib/stock-positions";
import type { DailySnapshotRepository } from "./ports";
import { snapshotRangeSchema, upsertDailySnapshotSchema } from "./schema";
import type { UpsertDailySnapshotInput } from "./schema";
import type { DailySnapshot, PeriodSummary, SnapshotBucket } from "./types";

/**
 * Which bucket a position counts toward. Stock and ETF are called out because
 * they're the split the dashboard reports; everything else is lumped together so
 * the three buckets always sum to the portfolio.
 */
export function snapshotBucketFor(position: StockPosition): SnapshotBucket {
  if (position.type === "Stock") return "stock";
  if (position.type === "ETF") return "etf";
  return "other";
}

/**
 * Rolls a set of positions into one day's snapshot. Pure — no clock, no I/O; the
 * caller supplies the date.
 *
 * Value is recomputed here as shares × current price rather than read from
 * `valueCents`, so a snapshot can never disagree with the prices it was taken
 * from. Gain/loss is taken from `dayGainLossCents`, which the quote refresh sets
 * to shares × (price − previous close).
 */
export function computeDailySnapshot(
  positions: StockPosition[],
  snapshotDate: string,
): UpsertDailySnapshotInput & { totalValueCents: number; totalGainLossCents: number } {
  const values: Record<SnapshotBucket, number> = { stock: 0, etf: 0, other: 0 };
  const gains: Record<SnapshotBucket, number> = { stock: 0, etf: 0, other: 0 };

  for (const position of positions) {
    const bucket = snapshotBucketFor(position);
    values[bucket] += Math.round(position.currentPriceCents * position.quantity);
    gains[bucket] += position.dayGainLossCents;
  }

  return {
    snapshotDate,
    stockValueCents: values.stock,
    etfValueCents: values.etf,
    otherValueCents: values.other,
    stockGainLossCents: gains.stock,
    etfGainLossCents: gains.etf,
    otherGainLossCents: gains.other,
    positionCount: positions.length,
    totalValueCents: values.stock + values.etf + values.other,
    totalGainLossCents: gains.stock + gains.etf + gains.other,
  };
}

/**
 * A day's move as a percentage of what the portfolio was worth before it moved.
 * The denominator is `total − gain`, not `total`, so a +$5 day on a $105 portfolio
 * reads as +5% rather than +4.76%. Returns 0 when the day started from nothing,
 * rather than Infinity.
 */
export function snapshotChangePct(snapshot: DailySnapshot): number {
  const priorValueCents = snapshot.totalValueCents - snapshot.totalGainLossCents;
  return priorValueCents === 0 ? 0 : (snapshot.totalGainLossCents / priorValueCents) * 100;
}

/**
 * Computes today's snapshot from the given positions and files it under
 * `snapshotDate`, replacing that day's row if one already exists. Pressing the
 * dashboard's Refresh All twice in a day therefore updates rather than duplicates.
 */
export function captureDailySnapshot(
  repo: DailySnapshotRepository,
  positions: StockPosition[],
  snapshotDate: string = todayIsoLocal(),
): DailySnapshot {
  const { totalValueCents, totalGainLossCents, ...input } = computeDailySnapshot(
    positions,
    snapshotDate,
  );
  const validated = upsertDailySnapshotSchema.parse(input);
  return repo.upsertSnapshot(validated, { totalValueCents, totalGainLossCents });
}

export function listSnapshots(
  repo: DailySnapshotRepository,
  range?: { fromDate: string; toDate: string },
): DailySnapshot[] {
  return repo.listSnapshots(range === undefined ? undefined : snapshotRangeSchema.parse(range));
}

export function getSnapshot(
  repo: DailySnapshotRepository,
  snapshotDate: string,
): DailySnapshot | undefined {
  return repo.getSnapshot(snapshotDate);
}

export function deleteSnapshot(repo: DailySnapshotRepository, snapshotDate: string): void {
  repo.deleteSnapshot(snapshotDate);
}

/**
 * Rolls a period's snapshots into one summary. `snapshots` need not be sorted.
 *
 * `gainLossCents` sums each day's move, which is the performance figure: it counts
 * only price changes, so money paid in during the period can't masquerade as a
 * gain. `valueChangeCents` differences the endpoints and *will* include those
 * contributions — both are reported because the gap between them is the money you
 * put in.
 */
export function summarizeSnapshotPeriod(
  snapshots: DailySnapshot[],
  fromDate?: string,
  toDate?: string,
): PeriodSummary {
  const ordered = [...snapshots].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  const first = ordered[0];
  const last = ordered[ordered.length - 1];

  const empty: PeriodSummary = {
    fromDate: fromDate ?? "",
    toDate: toDate ?? "",
    dayCount: 0,
    gainLossCents: 0,
    startValueCents: 0,
    endValueCents: 0,
    valueChangeCents: 0,
    gainLossPct: 0,
    upDays: 0,
    downDays: 0,
  };
  if (ordered.length === 0) return empty;

  const gainLossCents = ordered.reduce((sum, snapshot) => sum + snapshot.totalGainLossCents, 0);
  // The starting value is the first day's value *before* that day moved, so a
  // one-day period still has a meaningful denominator.
  const startValueCents = first.totalValueCents - first.totalGainLossCents;

  const best = ordered.reduce((a, b) => (b.totalGainLossCents > a.totalGainLossCents ? b : a));
  const worst = ordered.reduce((a, b) => (b.totalGainLossCents < a.totalGainLossCents ? b : a));

  return {
    fromDate: fromDate ?? first.snapshotDate,
    toDate: toDate ?? last.snapshotDate,
    dayCount: ordered.length,
    gainLossCents,
    startValueCents,
    endValueCents: last.totalValueCents,
    valueChangeCents: last.totalValueCents - startValueCents,
    gainLossPct: startValueCents === 0 ? 0 : (gainLossCents / startValueCents) * 100,
    upDays: ordered.filter((snapshot) => snapshot.totalGainLossCents > 0).length,
    downDays: ordered.filter((snapshot) => snapshot.totalGainLossCents < 0).length,
    bestDay: { snapshotDate: best.snapshotDate, gainLossCents: best.totalGainLossCents },
    worstDay: { snapshotDate: worst.snapshotDate, gainLossCents: worst.totalGainLossCents },
  };
}

/** Week-, month- and year-to-date rollups as of `asOfDate`, from one read of the year. */
export interface ToDateSummaries {
  week: PeriodSummary;
  month: PeriodSummary;
  year: PeriodSummary;
}

/**
 * The three rollups the dashboard shows. Takes the snapshots rather than the repo
 * so the caller reads once — all three periods are slices of the same year.
 */
export function summarizeToDate(
  yearSnapshots: DailySnapshot[],
  asOfDate: string = todayIsoLocal(),
): ToDateSummaries {
  const since = (fromDate: string) =>
    summarizeSnapshotPeriod(
      yearSnapshots.filter(
        (snapshot) => snapshot.snapshotDate >= fromDate && snapshot.snapshotDate <= asOfDate,
      ),
      fromDate,
      asOfDate,
    );

  return {
    week: since(startOfWeekIso(asOfDate)),
    month: since(startOfMonthIso(asOfDate)),
    year: since(startOfYearIso(asOfDate)),
  };
}
