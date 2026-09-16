import type { CalculationEntry } from "./types";

/**
 * What the history use-cases need from storage.
 *
 * An interface rather than the concrete class, per ARCHITECTURE.md: the use-case
 * receives this, the real implementation is wired in `wiring.ts`, and a test wires in
 * an in-memory fake. That is what lets the tape be tested with no database.
 */
export interface CalculatorHistoryRepository {
  /**
   * Records one calculation and returns it as stored.
   *
   * Pruning to the per-user cap happens here rather than in the use-case, because it is
   * a single `DELETE` the database can express and doing it in JS would mean reading
   * every row back just to decide which to drop.
   */
  record(userId: number, expression: string, result: string): CalculationEntry;
  /** This user's calculations, newest first. */
  list(userId: number, limit: number): CalculationEntry[];
  /** Wipes this user's tape. Deliberately separate from anything AC does. */
  clear(userId: number): void;
}
