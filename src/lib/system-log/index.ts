// The system log's public surface. Import from here, never from a file inside.
//
// ## Which channel am I looking for?
//
//   `@/lib/messages`        a notice FOR A READER — it lights the header's unread
//                           badge and waits to be dismissed. Use this when a person
//                           must act on something.
//   `@/lib/scheduled-jobs`  one record PER PASS of a background job: when it ran and
//                           how it went. Written by the run repository itself.
//   `@/lib/system-log`      what the code was DOING. Two switches, both off by
//                           default, neither reaching the reader. Here.
//
// ## Writing a line
//
// Take a `SystemLogger` — from `deps.systemLogger` in a runner, or injected as a
// port in a use-case — and call it:
//
// ```ts
// log.operational("scheduled-jobs", `Job "${label}" triggered.`);
//
// if (log.enabled("debug")) {
//   log.debug("documents/text-index", `Indexed "${name}" — ${words} words in ${ms}ms.`);
// }
// ```
//
// Both are no-ops when their switch is off, and `message` may be a thunk that is
// never called in that case. The `enabled` guard is only needed to skip work done
// BEFORE the call.

export type {
  SystemLogCounts,
  SystemLogEntry,
  SystemLogFilter,
  SystemLogKind,
  SystemLogSettings,
} from "./types";
export { SYSTEM_LOG_KINDS } from "./types";
export type { SystemLogRepository, SystemLogger } from "./ports";
export {
  DEFAULT_SYSTEM_LOG_DEBUG,
  DEFAULT_SYSTEM_LOG_LIMIT,
  DEFAULT_SYSTEM_LOG_MAX_ROWS,
  DEFAULT_SYSTEM_LOG_OPERATIONAL,
  MAX_SYSTEM_LOG_LIMIT,
  SYSTEM_LOG_DETAIL_MAX,
  SYSTEM_LOG_MAX_MAX_ROWS,
  SYSTEM_LOG_MESSAGE_MAX,
  SYSTEM_LOG_MIN_MAX_ROWS,
  SYSTEM_LOG_SETTING_KEYS,
  SYSTEM_LOG_SETTING_KEY_LIST,
  SYSTEM_LOG_SOURCE_MAX,
  clearSystemLogSchema,
  systemLogFilterSchema,
  systemLogKindSchema,
  systemLogMaxRowsSchema,
  writeSystemLogSchema,
  type ClearSystemLogInput,
  type SystemLogFilterInput,
  type WriteSystemLog,
  type WriteSystemLogInput,
} from "./schema";
export {
  describeSystemLogState,
  isKindEnabled,
  isSystemLogEnabled,
  resolveSystemLogSettings,
  systemLogBooleanValue,
} from "./settings";
export { SETTINGS_CACHE_MS, createSystemLogger, noopSystemLogger } from "./logger";
export type { SystemLoggerDeps } from "./logger";
export { SqliteSystemLogRepository } from "./repository";
export { FakeSystemLogRepository, FakeSystemLogger } from "./fakes";
export {
  clearSystemLog,
  countSystemLog,
  describeSystemLogCounts,
  describeSystemLogKind,
  listSystemLog,
} from "./system-log";
