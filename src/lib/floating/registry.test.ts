import { describe, expect, it } from "vitest";
import {
  FLOATING_COMPONENTS,
  defaultEnabledIds,
  enabledFloatingToValue,
  getFloatingComponent,
  isFloatingId,
  parseEnabledFloating,
  resolveEnabledFloating,
} from "./registry";
import { FLOATING_STATE_KEYS, resolveFloatingStates } from "./state";

describe("the registry itself", () => {
  it("has no duplicate ids", () => {
    const ids = FLOATING_COMPONENTS.map((component) => component.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every component a label and a description", () => {
    for (const component of FLOATING_COMPONENTS) {
      expect(component.label.length).toBeGreaterThan(0);
      expect(component.description.length).toBeGreaterThan(0);
    }
  });

  it("finds a component by id, and nothing for an unknown one", () => {
    expect(getFloatingComponent("clock")?.label).toBe("Floating Clock");
    expect(getFloatingComponent("nope")).toBeUndefined();
  });

  it("guards ids", () => {
    expect(isFloatingId("clock")).toBe(true);
    expect(isFloatingId("Clock")).toBe(false);
    expect(isFloatingId("")).toBe(false);
  });
});

describe("parseEnabledFloating", () => {
  it("reads a single id", () => {
    expect(parseEnabledFloating("clock")).toEqual(["clock"]);
  });

  it("tolerates whitespace", () => {
    expect(parseEnabledFloating(" clock , ")).toEqual(["clock"]);
  });

  it("reads a blank value as nothing enabled", () => {
    // Not as "use the defaults" — this is what the admin screen writes when every
    // switch is off, and defaulting here would make that state unreachable.
    expect(parseEnabledFloating("")).toEqual([]);
  });

  it("drops unknown ids rather than throwing", () => {
    // A component retired in a later release leaves its id in the stored value. An
    // admin screen that crashed on that row would be unfixable through the UI.
    expect(parseEnabledFloating("clock,retired-thing")).toEqual(["clock"]);
  });

  it("collapses duplicates", () => {
    expect(parseEnabledFloating("clock,clock")).toEqual(["clock"]);
  });
});

describe("resolveEnabledFloating", () => {
  it("falls back to the shipped defaults only when the row is absent", () => {
    expect(resolveEnabledFloating(undefined)).toEqual(defaultEnabledIds());
  });

  it("takes a blank row at its word", () => {
    expect(resolveEnabledFloating("")).toEqual([]);
  });
});

describe("enabledFloatingToValue", () => {
  it("round-trips through the parser", () => {
    expect(parseEnabledFloating(enabledFloatingToValue(["clock"]))).toEqual(["clock"]);
  });

  it("writes nothing for an empty list", () => {
    expect(enabledFloatingToValue([])).toBe("");
  });
});

describe("resolveFloatingStates", () => {
  it("defaults an untouched component to closed", () => {
    expect(resolveFloatingStates(new Map())).toEqual({
      clock: "closed",
      calculator: "closed",
      scratchpad: "closed",
    });
  });

  it("reads a stored state", () => {
    const rows = new Map([[FLOATING_STATE_KEYS.clock, "minimized"]]);
    expect(resolveFloatingStates(rows).clock).toBe("minimized");
  });

  it("clamps an unrecognised state to closed", () => {
    const rows = new Map([[FLOATING_STATE_KEYS.clock, "sideways"]]);
    expect(resolveFloatingStates(rows).clock).toBe("closed");
  });

  it("returns a full record so callers never check for a missing row", () => {
    const states = resolveFloatingStates(new Map());
    for (const component of FLOATING_COMPONENTS) {
      expect(states[component.id]).toBeDefined();
    }
  });
});
