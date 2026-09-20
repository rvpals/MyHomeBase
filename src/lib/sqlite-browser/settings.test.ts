import { describe, expect, it } from "vitest";
import type { ModuleSetting } from "@/lib/module-settings";
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  MAX_UPLOAD_CEILING_BYTES,
  MIN_UPLOAD_CAP_BYTES,
  maxUploadCapSchema,
} from "./schema";
import { TOOLS_SETTING_KEYS, resolveToolsSettings, toolsSettingsToEntries } from "./settings";

function row(key: string, value: string): ModuleSetting {
  return { id: 1, moduleId: 10, key, value, description: "" };
}

describe("resolveToolsSettings", () => {
  it("reads a configured cap", () => {
    const settings = resolveToolsSettings([
      row(TOOLS_SETTING_KEYS.maxUploadBytes, String(200 * 1024 * 1024)),
    ]);

    expect(settings.maxUploadBytes).toBe(200 * 1024 * 1024);
  });

  it("falls back to the default when nothing is stored", () => {
    expect(resolveToolsSettings([]).maxUploadBytes).toBe(DEFAULT_MAX_UPLOAD_BYTES);
  });

  // The resolver reads rows that the admin's generic key/value editor can
  // reach, so garbage has to fall back rather than throw.
  it.each([
    ["blank", ""],
    ["not a number", "lots"],
    ["zero", "0"],
    ["negative", "-500"],
  ])("falls back to the default for a %s value", (_label, value) => {
    const settings = resolveToolsSettings([row(TOOLS_SETTING_KEYS.maxUploadBytes, value)]);

    expect(settings.maxUploadBytes).toBe(DEFAULT_MAX_UPLOAD_BYTES);
  });

  // Clamped rather than rejected: a hand-edited row should behave as the
  // ceiling, not break uploading altogether.
  it("clamps a value above the ceiling", () => {
    const settings = resolveToolsSettings([
      row(TOOLS_SETTING_KEYS.maxUploadBytes, String(MAX_UPLOAD_CEILING_BYTES * 10)),
    ]);

    expect(settings.maxUploadBytes).toBe(MAX_UPLOAD_CEILING_BYTES);
  });

  it("ignores rows belonging to other settings", () => {
    const settings = resolveToolsSettings([row("something_else", "12")]);

    expect(settings.maxUploadBytes).toBe(DEFAULT_MAX_UPLOAD_BYTES);
  });
});

describe("toolsSettingsToEntries", () => {
  it("round-trips through the resolver", () => {
    const entries = toolsSettingsToEntries({ maxUploadBytes: 250 * 1024 * 1024 });
    const resolved = resolveToolsSettings(
      entries.map((entry) => row(entry.key, entry.value)),
    );

    expect(resolved.maxUploadBytes).toBe(250 * 1024 * 1024);
  });

  it("stores the value in bytes", () => {
    const [entry] = toolsSettingsToEntries({ maxUploadBytes: 2 * 1024 * 1024 });

    expect(entry.key).toBe(TOOLS_SETTING_KEYS.maxUploadBytes);
    expect(entry.value).toBe(String(2 * 1024 * 1024));
  });
});

describe("maxUploadCapSchema", () => {
  it("accepts a value inside the range", () => {
    expect(maxUploadCapSchema.parse(500 * 1024 * 1024)).toBe(500 * 1024 * 1024);
  });

  it("accepts the bounds themselves", () => {
    expect(maxUploadCapSchema.parse(MIN_UPLOAD_CAP_BYTES)).toBe(MIN_UPLOAD_CAP_BYTES);
    expect(maxUploadCapSchema.parse(MAX_UPLOAD_CEILING_BYTES)).toBe(MAX_UPLOAD_CEILING_BYTES);
  });

  // Rejected rather than clamped here, unlike the resolver: this is someone
  // typing into a form, where being told is more useful than being corrected.
  it("rejects a value above the ceiling", () => {
    expect(() => maxUploadCapSchema.parse(MAX_UPLOAD_CEILING_BYTES + 1)).toThrow(/cannot exceed/);
  });

  it("rejects a value below the floor", () => {
    expect(() => maxUploadCapSchema.parse(1024)).toThrow(/cannot be below/);
  });
});
