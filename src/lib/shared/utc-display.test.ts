import { describe, expect, it } from "vitest";

import {
  describeLocalInstant,
  formatLocalTimeLabel,
  formatUtcStamp,
  parseUtcStamp,
} from "./utc-display";

// A fixed zone everywhere, so these assertions mean the same thing on a NAS in UTC
// and on a laptop in Europe. The whole point of the module is that the machine's own
// clock must not leak into the answer.
const NY = "America/New_York";

describe("parseUtcStamp", () => {
  it("reads a SQLite stamp as UTC, not as local time", () => {
    const parsed = parseUtcStamp("2026-08-16 14:30:00");
    expect(parsed?.toISOString()).toBe("2026-08-16T14:30:00.000Z");
  });

  it("accepts the ISO 'T' separator as well as a space", () => {
    expect(parseUtcStamp("2026-08-16T14:30:00")?.toISOString()).toBe(
      "2026-08-16T14:30:00.000Z",
    );
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseUtcStamp("  2026-08-16 14:30:00  ")?.toISOString()).toBe(
      "2026-08-16T14:30:00.000Z",
    );
  });

  it("returns null for a malformed stamp rather than an Invalid Date", () => {
    expect(parseUtcStamp("not a date")).toBeNull();
    expect(parseUtcStamp("")).toBeNull();
    // Date-only: real in the database, but not an instant this module can place.
    expect(parseUtcStamp("2026-08-16")).toBeNull();
    // Right shape, impossible time — the regex passes it, Date rejects it.
    expect(parseUtcStamp("2026-08-16 99:99:99")).toBeNull();
  });
});

describe("formatUtcStamp", () => {
  it("prints epoch ms in the same shape the database stores", () => {
    expect(formatUtcStamp(Date.UTC(2026, 7, 16, 14, 30, 0))).toBe("2026-08-16 14:30:00");
  });

  it("round-trips through parseUtcStamp", () => {
    const ms = Date.UTC(2026, 0, 2, 3, 4, 5);
    expect(parseUtcStamp(formatUtcStamp(ms))?.getTime()).toBe(ms);
  });
});

describe("formatLocalTimeLabel", () => {
  it("converts to the reader's clock and names the zone", () => {
    const instant = new Date("2026-01-16T14:30:00Z");
    expect(formatLocalTimeLabel(instant, "en-US", NY)).toBe("9:30 AM EST");
  });

  it("tracks daylight saving per instant, not per zone", () => {
    // Same wall-clock UTC time, six months apart: EDT in July, EST in January.
    const summer = new Date("2026-07-16T14:30:00Z");
    expect(formatLocalTimeLabel(summer, "en-US", NY)).toBe("10:30 AM EDT");
  });

  it("omits seconds — the UTC half beside it already carries them", () => {
    const instant = new Date("2026-01-16T14:30:45Z");
    expect(formatLocalTimeLabel(instant, "en-US", NY)).toBe("9:30 AM EST");
  });
});

describe("describeLocalInstant", () => {
  it("shows time alone when the local date matches the UTC date", () => {
    const instant = new Date("2026-01-16T14:30:00Z");
    expect(describeLocalInstant(instant, "en-US", NY)).toBe("9:30 AM EST");
  });

  it("adds the date when the reader's day differs from the UTC day", () => {
    // 02:30 UTC on the 16th is still the evening of the 15th in New York.
    const instant = new Date("2026-01-16T02:30:00Z");
    expect(describeLocalInstant(instant, "en-US", NY)).toBe("Jan 15, 9:30 PM EST");
  });

  it("adds the date when the reader is ahead of UTC into the next day", () => {
    const instant = new Date("2026-01-16T20:30:00Z");
    expect(describeLocalInstant(instant, "en-US", "Asia/Tokyo")).toBe("Jan 17, 5:30 AM GMT+9");
  });

  it("shows time alone for a reader already in UTC", () => {
    const instant = new Date("2026-01-16T14:30:00Z");
    expect(describeLocalInstant(instant, "en-US", "UTC")).toBe("2:30 PM UTC");
  });
});
