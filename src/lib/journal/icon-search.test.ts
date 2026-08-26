import { describe, expect, it } from "vitest";
import {
  ICON_SET_PREFIX,
  iconifyIconId,
  looksLikePersonName,
  matchIconName,
} from "./icon-search";

describe("matchIconName", () => {
  it("maps a plain vocabulary word", () => {
    expect(matchIconName("Dentist")).toBe("tooth-outline");
    expect(matchIconName("Mortgage")).toBe("home-city");
  });

  it("is case- and punctuation-insensitive", () => {
    expect(matchIconName("DENTIST")).toBe("tooth-outline");
    expect(matchIconName("  dentist  ")).toBe("tooth-outline");
    expect(matchIconName("Amusement-Park")).toBe("ferris-wheel");
    expect(matchIconName("Oil_Change")).toBe("oil");
  });

  it("matches on a single word of a multi-word name", () => {
    expect(matchIconName("Science-Fair")).toBe("flask-outline");
    expect(matchIconName("MY PARENTS")).toBe("human-male-female-child");
  });

  // The reason SPECIAL_CASES exists: normalizeIconName strips digits, so these
  // arrive as a bare letter or two and can't be keyed in the main table.
  it("handles alphanumeric terms whose meaning lives in the digit", () => {
    expect(matchIconName("401K")).toBe("chart-line");
    expect(matchIconName("A1C")).toBe("test-tube");
    expect(matchIconName("K5")).toBe("school-outline");
  });

  it("does not let the digit-stripped remnant match unrelated names", () => {
    // "A" alone must not inherit A1C's test tube.
    expect(matchIconName("A")).not.toBe("test-tube");
    expect(matchIconName("Plan A")).not.toBe("test-tube");
  });

  it("falls back to a person glyph for what looks like a name", () => {
    expect(matchIconName("Skylar")).toBe("account");
    expect(matchIconName("Shufen Zhang")).toBe("account");
  });

  it("returns undefined when nothing fits", () => {
    expect(matchIconName("")).toBeUndefined();
    expect(matchIconName("zzzz qqqq")).toBeUndefined();
  });

  it("prefers a real synonym over the person fallback", () => {
    // "Trinity" is capitalised like a name but is mapped explicitly.
    expect(matchIconName("Trinity")).toBe("church");
  });
});

describe("looksLikePersonName", () => {
  it("accepts one or two capitalised words", () => {
    expect(looksLikePersonName("Skylar")).toBe(true);
    expect(looksLikePersonName("Jian Sun")).toBe(true);
  });

  it("rejects anything with a digit", () => {
    expect(looksLikePersonName("Room 5")).toBe(false);
    expect(looksLikePersonName("401K")).toBe(false);
  });

  it("rejects a short all-caps token, which is an acronym not a name", () => {
    expect(looksLikePersonName("BMS")).toBe(false);
    expect(looksLikePersonName("ER")).toBe(false);
  });

  it("rejects three or more words, and lowercase words", () => {
    expect(looksLikePersonName("One Two Three")).toBe(false);
    expect(looksLikePersonName("skylar")).toBe(false);
  });

  it("rejects placeholder words", () => {
    expect(looksLikePersonName("Misc")).toBe(false);
    expect(looksLikePersonName("Other")).toBe(false);
  });

  it("rejects an empty name", () => {
    expect(looksLikePersonName("")).toBe(false);
    expect(looksLikePersonName("   ")).toBe(false);
  });
});

describe("iconifyIconId", () => {
  it("prefixes the icon set", () => {
    expect(iconifyIconId("Dentist")).toBe(`${ICON_SET_PREFIX}:tooth-outline`);
  });

  it("passes undefined through", () => {
    expect(iconifyIconId("zzzz qqqq")).toBeUndefined();
  });
});
