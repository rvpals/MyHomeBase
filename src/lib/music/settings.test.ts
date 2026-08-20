import { describe, expect, it } from "vitest";
import type { ModuleSetting } from "@/lib/module-settings";
import {
  MUSIC_SETTING_KEYS,
  musicSettingsToEntries,
  resolveMusicSettings,
} from "./settings";

function rows(pairs: Record<string, string>): ModuleSetting[] {
  return Object.entries(pairs).map(([key, value], index) => ({
    id: index + 1,
    moduleId: 7,
    key,
    value,
  }));
}

describe("resolveMusicSettings", () => {
  it("falls back to mp3 + flac on a fresh install", () => {
    const settings = resolveMusicSettings([]);
    expect(settings.scanExtensions).toEqual(["mp3", "flac"]);
    // A playable library is the common want, so this defaults on.
    expect(settings.skipUnstreamable).toBe(true);
    // Auto-fetch defaults OFF: it sends traffic to lrclib.net, so it is opt-in.
    expect(settings.autoFetchLyrics).toBe(false);
  });

  it("reads auto-fetch lyrics when it has been switched on", () => {
    const settings = resolveMusicSettings(rows({ [MUSIC_SETTING_KEYS.autoFetchLyrics]: "true" }));
    expect(settings.autoFetchLyrics).toBe(true);
  });

  it("treats anything other than true as off", () => {
    // Covers the stored "false" and a value no UI would write but a hand-edited row
    // could -- neither may switch an outbound-request feature on.
    for (const value of ["false", "", "yes", "1", "TRUE "]) {
      const settings = resolveMusicSettings(rows({ [MUSIC_SETTING_KEYS.autoFetchLyrics]: value }));
      expect(settings.autoFetchLyrics).toBe(value.trim().toLowerCase() === "true");
    }
  });

  it("reads a stored allowlist", () => {
    const settings = resolveMusicSettings(
      rows({ [MUSIC_SETTING_KEYS.scanExtensions]: "mp3,flac,ogg" }),
    );
    expect(settings.scanExtensions).toEqual(["mp3", "flac", "ogg"]);
  });

  it("tolerates whitespace and mixed case", () => {
    const settings = resolveMusicSettings(
      rows({ [MUSIC_SETTING_KEYS.scanExtensions]: " MP3 , Flac " }),
    );
    expect(settings.scanExtensions).toEqual(["mp3", "flac"]);
  });

  it("drops unknown extensions rather than throwing", () => {
    // A stored value can outlive a change to MUSIC_FORMATS; a stale entry must
    // not break the scan screen.
    const settings = resolveMusicSettings(
      rows({ [MUSIC_SETTING_KEYS.scanExtensions]: "mp3,xyz,flac" }),
    );
    expect(settings.scanExtensions).toEqual(["mp3", "flac"]);
  });

  it("deduplicates, so the scan summary cannot double-count", () => {
    const settings = resolveMusicSettings(
      rows({ [MUSIC_SETTING_KEYS.scanExtensions]: "mp3,mp3,flac" }),
    );
    expect(settings.scanExtensions).toEqual(["mp3", "flac"]);
  });

  it("never yields an empty allowlist, which would make every scan a silent no-op", () => {
    expect(resolveMusicSettings(rows({ [MUSIC_SETTING_KEYS.scanExtensions]: "" })).scanExtensions)
      .toEqual(["mp3", "flac"]);
    expect(
      resolveMusicSettings(rows({ [MUSIC_SETTING_KEYS.scanExtensions]: "xyz,abc" })).scanExtensions,
    ).toEqual(["mp3", "flac"]);
  });

  it("reads skipUnstreamable, including odd casing", () => {
    expect(
      resolveMusicSettings(rows({ [MUSIC_SETTING_KEYS.skipUnstreamable]: "false" }))
        .skipUnstreamable,
    ).toBe(false);
    expect(
      resolveMusicSettings(rows({ [MUSIC_SETTING_KEYS.skipUnstreamable]: " TRUE " }))
        .skipUnstreamable,
    ).toBe(true);
  });

  it("treats an unparseable skip flag as false rather than throwing", () => {
    expect(
      resolveMusicSettings(rows({ [MUSIC_SETTING_KEYS.skipUnstreamable]: "yes" }))
        .skipUnstreamable,
    ).toBe(false);
  });
});

describe("musicSettingsToEntries", () => {
  it("round-trips through resolve unchanged", () => {
    const original = { scanExtensions: ["mp3", "flac", "ape"] as const, skipUnstreamable: false };
    const restored = resolveMusicSettings(
      musicSettingsToEntries({
        scanExtensions: [...original.scanExtensions],
        skipUnstreamable: original.skipUnstreamable,
        autoFetchLyrics: true,
      }).map((entry, index) => ({
        id: index + 1,
        moduleId: 7,
        key: entry.key,
        value: entry.value,
      })),
    );
    expect(restored.scanExtensions).toEqual(["mp3", "flac", "ape"]);
    expect(restored.skipUnstreamable).toBe(false);
    expect(restored.autoFetchLyrics).toBe(true);
  });

  it("never writes a blank value, which the settings schema rejects", () => {
    for (const entry of musicSettingsToEntries({
      scanExtensions: [],
      skipUnstreamable: true,
      autoFetchLyrics: false,
    })) {
      expect(entry.value).not.toBe("");
    }
  });

  it("substitutes the default when handed an empty allowlist", () => {
    const entries = musicSettingsToEntries({
      scanExtensions: [],
      skipUnstreamable: true,
      autoFetchLyrics: false,
    });
    const extensions = entries.find((e) => e.key === MUSIC_SETTING_KEYS.scanExtensions);
    expect(extensions?.value).toBe("mp3,flac");
  });
});
