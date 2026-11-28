import { describe, expect, it } from "vitest";
import {
  controlCenterConfigToValue,
  defaultControlCenterConfig,
  resolveControlCenterConfig,
} from "./control-center";

describe("resolveControlCenterConfig", () => {
  it("returns the defaults for a missing row", () => {
    expect(resolveControlCenterConfig(undefined)).toEqual({
      moneyMovers: 5,
      journalEntries: 5,
      householdRecipes: 4,
      classroomClasses: 3,
      mediaTopTracks: 3,
      mediaRandomPhoto: true,
    });
  });

  it("reads every stored value", () => {
    expect(
      resolveControlCenterConfig(
        "money_movers=2,journal_entries=7,household_recipes=12,classroom_classes=1,media_top_tracks=10,media_random_photo=0",
      ),
    ).toEqual({
      moneyMovers: 2,
      journalEntries: 7,
      householdRecipes: 12,
      classroomClasses: 1,
      mediaTopTracks: 10,
      mediaRandomPhoto: false,
    });
  });

  it("falls back per field on junk and clamps out-of-range numbers", () => {
    const config = resolveControlCenterConfig(
      "money_movers=abc,journal_entries=99,household_recipes=0,media_random_photo=maybe,garbage",
    );
    expect(config.moneyMovers).toBe(5);
    expect(config.journalEntries).toBe(10);
    expect(config.householdRecipes).toBe(1);
    expect(config.classroomClasses).toBe(3);
    expect(config.mediaRandomPhoto).toBe(true);
  });
});

describe("controlCenterConfigToValue", () => {
  it("round-trips through the resolver", () => {
    const config = { ...defaultControlCenterConfig(), journalEntries: 8, mediaRandomPhoto: false };
    expect(resolveControlCenterConfig(controlCenterConfigToValue(config))).toEqual(config);
  });

  it("encodes the defaults as the seeded value", () => {
    expect(controlCenterConfigToValue(defaultControlCenterConfig())).toBe(
      "money_movers=5,journal_entries=5,household_recipes=4,classroom_classes=3,media_top_tracks=3,media_random_photo=1",
    );
  });

  it("rejects out-of-range, fractional and missing fields", () => {
    expect(() =>
      controlCenterConfigToValue({ ...defaultControlCenterConfig(), householdRecipes: 13 }),
    ).toThrow();
    expect(() =>
      controlCenterConfigToValue({ ...defaultControlCenterConfig(), moneyMovers: 0 }),
    ).toThrow();
    expect(() =>
      controlCenterConfigToValue({ ...defaultControlCenterConfig(), mediaTopTracks: 2.5 }),
    ).toThrow();
    expect(() => controlCenterConfigToValue({ moneyMovers: 5 })).toThrow();
  });
});
