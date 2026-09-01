import { describe, expect, it } from "vitest";
import { normalizeEntryTime } from "./time";

describe("normalizeEntryTime", () => {
  it("drops a zero seconds component", () => {
    expect(normalizeEntryTime("15:30:00")).toBe("15:30");
  });

  it("zero-pads a single-digit hour", () => {
    expect(normalizeEntryTime("9:05")).toBe("09:05");
    expect(normalizeEntryTime("9:05:00")).toBe("09:05");
  });

  it("leaves an already-canonical time alone", () => {
    expect(normalizeEntryTime("15:30")).toBe("15:30");
    expect(normalizeEntryTime("00:00")).toBe("00:00");
    expect(normalizeEntryTime("23:59")).toBe("23:59");
  });

  it("keeps an empty time empty", () => {
    expect(normalizeEntryTime("")).toBe("");
    expect(normalizeEntryTime("   ")).toBe("");
  });

  it("truncates real seconds rather than rounding", () => {
    expect(normalizeEntryTime("15:30:45")).toBe("15:30");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeEntryTime("  15:30:00  ")).toBe("15:30");
  });

  it("makes the two stored shapes of one time compare equal", () => {
    // The bug this exists for: an import wrote "15:30:00" and a later one
    // "15:30", so the date+time+title duplicate check saw two entries.
    expect(normalizeEntryTime("15:30:00")).toBe(normalizeEntryTime("15:30"));
  });

  it("returns an unreadable value trimmed but unchanged", () => {
    // Entry time is unvalidated by design — throwing here would break an
    // import that works today.
    expect(normalizeEntryTime("tea time")).toBe("tea time");
    expect(normalizeEntryTime("  3pm ")).toBe("3pm");
    expect(normalizeEntryTime("15h30")).toBe("15h30");
  });

  it("rejects an out-of-range hour or minute instead of reformatting it", () => {
    expect(normalizeEntryTime("25:00")).toBe("25:00");
    expect(normalizeEntryTime("12:75")).toBe("12:75");
  });
});
