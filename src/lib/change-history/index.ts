// Public surface. Deliberately free of `node:fs` — the About view is a
// `"use client"` module and imports these types, so anything Node-only here
// would follow the barrel into the browser bundle. The concrete
// FileChangeHistoryRepository is wired in wiring.ts instead.

export type {
  ChangeCounts,
  ChangeHistory,
  ChangeHistorySummary,
  ChangeKind,
  ReleaseSummary,
  TaggedLine,
} from "./types";
export { CHANGE_KINDS } from "./types";
export type { ChangeHistoryRepository } from "./ports";
export { getChangeHistory, readChangeTag, summarizeChangeHistory } from "./change-history";
