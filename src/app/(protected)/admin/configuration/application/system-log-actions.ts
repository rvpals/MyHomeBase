"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "../../../require-access";
import { deps } from "@/lib/wiring";
import {
  SYSTEM_LOG_SETTING_KEYS,
  resolveSystemLogSettings,
  systemLogBooleanValue,
  systemLogMaxRowsSchema,
} from "@/lib/system-log";
import type { SystemLogSettings } from "@/lib/system-log";

// The two system-log switches and the row cap, on Application Configuration.
//
// Their own action rather than the admin shell's Save button, unlike the upload and
// cull caps beside them. Those edit a MODULE settings draft the shell already holds;
// these are rows in `sys_app_settings`, which the shell models as named fields
// (`applicationName`, `colorThemeId`, …) rather than as an open key/value draft.
// Adding two more named fields to that context to carry a pair of booleans would
// widen a shared type for one screen, so the control writes its own row instead.
//
// A switch that takes effect on click also suits what this is: turning DEBUG on is
// something you do in order to watch the next thing that happens, and having to
// remember a Save button afterwards is exactly how you end up with a log that is
// still off while you stare at it.

/** Reads the three rows, for the control's initial state. */
export async function loadSystemLogSettingsAction(): Promise<SystemLogSettings> {
  await requireAdmin();
  return resolveSystemLogSettings(deps.settingsRepo.listSettings());
}

/**
 * Turns one switch on or off.
 *
 * `setValue` rather than `updateAll`: the shared update schema requires a non-empty
 * value and is what the Application Configuration screen posts, so writing a single
 * key through it would mean loosening a schema that protects every other setting.
 * Same split, and the same reason, as `STARTUP_MESSAGE`'s blankable write.
 */
export async function setSystemLogSwitchAction(
  kind: "debug" | "operational",
  enabled: boolean,
): Promise<SystemLogSettings> {
  await requireAdmin();

  const key =
    kind === "debug"
      ? SYSTEM_LOG_SETTING_KEYS.debugEnabled
      : SYSTEM_LOG_SETTING_KEYS.operationalEnabled;
  deps.settingsRepo.setValue(key, systemLogBooleanValue(enabled));

  // The log screen reads these to say whether anything is being written.
  revalidatePath("/admin/system-messages");
  return resolveSystemLogSettings(deps.settingsRepo.listSettings());
}

/** Sets how many lines the log keeps. Bounds come from the module's schema. */
export async function setSystemLogMaxRowsAction(value: number): Promise<SystemLogSettings> {
  await requireAdmin();

  const maxRows = systemLogMaxRowsSchema.parse(value);
  deps.settingsRepo.setValue(SYSTEM_LOG_SETTING_KEYS.maxRows, String(maxRows));

  revalidatePath("/admin/system-messages");
  return resolveSystemLogSettings(deps.settingsRepo.listSettings());
}
