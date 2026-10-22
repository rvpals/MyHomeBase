import type { ModuleSetting } from "../module-settings";
import { DEFAULT_CULL_IMAGES, MAX_CULL_CEILING, MIN_CULL_IMAGES } from "./config";

// The culling ceiling as a stored setting, so the limit can be corrected without a
// deploy.
//
// Stored on the PICTURE GALLERY module, as key/value rows in sys_module_settings --
// the same mechanism the Tools upload cap and the journal preferences use. No new
// table and no migration: a scalar preference is exactly what this mechanism is for.
//
// Hung on `picture-gallery` rather than being a true app-wide row because that is
// where the large sets live, and because it matches the proven `tools_max_upload_bytes`
// control it sits beside on the Application configuration page. The Journal's photo
// dialog reads the same value -- one ceiling for one operation, wherever it is invoked
// from -- so a reader who raises it in one place has raised it everywhere.

/** The module these settings belong to. */
export const CULLING_MODULE_SLUG = "picture-gallery";

export const CULLING_SETTING_KEYS = {
  maxCullImages: "culling_max_images",
} as const;

export interface CullingSettings {
  /**
   * The most photographs one culling pass will decode.
   *
   * Always a usable number -- a missing, blank, unparseable or out-of-range row
   * resolves to the default rather than to `undefined`, because every caller needs
   * *some* ceiling and "no limit" is not a safe reading of a broken row.
   */
  maxCullImages: number;
}

/**
 * Parses the module's settings rows into typed values.
 *
 * Deliberately forgiving, per the rule in `modules.md`: a settings row can outlive the
 * thing it names and can be edited by hand in the admin's generic key/value editor, so
 * garbage must fall back rather than throw. A screen that 500s because someone typed
 * "lots" into a number box would be worse than one that quietly uses the default.
 *
 * Out-of-range values are CLAMPED rather than rejected, for the same reason: a
 * hand-edited row of `999999` should behave as the ceiling, not disable culling
 * entirely or hand the archive an unbounded decode.
 *
 * @param settings The module's stored rows.
 * @returns A usable ceiling, whatever the rows contain.
 */
export function resolveCullingSettings(settings: ModuleSetting[]): CullingSettings {
  const byKey = new Map(settings.map((setting) => [setting.key, setting.value]));

  const raw = Number(byKey.get(CULLING_SETTING_KEYS.maxCullImages));
  if (!Number.isFinite(raw) || raw <= 0) {
    return { maxCullImages: DEFAULT_CULL_IMAGES };
  }

  return {
    maxCullImages: Math.min(MAX_CULL_CEILING, Math.max(MIN_CULL_IMAGES, Math.floor(raw))),
  };
}

/**
 * The settings as key/value rows, ready to persist.
 *
 * @param settings The values to store.
 * @returns One row per setting.
 */
export function cullingSettingsToEntries(
  settings: CullingSettings,
): { key: string; value: string }[] {
  return [
    {
      key: CULLING_SETTING_KEYS.maxCullImages,
      value: String(settings.maxCullImages),
    },
  ];
}
