import type { ModuleSetting } from "@/lib/module-settings";
import { DEFAULT_MAX_UPLOAD_BYTES, MAX_UPLOAD_CEILING_BYTES } from "./schema";

/** The module these settings belong to. */
export const TOOLS_MODULE_SLUG = "tools";

// Module settings for Tools, stored as key/value rows in sys_module_settings —
// the same mechanism the Attendance defaults and the journal preferences use.
// No new table: a scalar preference is what this mechanism is for.

export const TOOLS_SETTING_KEYS = {
  maxUploadBytes: "tools_max_upload_bytes",
} as const;

export interface ToolsSettings {
  /**
   * The SQLite File Browser's upload cap, in bytes.
   *
   * Always a usable number — a missing, blank, unparseable or out-of-range row
   * resolves to the default rather than to `undefined`, because every caller
   * needs *some* limit and "no cap" is not a safe reading of a broken row.
   */
  maxUploadBytes: number;
}

/**
 * Parses the module's settings rows into typed values.
 *
 * Deliberately forgiving, per the rule in `modules.md`: a settings row can
 * outlive the thing it names and can be edited by hand in the admin's generic
 * key/value editor, so garbage must fall back rather than throw. A screen that
 * 500s because someone typed "lots" into a number box would be worse than one
 * that quietly uses the default.
 *
 * Out-of-range values are clamped rather than rejected for the same reason:
 * a hand-edited row of `999999999999` should behave as the ceiling, not break
 * uploading entirely.
 */
export function resolveToolsSettings(settings: ModuleSetting[]): ToolsSettings {
  const byKey = new Map(settings.map((setting) => [setting.key, setting.value]));

  const raw = Number(byKey.get(TOOLS_SETTING_KEYS.maxUploadBytes));
  if (!Number.isFinite(raw) || raw <= 0) {
    return { maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES };
  }

  return {
    maxUploadBytes: Math.min(Math.floor(raw), MAX_UPLOAD_CEILING_BYTES),
  };
}

/**
 * The settings as key/value rows, ready to persist.
 *
 * The value is stored in **bytes**, not megabytes: it is what every consumer
 * actually compares against, so converting on read would put the same
 * arithmetic in the schema, the route and the CLI. The admin control does the
 * MB ↔ bytes conversion once, at the edge where a person types.
 */
export function toolsSettingsToEntries(settings: ToolsSettings): { key: string; value: string }[] {
  return [
    {
      key: TOOLS_SETTING_KEYS.maxUploadBytes,
      value: String(settings.maxUploadBytes),
    },
  ];
}
