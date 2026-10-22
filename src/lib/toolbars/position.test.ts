import { describe, expect, it } from "vitest";
import {
  clampToolbarPosition,
  clearToolbarPosition,
  KEEP_TOOLBAR_VISIBLE,
  parseToolbarPositions,
  serializeToolbarPositions,
  setToolbarPosition,
  type ToolbarPosition,
} from "./position";

/** A viewport big enough that nothing clamps unless a test means it to. */
const ROOM = { width: 1600, height: 900 };
/** A typical floating bar: a row of a few 36px shortcuts. */
const BAR = { width: 240, height: 44 };

describe("parseToolbarPositions", () => {
  it("reads a semicolon-separated list keyed by toolbar id", () => {
    const positions = parseToolbarPositions("1:100,200;4:10,20");
    expect(positions.get(1)).toEqual({ x: 100, y: 200 });
    expect(positions.get(4)).toEqual({ x: 10, y: 20 });
    expect(positions.size).toBe(2);
  });

  it("reads no row as no saved positions, so every bar opens at its default", () => {
    expect(parseToolbarPositions(undefined).size).toBe(0);
    expect(parseToolbarPositions("").size).toBe(0);
  });

  it("keeps a stored zero, which is a real position and not an absent one", () => {
    // The trap this guards: `if (!x)` would discard a bar parked hard against the
    // left edge or the top of the viewport.
    expect(parseToolbarPositions("2:0,0").get(2)).toEqual({ x: 0, y: 0 });
  });

  it("keeps a negative x, which is a bar deliberately overhanging the left edge", () => {
    expect(parseToolbarPositions("2:-80,30").get(2)).toEqual({ x: -80, y: 30 });
  });

  it("drops a stale or malformed entry rather than throwing", () => {
    // A deleted toolbar leaves its id in every reader's row, and a truncated value
    // must not be able to take the shell down — the one screen you would go to in
    // order to fix it.
    const positions = parseToolbarPositions(
      "1:10,20;nonsense;2:abc,5;0:1,1;-3:1,1;4:7;;5:1,2",
    );
    expect([...positions.keys()].sort((a, b) => a - b)).toEqual([1, 5]);
  });

  it("drops a non-finite coordinate", () => {
    expect(parseToolbarPositions("1:Infinity,5").size).toBe(0);
    expect(parseToolbarPositions("1:5,NaN").size).toBe(0);
  });

  it("rounds a fractional coordinate from a scaled display", () => {
    expect(parseToolbarPositions("1:183.4,20.6").get(1)).toEqual({ x: 183, y: 21 });
  });

  it("lets a later entry win over an earlier one for the same id", () => {
    expect(parseToolbarPositions("1:10,10;1:99,99").get(1)).toEqual({ x: 99, y: 99 });
  });
});

describe("serializeToolbarPositions", () => {
  it("writes sorted by id, so a round trip never looks like a change", () => {
    const positions = new Map<number, ToolbarPosition>([
      [4, { x: 10, y: 20 }],
      [1, { x: 100, y: 200 }],
    ]);
    expect(serializeToolbarPositions(positions)).toBe("1:100,200;4:10,20");
    expect(parseToolbarPositions(serializeToolbarPositions(positions))).toEqual(positions);
  });

  it("writes an empty string when nothing has been dragged", () => {
    expect(serializeToolbarPositions(new Map())).toBe("");
  });

  it("rounds on the way out, so a drag does not store 183.3999999999999", () => {
    const positions = new Map([[1, { x: 183.3999999999999, y: 20.5 }]]);
    expect(serializeToolbarPositions(positions)).toBe("1:183,21");
  });
});

describe("setToolbarPosition", () => {
  it("records a position without mutating the map it was given", () => {
    const before = new Map<number, ToolbarPosition>([[1, { x: 0, y: 0 }]]);
    const after = setToolbarPosition(before, 1, { x: 50, y: 60 });

    expect(after.get(1)).toEqual({ x: 50, y: 60 });
    // The caller writes one preference key from the returned value; mutating in
    // place would let a stale tab clobber an unrelated preference.
    expect(before.get(1)).toEqual({ x: 0, y: 0 });
  });

  it("adds a toolbar that had no position yet", () => {
    const after = setToolbarPosition(new Map(), 7, { x: 5, y: 5 });
    expect(after.get(7)).toEqual({ x: 5, y: 5 });
  });
});

describe("clearToolbarPosition", () => {
  it("removes the entry, so the bar goes back to the renderer's default", () => {
    const before = new Map<number, ToolbarPosition>([
      [1, { x: 10, y: 10 }],
      [2, { x: 20, y: 20 }],
    ]);
    const after = clearToolbarPosition(before, 1);

    expect(after.has(1)).toBe(false);
    expect(after.get(2)).toEqual({ x: 20, y: 20 });
    expect(before.has(1)).toBe(true);
  });

  it("is a no-op for a toolbar that was never dragged", () => {
    expect(clearToolbarPosition(new Map(), 9).size).toBe(0);
  });
});

describe("clampToolbarPosition", () => {
  it("leaves a position that is already fully on screen alone", () => {
    expect(clampToolbarPosition({ x: 300, y: 400 }, BAR, ROOM)).toEqual({ x: 300, y: 400 });
  });

  it("never lets the bar go above the viewport top", () => {
    // The bar is its own drag handle, so losing it upward is unrecoverable in a way
    // losing the bottom edge is not.
    expect(clampToolbarPosition({ x: 300, y: -200 }, BAR, ROOM).y).toBe(0);
  });

  it("keeps a grabbable strip on screen when dragged off the bottom", () => {
    expect(clampToolbarPosition({ x: 300, y: 5000 }, BAR, ROOM).y).toBe(
      ROOM.height - KEEP_TOOLBAR_VISIBLE,
    );
  });

  it("keeps a grabbable strip on screen when dragged off the right", () => {
    expect(clampToolbarPosition({ x: 5000, y: 100 }, BAR, ROOM).x).toBe(
      ROOM.width - KEEP_TOOLBAR_VISIBLE,
    );
  });

  it("allows a deliberate left overhang, down to the grabbable strip", () => {
    // Horizontal is asymmetric with vertical on purpose: a wide bar on a narrow
    // screen genuinely does not fit, and snapping it flush left would put its
    // right-hand shortcuts permanently out of reach.
    expect(clampToolbarPosition({ x: -5000, y: 100 }, BAR, ROOM).x).toBe(
      KEEP_TOOLBAR_VISIBLE - BAR.width,
    );
  });

  it("prefers the left overhang when the bar is wider than the viewport", () => {
    // minX > maxX here — an empty range — and the first shortcuts on the bar are
    // the ones worth keeping reachable.
    const narrow = { width: 320, height: 640 };
    const wide = { width: 900, height: 44 };
    expect(clampToolbarPosition({ x: 0, y: 10 }, wide, narrow).x).toBe(
      narrow.width - KEEP_TOOLBAR_VISIBLE,
    );
  });

  it("survives a viewport that shrank under a parked bar", () => {
    // The case the clamp exists for: dragged on a desktop, reopened on a phone.
    const phone = { width: 390, height: 844 };
    const clamped = clampToolbarPosition({ x: 1200, y: 700 }, BAR, phone);
    expect(clamped.x).toBeLessThanOrEqual(phone.width - KEEP_TOOLBAR_VISIBLE);
    expect(clamped.y).toBeLessThanOrEqual(phone.height - KEEP_TOOLBAR_VISIBLE);
    expect(clamped.y).toBeGreaterThanOrEqual(0);
  });
});
