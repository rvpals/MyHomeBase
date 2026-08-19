import type { ModuleSetting } from "@/lib/module-settings";
import {
  DEFAULT_SCAN_EXTENSIONS,
  isMusicExtension,
  type MusicExtension,
} from "./formats";

// Module settings for the Music Library, stored as key/value rows in
// sys_module_settings — the same mechanism Attendance, Expense auto-import and the
// journal preferences use. No new table.

export const MUSIC_SETTING_KEYS = {
  scanExtensions: "music_scan_extensions",
  skipUnstreamable: "music_skip_unstreamable",
} as const;

export interface MusicSettings {
  /**
   * The extensions a scan will catalog. Anything else is ignored **before the file
   * is opened**, which is what makes a narrow allowlist genuinely faster: reading
   * tags is the expensive part, and over SMB it dominates the scan.
   *
   * Never empty — an empty allowlist would make every scan a silent no-op, which
   * looks identical to a broken scanner. `resolveMusicSettings` falls back to the
   * default instead.
   */
  scanExtensions: MusicExtension[];
  /**
   * Whether to skip files a browser cannot play (ape, wma) even when their
   * extension is in the allowlist.
   *
   * Separate from the allowlist because the two answer different questions: the
   * allowlist is "which formats do I care about", this is "do I want rows I can
   * never play". Someone cataloguing their whole collection for reference wants
   * them; someone building a playable library does not.
   */
  skipUnstreamable: boolean;
}

/**
 * Parses the module's settings rows into typed values.
 *
 * Unknown or misspelled extensions are dropped rather than throwing: the stored
 * value can outlive a change to MUSIC_FORMATS, and a stale entry must not break
 * the scan screen.
 */
export function resolveMusicSettings(settings: ModuleSetting[]): MusicSettings {
  const byKey = new Map(settings.map((setting) => [setting.key, setting.value]));

  const stored = (byKey.get(MUSIC_SETTING_KEYS.scanExtensions) ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => isMusicExtension(entry));

  // Deduplicate: the UI cannot produce a repeat, but a hand-edited row can, and a
  // duplicated extension would double-count in the scan summary.
  const scanExtensions = [...new Set(stored)];

  // Missing means on — the overwhelmingly common want is a library you can play,
  // so a fresh install should land there without anyone configuring it.
  const rawSkip = byKey.get(MUSIC_SETTING_KEYS.skipUnstreamable);
  const skipUnstreamable = rawSkip === undefined ? true : rawSkip.trim().toLowerCase() === "true";

  return {
    scanExtensions: scanExtensions.length > 0 ? scanExtensions : [...DEFAULT_SCAN_EXTENSIONS],
    skipUnstreamable,
  };
}

/**
 * The settings as key/value rows, ready to persist.
 *
 * The extension list is written as a comma-separated string because
 * `moduleSettingEntrySchema` requires a non-empty scalar `value` — there is no
 * array type in sys_module_settings, and a JSON blob would be harder to read when
 * someone inspects the table by hand.
 */
export function musicSettingsToEntries(settings: MusicSettings): { key: string; value: string }[] {
  const extensions =
    settings.scanExtensions.length > 0 ? settings.scanExtensions : [...DEFAULT_SCAN_EXTENSIONS];

  return [
    { key: MUSIC_SETTING_KEYS.scanExtensions, value: [...new Set(extensions)].join(",") },
    { key: MUSIC_SETTING_KEYS.skipUnstreamable, value: String(settings.skipUnstreamable) },
  ];
}
