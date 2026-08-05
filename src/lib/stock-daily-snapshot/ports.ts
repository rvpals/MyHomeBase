import type { UpsertDailySnapshotInput } from "./schema";
import type { DailySnapshot } from "./types";

export interface DailySnapshotRepository {
  /** Every snapshot in the inclusive range, oldest first. Omit the range for all of them. */
  listSnapshots(range?: { fromDate: string; toDate: string }): DailySnapshot[];
  getSnapshot(snapshotDate: string): DailySnapshot | undefined;
  /**
   * Inserts, or overwrites the row already filed under that date. Totals are
   * computed by the use-case and passed in — the repository derives nothing.
   */
  upsertSnapshot(
    input: UpsertDailySnapshotInput,
    totals: { totalValueCents: number; totalGainLossCents: number },
  ): DailySnapshot;
  deleteSnapshot(snapshotDate: string): void;
}
