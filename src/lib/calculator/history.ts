import { calculate } from "./calculator";
import type { CalculatorHistoryRepository } from "./ports";
import {
  HISTORY_LIMIT,
  angleModeSchema,
  calculationWriteSchema,
  expressionSchema,
} from "./schema";
import type { AngleMode, CalculationEntry } from "./types";

/**
 * Records one calculation on the tape.
 *
 * Validated here rather than trusting the caller: this is reachable from a server
 * action, so `expression` and `result` are boundary input however plausible the only
 * current caller looks.
 */
export function recordCalculation(
  repo: CalculatorHistoryRepository,
  userId: number,
  input: { expression: string; result: string },
): CalculationEntry {
  const validated = calculationWriteSchema.parse(input);
  return repo.record(userId, validated.expression, validated.result);
}

/**
 * One user's tape, newest first.
 *
 * `limit` defaults to the storage cap, so "all of it" is the ordinary call and the
 * window doesn't have to know a number.
 */
export function listCalculations(
  repo: CalculatorHistoryRepository,
  userId: number,
  limit: number = HISTORY_LIMIT,
): CalculationEntry[] {
  // Clamped rather than trusted: a hand-rolled request asking for a million rows should
  // get the cap, not a million rows.
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 1, 1), HISTORY_LIMIT);
  return repo.list(userId, safeLimit);
}

/** Wipes one user's tape. Only ever called from an explicit "Clear history" control. */
export function clearCalculations(repo: CalculatorHistoryRepository, userId: number): void {
  repo.clear(userId);
}

/**
 * Evaluates an expression *and* records it — the one use-case the server action and the
 * CLI both drive, so a calculation made in a terminal lands on the same tape as one
 * made in the window.
 *
 * A failed expression is **not** recorded. The tape is a record of results; a syntax
 * error has none, and filling the history with mistypes would push real answers off
 * the end of a 50-row cap.
 */
export function calculateAndRecord(
  repo: CalculatorHistoryRepository,
  userId: number,
  input: { expression: string; angleMode?: AngleMode },
): { ok: true; result: string; entry: CalculationEntry } | { ok: false; message: string } {
  const expression = expressionSchema.parse(input.expression);
  const angleMode = angleModeSchema.parse(input.angleMode ?? "deg");

  const outcome = calculate(expression, angleMode);
  if (!outcome.ok) return outcome;

  return {
    ok: true,
    result: outcome.result,
    entry: repo.record(userId, expression, outcome.result),
  };
}
