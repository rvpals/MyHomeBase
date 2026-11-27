import { describe, expect, it } from "vitest";
import { isChecklistClip, isDrawingClip } from "./kinds";
import type { ClipItem } from "./types";

const ITEM: ClipItem = {
  id: 1,
  clipId: 1,
  text: "milk",
  isDone: false,
  sortOrder: 0,
  createdAt: "2026-10-25 10:00:00",
};

describe("isDrawingClip", () => {
  it("is true when the summary carries a drawing", () => {
    expect(isDrawingClip({ drawingImageId: 7 })).toBe(true);
  });

  it("is false when there is no drawing (or it is sealed, which hides it)", () => {
    expect(isDrawingClip({ drawingImageId: undefined })).toBe(false);
  });
});

describe("isChecklistClip", () => {
  it("is true with at least one line, even if every line is ticked", () => {
    expect(isChecklistClip({ items: [ITEM] })).toBe(true);
    expect(isChecklistClip({ items: [{ ...ITEM, isDone: true }] })).toBe(true);
  });

  it("is false with no lines", () => {
    expect(isChecklistClip({ items: [] })).toBe(false);
  });
});
