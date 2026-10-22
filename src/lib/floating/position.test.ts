import { describe, expect, it } from "vitest";
import {
  clampPuckPosition,
  clearPuckPosition,
  KEEP_PUCK_VISIBLE,
  parsePuckPositions,
  resolvePuckPositions,
  serializePuckPositions,
  setPuckPosition,
  FLOATING_POSITIONS_PREFERENCE_KEY,
} from "./position";
import { resolvePuckSlots } from "./layout";
import type { FloatingId, PuckPosition } from "./types";

/** A viewport big enough that nothing clamps unless a test means it to. */
const ROOM = { width: 1600, height: 900 };
/** The puck as rendered: `--floating-puck-size` is 3.5rem. */
const PUCK = { width: 56, height: 56 };

describe("parsePuckPositions", () => {
  it("reads a semicolon-separated list keyed by component id", () => {
    const positions = parsePuckPositions("clock:100,200;scratchpad:10,20");
    expect(positions.get("clock")).toEqual({ x: 100, y: 200 });
    expect(positions.get("scratchpad")).toEqual({ x: 10, y: 20 });
    expect(positions.size).toBe(2);
  });

  it("reads no row as nothing dragged, so every puck stays in its corner", () => {
    expect(parsePuckPositions(undefined).size).toBe(0);
    expect(parsePuckPositions("").size).toBe(0);
  });

  it("keeps a stored zero, which is a real position and not an absent one", () => {
    // The regression this guards: `if (!x)` would drop a puck parked against the
    // top-left edge and silently send it back to its corner.
    expect(parsePuckPositions("clock:0,0").get("clock")).toEqual({ x: 0, y: 0 });
  });

  it("drops an id this build does not know, rather than throwing", () => {
    // A component retired from the registry leaves its id in every reader's row. The
    // shell reads this on every authenticated page, so a stale entry must not be fatal.
    const positions = parsePuckPositions("weather:10,20;clock:30,40");
    expect(positions.has("clock")).toBe(true);
    expect(positions.size).toBe(1);
  });

  it("drops a malformed entry rather than throwing", () => {
    const positions = parsePuckPositions("clock;calculator:;:5,5;scratchpad:7,8");
    expect(positions.get("scratchpad")).toEqual({ x: 7, y: 8 });
    expect(positions.size).toBe(1);
  });

  it("drops a non-finite coordinate", () => {
    // What a NaN-propagating drag handler would try to store.
    const positions = parsePuckPositions("clock:NaN,20;calculator:30,abc");
    expect(positions.size).toBe(0);
  });

  it("rounds a fractional coordinate from a scaled display", () => {
    expect(parsePuckPositions("clock:183.4,99.6").get("clock")).toEqual({ x: 183, y: 100 });
  });

  it("lets a later entry win over an earlier one for the same id", () => {
    expect(parsePuckPositions("clock:1,1;clock:9,9").get("clock")).toEqual({ x: 9, y: 9 });
  });
});

describe("serializePuckPositions", () => {
  it("writes in registry order, so a round trip never looks like a change", () => {
    const positions = new Map<FloatingId, PuckPosition>([
      ["scratchpad", { x: 5, y: 6 }],
      ["clock", { x: 1, y: 2 }],
    ]);
    expect(serializePuckPositions(positions)).toBe("clock:1,2;scratchpad:5,6");
  });

  it("writes an empty string when nothing has been dragged", () => {
    expect(serializePuckPositions(new Map())).toBe("");
  });

  it("rounds on the way out, so a drag does not store 183.3999999999999", () => {
    const positions = new Map<FloatingId, PuckPosition>([
      ["clock", { x: 183.3999999999999, y: 10.5 }],
    ]);
    expect(serializePuckPositions(positions)).toBe("clock:183,11");
  });

  it("round-trips through parse unchanged", () => {
    const value = "clock:12,34;calculator:56,78";
    expect(serializePuckPositions(parsePuckPositions(value))).toBe(value);
  });
});

describe("setPuckPosition", () => {
  it("records a position without mutating the map it was given", () => {
    const before = new Map<FloatingId, PuckPosition>([["clock", { x: 1, y: 2 }]]);
    const after = setPuckPosition(before, "clock", { x: 9, y: 9 });
    expect(before.get("clock")).toEqual({ x: 1, y: 2 });
    expect(after.get("clock")).toEqual({ x: 9, y: 9 });
  });

  it("adds a puck that had no position yet", () => {
    const after = setPuckPosition(new Map(), "calculator", { x: 4, y: 5 });
    expect(after.get("calculator")).toEqual({ x: 4, y: 5 });
  });

  it("rounds on the way in", () => {
    const after = setPuckPosition(new Map(), "clock", { x: 1.6, y: 2.2 });
    expect(after.get("clock")).toEqual({ x: 2, y: 2 });
  });
});

