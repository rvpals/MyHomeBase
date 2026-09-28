import { describe, expect, it } from "vitest";

import { movePlaylistEntry } from "./move-playlist-entry";

describe("movePlaylistEntry", () => {
  it("moves an entry up one place", () => {
    expect(movePlaylistEntry([10, 20, 30], 20, "up")).toEqual([20, 10, 30]);
  });

  it("moves an entry down one place", () => {
    expect(movePlaylistEntry([10, 20, 30], 20, "down")).toEqual([10, 30, 20]);
  });

  it("leaves the first entry alone when moved up", () => {
    expect(movePlaylistEntry([10, 20, 30], 10, "up")).toEqual([10, 20, 30]);
  });

  it("leaves the last entry alone when moved down", () => {
    expect(movePlaylistEntry([10, 20, 30], 30, "down")).toEqual([10, 20, 30]);
  });

  it("returns the list unchanged for an id that is not in it", () => {
    expect(movePlaylistEntry([10, 20, 30], 999, "up")).toEqual([10, 20, 30]);
  });

  it("handles a single-entry list in both directions", () => {
    expect(movePlaylistEntry([10], 10, "up")).toEqual([10]);
    expect(movePlaylistEntry([10], 10, "down")).toEqual([10]);
  });

  it("handles an empty list", () => {
    expect(movePlaylistEntry([], 10, "up")).toEqual([]);
  });

  it("moves only the copy that was asked for when a track appears twice", () => {
    // Entry ids are distinct even when the underlying track is the same, so the
    // two copies move independently.
    expect(movePlaylistEntry([10, 20, 30, 40], 30, "up")).toEqual([10, 30, 20, 40]);
  });

  it("does not mutate the list it was given", () => {
    const original = [10, 20, 30];
    const moved = movePlaylistEntry(original, 20, "up");
    expect(original).toEqual([10, 20, 30]);
    expect(moved).not.toBe(original);
  });
});
