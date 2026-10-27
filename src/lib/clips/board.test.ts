import { describe, expect, it } from "vitest";
import { buildClipBoard, buildClipItemBoard, dealClipsIntoColumns } from "./board";
import type { ClipItem, ClipSummary } from "./types";

function item(overrides: Partial<ClipItem> & { id: number }): ClipItem {
  return {
    clipId: 1,
    text: `item ${overrides.id}`,
    isDone: false,
    sortOrder: 0,
    createdAt: "2026-10-25 10:00:00",
    ...overrides,
  };
}

function clip(overrides: Partial<ClipSummary> & { id: number }): ClipSummary {
  return {
    title: `clip ${overrides.id}`,
    excerpt: "",
    isEncrypted: false,
    isPinned: false,
    color: "",
    categories: [],
    tags: [],
    items: [],
    imageCount: 0,
    linkCount: 0,
    createdAt: "2026-10-25 10:00:00",
    updatedAt: "2026-10-25 10:00:00",
    ...overrides,
  };
}

describe("buildClipItemBoard", () => {
  it("keeps outstanding items in the writer's arrangement", () => {
    const board = buildClipItemBoard([
      item({ id: 3, sortOrder: 2 }),
      item({ id: 1, sortOrder: 0 }),
      item({ id: 2, sortOrder: 1 }),
    ]);

    expect(board.open.map((i) => i.id)).toEqual([1, 2, 3]);
    expect(board.done).toEqual([]);
  });

  it("orders completed items most recently ticked first, ignoring sortOrder", () => {
    // sortOrder deliberately disagrees with doneAt: once ticked, position in the
    // list stops mattering and the tick time is the only predictable ordering.
    const board = buildClipItemBoard([
      item({ id: 1, sortOrder: 0, isDone: true, doneAt: "2026-10-20T09:00:00Z" }),
      item({ id: 2, sortOrder: 1, isDone: true, doneAt: "2026-10-24T09:00:00Z" }),
      item({ id: 3, sortOrder: 2, isDone: true, doneAt: "2026-10-22T09:00:00Z" }),
    ]);

    expect(board.done.map((i) => i.id)).toEqual([2, 3, 1]);
  });

  it("splits the two halves apart", () => {
    const board = buildClipItemBoard([
      item({ id: 1, sortOrder: 0 }),
      item({ id: 2, sortOrder: 1, isDone: true, doneAt: "2026-10-24T09:00:00Z" }),
    ]);

    expect(board.open.map((i) => i.id)).toEqual([1]);
    expect(board.done.map((i) => i.id)).toEqual([2]);
  });

  it("sorts a done item with no timestamp last rather than throwing", () => {
    // A row hand-edited in the database, or written before the column existed. A
    // cosmetic defect in one row is not a reason to refuse to draw a board.
    const board = buildClipItemBoard([
      item({ id: 1, isDone: true, doneAt: undefined }),
      item({ id: 2, isDone: true, doneAt: "2026-10-24T09:00:00Z" }),
    ]);

    expect(board.done.map((i) => i.id)).toEqual([2, 1]);
  });

  it("returns two empty halves for a clip with no checklist", () => {
    expect(buildClipItemBoard([])).toEqual({ open: [], done: [] });
  });
});