describe("clearPuckPosition", () => {
  it("removes the entry, so the puck goes back to its corner", () => {
    const before = new Map<FloatingId, PuckPosition>([
      ["clock", { x: 1, y: 2 }],
      ["calculator", { x: 3, y: 4 }],
    ]);
    const after = clearPuckPosition(before, "clock");
    expect(after.has("clock")).toBe(false);
    expect(after.get("calculator")).toEqual({ x: 3, y: 4 });
    // The input is untouched.
    expect(before.has("clock")).toBe(true);
  });

  it("is a no-op for a puck that was never dragged", () => {
    const after = clearPuckPosition(new Map(), "scratchpad");
    expect(after.size).toBe(0);
  });
});

describe("clampPuckPosition", () => {
  it("leaves a position that is already fully on screen alone", () => {
    expect(clampPuckPosition({ x: 400, y: 300 }, PUCK, ROOM)).toEqual({ x: 400, y: 300 });
  });

  it("never lets the puck go above the viewport top", () => {
    // Unrecoverable in a way the other three edges are not: the puck is its own handle.
    expect(clampPuckPosition({ x: 100, y: -200 }, PUCK, ROOM).y).toBe(0);
  });

  it("keeps a grabbable strip on screen when dragged off the bottom", () => {
    const clamped = clampPuckPosition({ x: 100, y: 5000 }, PUCK, ROOM);
    expect(clamped.y).toBe(ROOM.height - KEEP_PUCK_VISIBLE);
  });

  it("keeps a grabbable strip on screen when dragged off the right", () => {
    const clamped = clampPuckPosition({ x: 5000, y: 100 }, PUCK, ROOM);
    expect(clamped.x).toBe(ROOM.width - KEEP_PUCK_VISIBLE);
  });

  it("keeps a grabbable strip on screen when dragged off the left", () => {
    const clamped = clampPuckPosition({ x: -5000, y: 100 }, PUCK, ROOM);
    expect(clamped.x).toBe(KEEP_PUCK_VISIBLE - PUCK.width);
  });

  it("survives a viewport that shrank under a parked puck", () => {
    // The position was stored on a wide monitor and is being rendered on a laptop.
    const small = { width: 480, height: 640 };
    const clamped = clampPuckPosition({ x: 1500, y: 880 }, PUCK, small);
    expect(clamped.x).toBeLessThanOrEqual(small.width - KEEP_PUCK_VISIBLE);
    expect(clamped.y).toBeLessThanOrEqual(small.height - KEEP_PUCK_VISIBLE);
    expect(clamped.y).toBeGreaterThanOrEqual(0);
  });
});

describe("resolvePuckPositions", () => {
  it("reads the one preference row", () => {
    const byKey = new Map([[FLOATING_POSITIONS_PREFERENCE_KEY, "clock:11,22"]]);
    expect(resolvePuckPositions(byKey).get("clock")).toEqual({ x: 11, y: 22 });
  });

  it("returns nothing for a reader who has never dragged a puck", () => {
    expect(resolvePuckPositions(new Map()).size).toBe(0);
  });
});

describe("resolvePuckSlots with dragged pucks", () => {
  const allMinimized = {
    clock: "minimized",
    calculator: "minimized",
    scratchpad: "minimized",
  } as const;

  it("leaves a dragged puck out of the corner queue entirely", () => {
    const slots = resolvePuckSlots(allMinimized, {}, false, { clock: { x: 10, y: 10 } });
    expect(slots.map((slot) => slot.id)).toEqual(["calculator", "scratchpad"]);
  });

  it("closes the gap a dragged puck leaves, rather than holding its slot", () => {
    // The regression this guards: skipping by filtering the *output* would leave
    // calculator at index 1 with nothing at index 0, a visible hole above the corner.
    const slots = resolvePuckSlots(allMinimized, {}, false, { clock: { x: 10, y: 10 } });
    expect(slots.find((slot) => slot.id === "calculator")?.index).toBe(0);
    expect(slots.find((slot) => slot.id === "scratchpad")?.index).toBe(1);
  });

  it("still queues every puck when none has been dragged", () => {
    const slots = resolvePuckSlots(allMinimized, {}, false);
    expect(slots.map((slot) => slot.index)).toEqual([0, 1, 2]);
  });

  it("still reserves the music puck's slot for the pucks that remain docked", () => {
    const slots = resolvePuckSlots(allMinimized, {}, true, { clock: { x: 10, y: 10 } });
    expect(slots.find((slot) => slot.id === "calculator")?.index).toBe(1);
  });
});
