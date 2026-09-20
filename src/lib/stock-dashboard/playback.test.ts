import { describe, expect, it } from "vitest";
import type { DailySnapshot } from "@/lib/stock-daily-snapshot";
import {
  buildPlaybackFrames,
  canPlayBack,
  playbackFrameMs,
  MAX_FRAME_MS,
  MIN_FRAME_MS,
  MIN_PLAYBACK_FRAMES,
  TARGET_PLAYBACK_MS,
} from "./playback";

function snapshot(snapshotDate: string, totalValueCents: number): DailySnapshot {
  return {
    snapshotDate,
    stockValueCents: Math.round(totalValueCents * 0.6),
    etfValueCents: Math.round(totalValueCents * 0.3),
    otherValueCents: totalValueCents - Math.round(totalValueCents * 0.6) - Math.round(totalValueCents * 0.3),
    totalValueCents,
    stockGainLossCents: 0,
    etfGainLossCents: 0,
    otherGainLossCents: 0,
    totalGainLossCents: 100,
    positionCount: 4,
    createdAt: "2026-08-04 12:00:00",
    updatedAt: "2026-08-04 12:00:00",
  };
}

describe("buildPlaybackFrames", () => {
  it("returns nothing for no history", () => {
    expect(buildPlaybackFrames([], "weekly")).toEqual([]);
    expect(buildPlaybackFrames([], "yearly")).toEqual([]);
  });

  it("keeps one frame per ISO week, keyed by that week's Monday", () => {
    // 2026-08-04 is a Tuesday, so its week starts Monday 2026-08-03.
    const frames = buildPlaybackFrames(
      [snapshot("2026-08-04", 1000), snapshot("2026-08-06", 1200), snapshot("2026-08-11", 1500)],
      "weekly",
    );

    expect(frames.map((frame) => frame.periodKey)).toEqual(["2026-08-03", "2026-08-10"]);
    expect(frames.map((frame) => frame.periodLabel)).toEqual(["w/c 2026-08-03", "w/c 2026-08-10"]);
  });

  it("represents a period by its last captured day, not an average or the period's end", () => {
    // The week ending Sunday 2026-08-09 was only captured through Thursday.
    const frames = buildPlaybackFrames(
      [snapshot("2026-08-04", 1000), snapshot("2026-08-06", 1200)],
      "weekly",
    );

    expect(frames).toHaveLength(1);
    expect(frames[0].snapshotDate).toBe("2026-08-06");
    expect(frames[0].totalValueCents).toBe(1200);
  });

  it("carries all three value series, so every line animates", () => {
    const frames = buildPlaybackFrames([snapshot("2026-08-04", 1000)], "monthly");

    expect(frames[0].stockValueCents).toBe(600);
    expect(frames[0].etfValueCents).toBe(300);
    expect(frames[0].totalValueCents).toBe(1000);
    expect(frames[0].totalGainLossCents).toBe(100);
  });

  it("keeps every captured day as its own frame when stepping daily", () => {
    const frames = buildPlaybackFrames(
      [snapshot("2026-08-04", 1000), snapshot("2026-08-06", 1200), snapshot("2026-08-11", 1500)],
      "daily",
    );

    expect(frames.map((frame) => frame.periodKey)).toEqual([
      "2026-08-04",
      "2026-08-06",
      "2026-08-11",
    ]);
    // A day is its own period, so nothing is collapsed and no value is dropped.
    expect(frames.map((frame) => frame.totalValueCents)).toEqual([1000, 1200, 1500]);
  });

  it("labels a daily frame with the plain date, not a period prefix", () => {
    expect(buildPlaybackFrames([snapshot("2026-08-04", 1000)], "daily")[0].periodLabel).toBe(
      "2026-08-04",
    );
  });

  it("cuts monthly and yearly by date prefix", () => {
    const history = [
      snapshot("2026-08-04", 1000),
      snapshot("2026-08-29", 1100),
      snapshot("2026-09-18", 1300),
    ];

    expect(buildPlaybackFrames(history, "monthly").map((frame) => frame.periodKey)).toEqual([
      "2026-08",
      "2026-09",
    ]);
    expect(buildPlaybackFrames(history, "yearly").map((frame) => frame.periodKey)).toEqual(["2026"]);
  });

  it("sorts oldest first even when the input is out of order", () => {
    const frames = buildPlaybackFrames(
      [snapshot("2026-09-18", 1300), snapshot("2026-08-04", 1000), snapshot("2026-08-29", 1100)],
      "monthly",
    );

    expect(frames.map((frame) => frame.snapshotDate)).toEqual(["2026-08-29", "2026-09-18"]);
  });

  it("does not let a repeated date unseat the bucket's true latest day", () => {
    const frames = buildPlaybackFrames(
      [snapshot("2026-08-29", 1100), snapshot("2026-08-04", 9999), snapshot("2026-08-29", 1100)],
      "monthly",
    );

    expect(frames).toHaveLength(1);
    expect(frames[0].totalValueCents).toBe(1100);
  });

  it("is unaffected by a timezone behind UTC, where a naive parse would shift the week", () => {
    const original = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      // Monday. A local-midnight parse in a negative-offset zone would land on
      // the previous Sunday and bucket this into the week before.
      expect(buildPlaybackFrames([snapshot("2026-08-10", 1000)], "weekly")[0].periodKey).toBe(
        "2026-08-10",
      );
    } finally {
      process.env.TZ = original;
    }
  });
});

describe("canPlayBack", () => {
  it("refuses a history too short to animate", () => {
    expect(canPlayBack([])).toBe(false);
    expect(canPlayBack(buildPlaybackFrames([snapshot("2026-08-04", 1000)], "yearly"))).toBe(false);
  });

  it("allows playback from the first frame that gives motion", () => {
    const frames = buildPlaybackFrames(
      [snapshot("2026-08-04", 1000), snapshot("2026-09-18", 1300)],
      "monthly",
    );

    expect(frames).toHaveLength(MIN_PLAYBACK_FRAMES);
    expect(canPlayBack(frames)).toBe(true);
  });
});

describe("playbackFrameMs", () => {
  it("paces a long run to roughly the target duration instead of a flat tick", () => {
    // 36 daily frames: a flat 600ms tick would run 21.6s.
    const perFrame = playbackFrameMs(36);
    expect(perFrame * 36).toBeLessThanOrEqual(TARGET_PLAYBACK_MS * 1.1);
    expect(perFrame).toBeLessThan(MAX_FRAME_MS);
  });

  it("slows a short run to the ceiling rather than finishing in a blink", () => {
    expect(playbackFrameMs(2)).toBe(MAX_FRAME_MS);
    expect(playbackFrameMs(1)).toBe(MAX_FRAME_MS);
  });

  it("never drops below the floor, so a very long history stays legible", () => {
    expect(playbackFrameMs(10_000)).toBe(MIN_FRAME_MS);
  });

  it("survives a frameless call rather than dividing by zero", () => {
    expect(playbackFrameMs(0)).toBe(MAX_FRAME_MS);
    expect(Number.isFinite(playbackFrameMs(0))).toBe(true);
  });
});
