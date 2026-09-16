import { z } from "zod";

/**
 * The boundary for evaluating an expression — the server action and the CLI both parse
 * with this, so the terminal and the window accept exactly the same input
 * (ARCHITECTURE.md: one use-case, two adapters).
 *
 * The length cap is the real work here. An expression is user input that reaches a
 * parser, and while the evaluator cannot execute anything, a pathological input like
 * 5,000 nested parentheses is still pointless work. 500 characters is far past any
 * genuine sum and well short of anything that costs measurable time.
 */
export const expressionSchema = z
  .string()
  .trim()
  .min(1, "There's nothing to calculate.")
  .max(500, "That expression is too long.");

/** The angle mode, as stored and as sent. */
export const angleModeSchema = z.enum(["deg", "rad"]).catch("deg");

/**
 * One history row on the way in.
 *
 * `result` is the *formatted* string, not a number, because the tape records what the
 * reader saw — see `CalculationEntry`. Both fields are capped so a corrupted client
 * cannot write an unbounded row.
 */
export const calculationWriteSchema = z.object({
  expression: expressionSchema,
  result: z.string().trim().min(1).max(100),
});

export type CalculationWrite = z.infer<typeof calculationWriteSchema>;

/**
 * How many calculations are kept per user.
 *
 * A cap, not a preference. The calculator is a floating component people leave open, so
 * an uncapped tape would grow without bound from ordinary use; 50 is comfortably more
 * than anyone scrolls back through and keeps the table trivial. Enforced by the
 * repository on every insert rather than by a scheduled job, so it cannot drift.
 */
export const HISTORY_LIMIT = 50;
