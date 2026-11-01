import { z } from "zod";

import { SYSTEM_LOG_KINDS } from "./types";

/**
 * The boundary for the system log. Both adapters — the admin screen's actions and
 * the CLI — parse their raw input through these, so neither can ask for something
 * the other couldn't.
 */

/**
 * How long one line may be.
 *
 * Generous rather than tight: a line is written by code, not typed by a reader, and
 * truncating a diagnostic at the moment it matters would defeat the feature. The cap
 * exists so a runaway caller cannot put a megabyte in one cell.
 */
export const SYSTEM_LOG_MESSAGE_MAX = 2000;

/** How long the second half may be. A stack trace is the thing being sized for. */
export const SYSTEM_LOG_DETAIL_MAX = 8000;

/** How long a source label may be. It is a code location, not prose. */
export const SYSTEM_LOG_SOURCE_MAX = 120;

export const systemLogKindSchema = z.enum(["debug", "operational"]);

/**
 * What a writer supplies.
 *
 * `createdAt` is deliberately absent: the database stamps every row
 * (migrations/0167), so accepting one here would let a caller file a line dated last
 * year — and a log whose times cannot be trusted is worse than no log.
 *
 * Over-long values are **truncated, not rejected**. A logging call must never throw:
 * it is written inside the code being diagnosed, often inside a `catch`, and a
 * logger that can fail turns a small bug into a crash. Losing the tail of one line
 * is the right trade.
 */
export const writeSystemLogSchema = z.object({
  kind: systemLogKindSchema,
  source: z
    .string()
    .trim()
    .default("")
    .transform((value) => value.slice(0, SYSTEM_LOG_SOURCE_MAX)),
  message: z
    .string()
    .trim()
    .min(1, "A log line needs a message.")
    .transform((value) => value.slice(0, SYSTEM_LOG_MESSAGE_MAX)),
  detail: z
    .string()
    .default("")
    .transform((value) => value.slice(0, SYSTEM_LOG_DETAIL_MAX)),
});

/** What a caller supplies — the input shape, so `source` and `detail` may be omitted. */
export type WriteSystemLogInput = z.input<typeof writeSystemLogSchema>;

/** The validated shape, after defaults and truncation. What the repository is handed. */
export type WriteSystemLog = z.output<typeof writeSystemLogSchema>;

/**
 * How many lines one read returns.
 *
 * 200 by default: enough to see a whole indexing pass, few enough that the grid
 * renders instantly on a phone. The ceiling is what stops a hand-typed CLI argument
 * pulling the entire table into memory.
 */
export const DEFAULT_SYSTEM_LOG_LIMIT = 200;
export const MAX_SYSTEM_LOG_LIMIT = 5000;

export const systemLogFilterSchema = z.object({
  // Absent means both kinds — "no constraint", which is distinct from a kind that
  // happens to have no rows.
  kind: systemLogKindSchema.optional(),
  search: z.string().trim().default(""),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_SYSTEM_LOG_LIMIT)
    .default(DEFAULT_SYSTEM_LOG_LIMIT),
});

export type SystemLogFilterInput = z.input<typeof systemLogFilterSchema>;

/**
 * Clearing the log.
 *
 * `kind` absent means every line. Explicit rather than defaulted to one kind,
 * because "clear" with a filter on screen is ambiguous and the action should say
 * which it means rather than infer it.
 */
export const clearSystemLogSchema = z.object({
  kind: systemLogKindSchema.optional(),
});

export type ClearSystemLogInput = z.input<typeof clearSystemLogSchema>;

/** The keys in `sys_app_settings`. Spelled once — renaming one orphans stored state. */
export const SYSTEM_LOG_SETTING_KEYS = {
  debugEnabled: "system_log_debug",
  operationalEnabled: "system_log_operational",
  maxRows: "system_log_max_rows",
} as const;

/** The rows this feature reads, for a caller assembling a settings screen. */
export const SYSTEM_LOG_SETTING_KEY_LIST = [
  SYSTEM_LOG_SETTING_KEYS.debugEnabled,
  SYSTEM_LOG_SETTING_KEYS.operationalEnabled,
  SYSTEM_LOG_SETTING_KEYS.maxRows,
] as const;

/** Both switches off — what an install that has never configured them gets. */
export const DEFAULT_SYSTEM_LOG_DEBUG = false;
export const DEFAULT_SYSTEM_LOG_OPERATIONAL = false;

/**
 * How many lines the log keeps by default.
 *
 * 5,000 is roughly two days of the Hello, world! job at its default one-minute
 * cadence (~2,880 operational lines a day), or one long debugging session over a
 * document library. Large enough to hold the thing you are looking at, small enough
 * that the table stays trivial against a database already past 100 MB.
 */
export const DEFAULT_SYSTEM_LOG_MAX_ROWS = 5000;

const MIN_MAX_ROWS = 100;
const MAX_MAX_ROWS = 200000;

/** Guards the cap when it is edited. Bounds, not validation of stored state. */
export const systemLogMaxRowsSchema = z.coerce
  .number()
  .int()
  .min(MIN_MAX_ROWS)
  .max(MAX_MAX_ROWS);

export { MIN_MAX_ROWS as SYSTEM_LOG_MIN_MAX_ROWS, MAX_MAX_ROWS as SYSTEM_LOG_MAX_MAX_ROWS };

/** Both kinds, re-exported so a caller need not reach into `./types` for the list. */
export { SYSTEM_LOG_KINDS };