describe("buildClipBoard", () => {
  it("splits the pinned band from the rest", () => {
    const board = buildClipBoard([
      clip({ id: 1, isPinned: true }),
      clip({ id: 2 }),
      clip({ id: 3, isPinned: true }),
    ]);

    expect(board.pinned.map((c) => c.id)).toEqual([1, 3]);
    expect(board.rest.map((c) => c.id)).toEqual([2]);
  });

  it("preserves the order it was given, within each half", () => {
    // Ordering lives in one ORDER BY so the list and the board cannot disagree —
    // this function partitions and must never re-sort.
    const board = buildClipBoard([
      clip({ id: 9, isPinned: true }),
      clip({ id: 4, isPinned: true }),
      clip({ id: 7 }),
      clip({ id: 2 }),
    ]);

    expect(board.pinned.map((c) => c.id)).toEqual([9, 4]);
    expect(board.rest.map((c) => c.id)).toEqual([7, 2]);
  });

  it("gives an empty pinned band when nothing is pinned", () => {
    const board = buildClipBoard([clip({ id: 1 }), clip({ id: 2 })]);
    expect(board.pinned).toEqual([]);
    expect(board.rest).toHaveLength(2);
  });

  it("handles an empty list", () => {
    expect(buildClipBoard([])).toEqual({ pinned: [], rest: [] });
  });
});

describe("dealClipsIntoColumns", () => {
  it("deals equal-height clips left to right", () => {
    // With all heights equal this must degenerate to round-robin, which is the
    // reading order a card board implies.
    const columns = dealClipsIntoColumns(
      [clip({ id: 1 }), clip({ id: 2 }), clip({ id: 3 }), clip({ id: 4 })],
      2,
    );

    expect(columns[0].map((c) => c.id)).toEqual([1, 3]);
    expect(columns[1].map((c) => c.id)).toEqual([2, 4]);
  });

  it("puts a short clip beside a tall one rather than under it", () => {
    const tall = clip({ id: 1, excerpt: "x".repeat(800) });
    const columns = dealClipsIntoColumns([tall, clip({ id: 2 }), clip({ id: 3 })], 2);

    // The tall clip takes column one alone; both short ones fit beside it.
    expect(columns[0].map((c) => c.id)).toEqual([1]);
    expect(columns[1].map((c) => c.id)).toEqual([2, 3]);
  });

  it("counts a collapsed completed group as one row, not many", () => {
    // Forty ticked items collapse to a single "N completed" row, so a clip holding
    // them must not be estimated as forty lines tall.
    const manyDone = clip({
      id: 1,
      items: Array.from({ length: 40 }, (_, i) =>
        item({ id: i + 1, isDone: true, doneAt: "2026-10-24T09:00:00Z" }),
      ),
    });
    const columns = dealClipsIntoColumns([manyDone, clip({ id: 2 })], 2);

    // Still roughly the same height as a bare clip, so the two sit side by side.
    expect(columns[0].map((c) => c.id)).toEqual([1]);
    expect(columns[1].map((c) => c.id)).toEqual([2]);
  });

  it("returns the asked-for number of columns even when some are empty", () => {
    // A caller rendering four columns with three clips needs four arrays, or the
    // grid's widths shift.
    const columns = dealClipsIntoColumns([clip({ id: 1 })], 4);

    expect(columns).toHaveLength(4);
    expect(columns[0].map((c) => c.id)).toEqual([1]);
    expect(columns.slice(1).every((column) => column.length === 0)).toBe(true);
  });

  it("falls back to one column when asked for a nonsensical count", () => {
    // Layout, not data integrity: refusing to draw is a worse answer than drawing
    // a single column.
    for (const count of [0, -3]) {
      const columns = dealClipsIntoColumns([clip({ id: 1 }), clip({ id: 2 })], count);
      expect(columns).toHaveLength(1);
      expect(columns[0]).toHaveLength(2);
    }
  });

  it("loses no clips, whatever the column count", () => {
    const clips = Array.from({ length: 23 }, (_, i) =>
      clip({ id: i + 1, excerpt: "x".repeat((i % 7) * 60) }),
    );

    for (const count of [1, 2, 3, 4, 10]) {
      const dealt = dealClipsIntoColumns(clips, count).flat();
      expect(dealt).toHaveLength(clips.length);
      expect(new Set(dealt.map((c) => c.id)).size).toBe(clips.length);
    }
  });

  it("handles an empty board", () => {
    expect(dealClipsIntoColumns([], 3)).toEqual([[], [], []]);
  });
});
