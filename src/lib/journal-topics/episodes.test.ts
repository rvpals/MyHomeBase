import { describe, expect, it } from "vitest";
import {
  DEFAULT_EPISODE_GAP_DAYS,
  buildEpisodes,
  clampEpisodeGapDays,
  daysBetween,
} from "./episodes";
import type { TopicEntry } from "./types";
import type { JournalEntry } from "@/lib/journal/types";

function topicEntry(id: number, date: string, time = ""): TopicEntry {
  const entry: JournalEntry = {
    id,
    date,
    time,
    title: `Entry ${id}`,
    content: "",
    placeName: "",
    isPinned: false,
    isLocked: false,
    isEncrypted: false,
    titleEncrypted: "",
    contentEncrypted: "",
    passwordHint: "",
    categories: [],
    tags: [],
    locations: [],
    source: "",
    externalId: "",
    externalContent: "",
    createdAt: `${date}T00:00:00Z`,
    updatedAt: `${date}T00:00:00Z`,
  };
  return { entry, reasons: [], score: 1, isMasked: false };
}

/** Episode ids, for terse assertions. */
function ids(episodes: ReturnType<typeof buildEpisodes>): number[][] {
  return episodes.map((episode) => episode.entries.map((e) => e.entry.id));
}

describe("daysBetween", () => {
  it("counts whole days", () => {
    expect(daysBetween("2026-01-01", "2026-01-15")).toBe(14);
  });

  it("crosses a month and a year boundary", () => {
    expect(daysBetween("2026-01-30", "2026-02-02")).toBe(3);
    expect(daysBetween("2025-12-31", "2026-01-01")).toBe(1);
  });

  // Parsed as UTC precisely so this does not drift by an hour and round wrong.
  it("is unaffected by a daylight-saving boundary", () => {
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
  });

  it("returns 0 for an unparseable date rather than NaN", () => {
    expect(daysBetween("not-a-date", "2026-01-01")).toBe(0);
  });
});

describe("buildEpisodes", () => {
  it("returns nothing for no entries", () => {
    expect(buildEpisodes([])).toEqual([]);
  });

  it("keeps entries closer than the gap in one episode", () => {
    const episodes = buildEpisodes(
      [topicEntry(1, "2026-01-01"), topicEntry(2, "2026-01-05")],
      14,
    );
    expect(ids(episodes)).toEqual([[1, 2]]);
  });

  it("splits entries further apart than the gap", () => {
    const episodes = buildEpisodes(
      [topicEntry(1, "2026-01-01"), topicEntry(2, "2026-03-01")],
      14,
    );
    // Most recent episode first.
    expect(ids(episodes)).toEqual([[2], [1]]);
  });

  // "Within a fortnight" has to read the way a person means it.
  it("treats a gap of exactly gapDays as the same episode", () => {
    const episodes = buildEpisodes(
      [topicEntry(1, "2026-01-01"), topicEntry(2, "2026-01-15")],
      14,
    );
    expect(ids(episodes)).toEqual([[1, 2]]);
  });

  it("splits at one day more than gapDays", () => {
    const episodes = buildEpisodes(
      [topicEntry(1, "2026-01-01"), topicEntry(2, "2026-01-16")],
      14,
    );
    expect(ids(episodes)).toEqual([[2], [1]]);
  });

  // Callers hand these over sorted by relevance, which would otherwise cluster
  // into nonsense.
  it("sorts by date before clustering, whatever order it is given", () => {
    const episodes = buildEpisodes(
      [topicEntry(3, "2026-06-01"), topicEntry(1, "2026-01-01"), topicEntry(2, "2026-01-03")],
      14,
    );
    expect(ids(episodes)).toEqual([[3], [1, 2]]);
  });

  it("orders same-day entries by time then id", () => {
    const episodes = buildEpisodes(
      [
        topicEntry(2, "2026-01-01", "18:00"),
        topicEntry(1, "2026-01-01", "09:00"),
        topicEntry(3, "2026-01-01", "18:00"),
      ],
      14,
    );
    expect(ids(episodes)).toEqual([[1, 2, 3]]);
  });

  it("reports each episode's span", () => {
    const [recent, older] = buildEpisodes(
      [topicEntry(1, "2026-01-01"), topicEntry(2, "2026-01-04"), topicEntry(3, "2026-09-09")],
      14,
    );
    expect(recent).toMatchObject({ startDate: "2026-09-09", endDate: "2026-09-09" });
    expect(older).toMatchObject({ startDate: "2026-01-01", endDate: "2026-01-04" });
  });

  it("defaults to the standard gap when none is given", () => {
    const episodes = buildEpisodes([
      topicEntry(1, "2026-01-01"),
      topicEntry(2, `2026-01-${String(1 + DEFAULT_EPISODE_GAP_DAYS).padStart(2, "0")}`),
    ]);
    expect(ids(episodes)).toEqual([[1, 2]]);
  });
});

describe("clampEpisodeGapDays", () => {
  it("accepts a whole number in range", () => {
    expect(clampEpisodeGapDays(30)).toBe(30);
    expect(clampEpisodeGapDays("30")).toBe(30);
  });

  // A gap of 0 is the timeline with the feature switched off.
  it("raises anything below the floor to 1", () => {
    expect(clampEpisodeGapDays(0)).toBe(1);
    expect(clampEpisodeGapDays(-5)).toBe(1);
  });

  it("caps anything above the ceiling", () => {
    expect(clampEpisodeGapDays(10_000)).toBe(365);
  });

  it("falls back to the default for anything unparseable", () => {
    expect(clampEpisodeGapDays("")).toBe(DEFAULT_EPISODE_GAP_DAYS);
    expect(clampEpisodeGapDays("soon")).toBe(DEFAULT_EPISODE_GAP_DAYS);
    expect(clampEpisodeGapDays(undefined)).toBe(DEFAULT_EPISODE_GAP_DAYS);
    expect(clampEpisodeGapDays(1.5)).toBe(DEFAULT_EPISODE_GAP_DAYS);
  });
});
