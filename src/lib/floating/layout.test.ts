import { describe, expect, it } from "vitest";
import {
  closeState,
  effectiveState,
  minimizeState,
  resolvePuckSlots,
  restoreState,
} from "./layout";

describe("resolvePuckSlots", () => {
  it("returns nothing when no component is minimized", () => {
    expect(resolvePuckSlots({ clock: "open" }, {}, false)).toEqual([]);
    expect(resolvePuckSlots({ clock: "closed" }, {}, false)).toEqual([]);
    expect(resolvePuckSlots({}, {}, false)).toEqual([]);
  });

  it("parks a lone minimized puck in the corner, defaulting to bottom-right", () => {
    expect(resolvePuckSlots({ clock: "minimized" }, {}, false)).toEqual([
      { id: "clock", index: 0, corner: "bottom-right" },
    ]);
  });

  it("honours the reader's chosen corner", () => {
    expect(
      resolvePuckSlots({ clock: "minimized" }, { clock: "top-left" }, false),
    ).toEqual([{ id: "clock", index: 0, corner: "top-left" }]);
  });

  it("queues behind the music puck when the player is minimized too", () => {
    // The collision this function exists for: the music player already owns the
    // bottom-right corner at index 0, so a puck docked there must sit one step out.
    expect(resolvePuckSlots({ clock: "minimized" }, {}, true)).toEqual([
      { id: "clock", index: 1, corner: "bottom-right" },
    ]);
  });

  it("does NOT make room for the music puck in another corner", () => {
    // The point of per-corner stacking: the music puck only occupies bottom-right, so
    // a puck the reader docked elsewhere should sit flush in its own corner.
    expect(
      resolvePuckSlots({ clock: "minimized" }, { clock: "bottom-left" }, true),
    ).toEqual([{ id: "clock", index: 0, corner: "bottom-left" }]);
  });

  it("takes the corner when music is playing but not minimized", () => {
    // A pinned player bar claims height on the bottom edge, not the corner — the CSS
    // reads `--music-player-height` for that, so it costs no slot here.
    expect(resolvePuckSlots({ clock: "minimized" }, {}, false)).toEqual([
      { id: "clock", index: 0, corner: "bottom-right" },
    ]);
  });

  it("stacks two pucks sharing a corner", () => {
    const slots = resolvePuckSlots(
      { clock: "minimized", calculator: "minimized" },
      { clock: "bottom-right", calculator: "bottom-right" },
      false,
    );
    expect(slots.map((slot) => slot.index)).toEqual([0, 1]);
  });

  it("gives each corner its own queue, so two pucks in different corners both sit flush", () => {
    const slots = resolvePuckSlots(
      { clock: "minimized", calculator: "minimized" },
      { clock: "bottom-right", calculator: "top-left" },
      false,
    );
    expect(slots).toEqual([
      { id: "clock", index: 0, corner: "bottom-right" },
      { id: "calculator", index: 0, corner: "top-left" },
    ]);
  });

  it("stacks in registry order, not in the order they were minimized", () => {
    // A puck that moves on its own is harder to hit than one that is simply further
    // from the corner, so the order is stable whatever the reader did first.
    const slots = resolvePuckSlots(
      { calculator: "minimized", clock: "minimized" },
      {},
      false,
    );
    expect(slots.map((slot) => slot.id)).toEqual(["clock", "calculator"]);
  });
});

describe("the state transitions", () => {
  it("minimizes only from open", () => {
    expect(minimizeState("open")).toBe("minimized");
    // A stale click on a component that just closed must not resurrect it.
    expect(minimizeState("closed")).toBe("closed");
    expect(minimizeState("minimized")).toBe("minimized");
  });

  it("restores only from minimized", () => {
    expect(restoreState("minimized")).toBe("open");
    expect(restoreState("closed")).toBe("closed");
    expect(restoreState("open")).toBe("open");
  });

  it("closes from anywhere", () => {
    expect(closeState()).toBe("closed");
  });
});

describe("effectiveState", () => {
  it("passes the stored state through while the component is enabled", () => {
    expect(effectiveState("open", true)).toBe("open");
    expect(effectiveState("minimized", true)).toBe("minimized");
    expect(effectiveState("closed", true)).toBe("closed");
  });

  it("forces closed when an admin has disabled the component", () => {
    // "Disabled" has to mean disabled for everyone, including the reader who had it
    // open — otherwise the switch only affects people who never used it.
    expect(effectiveState("open", false)).toBe("closed");
    expect(effectiveState("minimized", false)).toBe("closed");
  });
});
