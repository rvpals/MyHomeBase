import { describe, expect, it } from "vitest";
import { DEFAULT_CULL_IMAGES, MAX_CULL_CEILING, MIN_CULL_IMAGES } from "./config";
import {
  CULLING_SETTING_KEYS,
  cullingSettingsToEntries,
  resolveCullingSettings,
} from "./settings";
import type { ModuleSetting } from "../module-settings";

/** A settings row, as the repository returns them. */
function row(key: string, value: string): ModuleSetting {
  return { id: 1, moduleId: 1, key, value };
}

describe("resolveCullingSettings", () => {
  it("reads a stored ceiling", () => {
    const resolved = resolveCullingSettings([
      row(CULLING_SETTING_KEYS.maxCullImages, "500"),
    ]);
    expect(resolved.maxCullImages).toBe(500);
  });

  it("falls back to the default when no row exists", () => {
    expect(resolveCullingSettings([]).maxCullImages).toBe(DEFAULT_CULL_IMAGES);
  });

  it("falls back to the default for a blank row", () => {
    const resolved = resolveCullingSettings([row(CULLING_SETTING_KEYS.maxCullImages, "")]);
    expect(resolved.maxCullImages).toBe(DEFAULT_CULL_IMAGES);
  });

  it("falls back to the default for a row someone typed words into", () => {
    const resolved = resolveCullingSettings([
      row(CULLING_SETTING_KEYS.maxCullImages, "lots"),
    ]);
    expect(resolved.maxCullImages).toBe(DEFAULT_CULL_IMAGES);
  });

  it("falls back to the default for a negative row", () => {
    const resolved = resolveCullingSettings([row(CULLING_SETTING_KEYS.maxCullImages, "-5")]);
    expect(resolved.maxCullImages).toBe(DEFAULT_CULL_IMAGES);
  });

  it("clamps a hand-edited row above the ceiling rather than obeying it", () => {
    const resolved = resolveCullingSettings([
      row(CULLING_SETTING_KEYS.maxCullImages, "999999"),
    ]);
    expect(resolved.maxCullImages).toBe(MAX_CULL_CEILING);
  });

  it("clamps a row below the floor up to it", () => {
    const resolved = resolveCullingSettings([row(CULLING_SETTING_KEYS.maxCullImages, "2")]);
    expect(resolved.maxCullImages).toBe(MIN_CULL_IMAGES);
  });

  it("floors a fractional row", () => {
    const resolved = resolveCullingSettings([
      row(CULLING_SETTING_KEYS.maxCullImages, "250.9"),
    ]);
    expect(resolved.maxCullImages).toBe(250);
  });

  it("ignores rows belonging to other settings", () => {
    const resolved = resolveCullingSettings([row("something_else", "7")]);
    expect(resolved.maxCullImages).toBe(DEFAULT_CULL_IMAGES);
  });
});

describe("cullingSettingsToEntries", () => {
  it("writes the ceiling as a string row", () => {
    expect(cullingSettingsToEntries({ maxCullImages: 420 })).toEqual([
      { key: CULLING_SETTING_KEYS.maxCullImages, value: "420" },
    ]);
  });

  it("round-trips through the resolver", () => {
    const entries = cullingSettingsToEntries({ maxCullImages: 180 });
    const resolved = resolveCullingSettings(entries.map((entry) => row(entry.key, entry.value)));
    expect(resolved.maxCullImages).toBe(180);
  });
});
