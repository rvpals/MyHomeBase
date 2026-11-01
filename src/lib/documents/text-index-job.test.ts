import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEXT_INDEX_BATCH,
  DEFAULT_TEXT_INDEX_INTERVAL_HOURS,
  TEXT_INDEX_SETTING_KEYS,
  describeTextIndexInterval,
  isTextIndexPassDue,
  resolveTextIndexJobSettings,
} from "./text-index-job";

const HOUR = 60 * 60 * 1000;

function rows(entries: Record<string, string>): { key: string; value: string }[] {
  return Object.entries(entries).map(([key, value]) => ({ key, value }));
}

describe("resolveTextIndexJobSettings", () => {
  it("is off by default, so an upgrade never starts OCR'ing unasked", () => {
    const settings = resolveTextIndexJobSettings([]);
    // The important one: a 2GB NAS must not begin recognising a whole library
    // because somebody deployed.
    expect(settings.enabled).toBe(false);
    expect(settings.intervalHours).toBe(DEFAULT_TEXT_INDEX_INTERVAL_HOURS);
    expect(settings.batchSize).toBe(DEFAULT_TEXT_INDEX_BATCH);
    expect(settings.ocrEnabled).toBe(true);
  });

  it("reads a configured switch, cadence and batch", () => {
    const settings = resolveTextIndexJobSettings(
      rows({
        [TEXT_INDEX_SETTING_KEYS.enabled]: "1",
        [TEXT_INDEX_SETTING_KEYS.intervalHours]: "12",
        [TEXT_INDEX_SETTING_KEYS.batchSize]: "40",
        [TEXT_INDEX_SETTING_KEYS.ocrEnabled]: "0",
      }),
    );
    expect(settings).toEqual({
      enabled: true,
      intervalHours: 12,
      batchSize: 40,
      ocrEnabled: false,
    });
  });

  it("keeps OCR on unless it is explicitly switched off", () => {
    // Absent must not read as "off": an install that never touched the key should
    // get a job that actually reads its scans.
    expect(resolveTextIndexJobSettings([]).ocrEnabled).toBe(true);
    expect(
      resolveTextIndexJobSettings(rows({ [TEXT_INDEX_SETTING_KEYS.ocrEnabled]: "0" })).ocrEnabled,
    ).toBe(false);
  });

  it("falls back rather than throwing on a hand-edited row", () => {
    // This runs inside a background tick where a throw is invisible, so "every 0
    // hours" has to degrade to the safe cadence rather than spin the job.
    const settings = resolveTextIndexJobSettings(
      rows({
        [TEXT_INDEX_SETTING_KEYS.intervalHours]: "0",
        [TEXT_INDEX_SETTING_KEYS.batchSize]: "not a number",
      }),
    );
    expect(settings.intervalHours).toBe(1);
    expect(settings.batchSize).toBe(DEFAULT_TEXT_INDEX_BATCH);
  });

  it("clamps a cadence or batch somebody typed an extra zero into", () => {
    const settings = resolveTextIndexJobSettings(
      rows({
        [TEXT_INDEX_SETTING_KEYS.intervalHours]: "100000",
        [TEXT_INDEX_SETTING_KEYS.batchSize]: "99999",
      }),
    );
    expect(settings.intervalHours).toBe(24 * 7);
    expect(settings.batchSize).toBe(500);
  });
});

describe("isTextIndexPassDue", () => {
  const on = resolveTextIndexJobSettings(
    rows({
      [TEXT_INDEX_SETTING_KEYS.enabled]: "1",
      [TEXT_INDEX_SETTING_KEYS.intervalHours]: "6",
    }),
  );

  it("never runs while the switch is off", () => {
    const off = resolveTextIndexJobSettings([]);
    expect(isTextIndexPassDue(off, undefined, Date.now())).toBe(false);
  });

  it("runs at the next tick when it has never run", () => {
    // A freshly enabled job should index now, not after six hours of silence.
    expect(isTextIndexPassDue(on, undefined, 1_000_000)).toBe(true);
  });

  it("waits out the interval", () => {
    const last = 1_000_000;
    expect(isTextIndexPassDue(on, last, last + 5 * HOUR)).toBe(false);
    expect(isTextIndexPassDue(on, last, last + 6 * HOUR)).toBe(true);
  });
});

describe("describeTextIndexInterval", () => {
  it("reads as a person would say it", () => {
    const at = (hours: string) =>
      describeTextIndexInterval(
        resolveTextIndexJobSettings(rows({ [TEXT_INDEX_SETTING_KEYS.intervalHours]: hours })),
      );
    expect(at("1")).toBe("every hour");
    expect(at("6")).toBe("every 6 hours");
    expect(at("24")).toBe("every day");
    expect(at("48")).toBe("every 2 days");
  });
});
