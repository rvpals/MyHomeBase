"use server";

// Administration → System Log: the web adapters for reading and clearing.
//
// Thin, per ARCHITECTURE.md: authorise, call a `lib` use-case, return its result.
// The behaviour lives in `src/lib/system-log` and is driven identically by
// `npm run cli -- system-log tail` and `npm run cli -- system-log clear`.
//
// WRITING IS NOT HERE, and that is deliberate: a line is written by the code being
// diagnosed, through `deps.systemLogger`, never by a reader pressing a button. There
// is no "add a line" action to expose.

import { revalidatePath } from "next/cache";

import {
  clearSystemLog,
  countSystemLog,
  listSystemLog,
  resolveSystemLogSettings,
  type SystemLogCounts,
  type SystemLogEntry,
  type SystemLogFilterInput,
  type SystemLogKind,
  type SystemLogSettings,
} from "@/lib/system-log";
import { deps } from "@/lib/wiring";
import { requireAdmin } from "../../require-access";

/** Everything the screen draws in one round trip. */
export interface SystemLogView {
  entries: SystemLogEntry[];
  counts: SystemLogCounts;
  settings: SystemLogSettings;
}

function readView(input: SystemLogFilterInput): SystemLogView {
  return {
    entries: listSystemLog(deps.systemLogRepo, input),
    counts: countSystemLog(deps.systemLogRepo),
    // Read alongside the rows so the screen can say "the log is off" rather than
    // leaving an empty table to be read as "nothing happened".
    settings: resolveSystemLogSettings(deps.settingsRepo.listSettings()),
  };
}

export async function loadSystemLogAction(
  input: SystemLogFilterInput = {},
): Promise<SystemLogView> {
  await requireAdmin();
  return readView(input);
}

/**
 * Deletes one kind, or the whole log.
 *
 * Nothing is protected here — unlike the message queue there is no lock, because a
 * log line is not a record anyone curates. If it mattered after the fact it belonged
 * in the message queue instead.
 */
export async function clearSystemLogAction(kind?: SystemLogKind): Promise<SystemLogView> {
  await requireAdmin();
  clearSystemLog(deps.systemLogRepo, { kind });
  revalidatePath("/admin/system-log");
  return readView({});
}
