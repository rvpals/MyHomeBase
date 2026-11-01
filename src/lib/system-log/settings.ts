// The system log's switches, resolved from `sys_app_settings` rows.
//
// Pure. No `deps`, no I/O, no clock — which is what makes every case below testable
// without a database. The half that knows about the composition root is `logger.ts`.
//
// Same split, and the same reasons, as `hello-world/settings.ts` and its runner.

import {
  DEFAULT_SYSTEM_LOG_DEBUG,
  DEFAULT_SYSTEM_LOG_MAX_ROWS,
  DEFAULT_SYSTEM_LOG_OPERATIONAL,
  SYSTEM_LOG_MAX_MAX_ROWS,
  SYSTEM_LOG_MIN_MAX_ROWS,
  SYSTEM_LOG_SETTING_KEYS,
} from "./schema";
import type { SystemLogKind, SystemLogSettings } from "./types";

/**
 * Reads one stored value as a boolean.
 *
 * Accepts both spellings this database contains: `'true'`/`'false'` as
 * `sys_app_settings` uses (migrations/0136, 0168) and `'1'`/`'0'` as the module
 * settings use. A key is read by whichever resolver owns it, so the two conventions
 * never meet — but a hand-edited row should behave rather than silently read as off.
 *
 * Anything unrecognised, including a missing row, is the default. This runs inside a
 * background tick where a throw is invisible, so garbage has to degrade rather than
 * propagate — the same forgiving shape as `resolveTextIndexJobSettings`.
 */
function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalised = value.trim().toLowerCase();
  if (normalised === "true" || normalised === "1" || normalised === "yes") return true;
  if (normalised === "false" || normalised === "0" || normalised === "no") return false;
  return fallback;
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Parses the stored rows into typed values.
 *
 * **Both switches default to off**, so an install that has never configured them —
 * or one whose rows were deleted — writes nothing. That is the safe direction: the
 * failure mode of a wrong default here is a NAS quietly filling with lines nobody
 * asked for.
 */
export function resolveSystemLogSettings(
  rows: { key: string; value: string }[],
): SystemLogSettings {
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  return {
    debugEnabled: readBoolean(
      byKey.get(SYSTEM_LOG_SETTING_KEYS.debugEnabled),
      DEFAULT_SYSTEM_LOG_DEBUG,
    ),
    operationalEnabled: readBoolean(
      byKey.get(SYSTEM_LOG_SETTING_KEYS.operationalEnabled),
      DEFAULT_SYSTEM_LOG_OPERATIONAL,
    ),
    maxRows: clamp(
      Number(byKey.get(SYSTEM_LOG_SETTING_KEYS.maxRows)),
      SYSTEM_LOG_MIN_MAX_ROWS,
      SYSTEM_LOG_MAX_MAX_ROWS,
      DEFAULT_SYSTEM_LOG_MAX_ROWS,
    ),
  };
}

/**
 * Whether one kind is switched on.
 *
 * The two kinds are independent: this is a lookup, not a comparison against a
 * threshold. `debug` being on says nothing about `operational`, which is exactly the
 * relationship migrations/0167 chose over a severity ladder.
 */
export function isKindEnabled(settings: SystemLogSettings, kind: SystemLogKind): boolean {
  return kind === "debug" ? settings.debugEnabled : settings.operationalEnabled;
}

/** Whether anything at all is being written — for the screen's "log is off" notice. */
export function isSystemLogEnabled(settings: SystemLogSettings): boolean {
  return settings.debugEnabled || settings.operationalEnabled;
}

/** "DEBUG and OPERATIONAL are on." — the state as one line, shared by the CLI and the screen. */
export function describeSystemLogState(settings: SystemLogSettings): string {
  const on: string[] = [];
  if (settings.debugEnabled) on.push("DEBUG");
  if (settings.operationalEnabled) on.push("OPERATIONAL");

  if (on.length === 0) return "The system log is off — nothing is being written.";
  if (on.length === 1) return `${on[0]} is on. Keeping ${settings.maxRows.toLocaleString()} lines.`;
  return `${on.join(" and ")} are on. Keeping ${settings.maxRows.toLocaleString()} lines.`;
}

/**
 * Turns a setting value into what the settings table stores.
 *
 * One place, so the screen, the CLI and the defaults list cannot drift on spelling —
 * which matters because `readBoolean` accepts more spellings than anything should
 * write.
 */
export function systemLogBooleanValue(enabled: boolean): string {
  return enabled ? "true" : "false";
}
