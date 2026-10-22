import { describe, expect, it } from "vitest";
import { groupDuplicates } from "./group";
import type { ScoredPhoto } from "./types";

function scored(name: string, hash: string, score: number): ScoredPhoto {
  return {
    relativePath: `2019/2019-06/${name}`,
    name,
    hash,
    score,
    reason: "sharp, well exposed, good contrast",
    width: 4000,
    height: 3000,
    metrics: {
      sharpness: 100,
      centerSharpness: 100,
      brightness: 128,
      contrast: 50,
      shadowClipping: 0,
      highlightClipping: 0,
    },
  };
}

/** A hash differing from all-zeroes in exactly `bits` bits. */
function hashWithBits(bits: number): string {
  // Each 'f' nibble contributes 4 bits, each '1' contributes 1.
  const full = Math.floor(bits / 4);
  const remainder = bits % 4;
  const remainderNibble = remainder === 0 ? "" : [, "1", "3", "7"][remainder];
  return ("f".repeat(full) + remainderNibble).padEnd(16, "0");
}

describe("groupDuplicates", () => {
  it("groups two identical hashes together", () => {
    const groups = groupDuplicates([
      scored("a.jpg", "0".repeat(16), 0.9),
      scored("b.jpg", "0".repeat(16), 0.4),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].duplicates).toHaveLength(1);
  });

  it("keeps the highest-scoring image as the representative", () => {
    const groups = groupDuplicates([
      scored("worse.jpg", "0".repeat(16), 0.4),
      scored("better.jpg", "0".repeat(16), 0.9),
    ]);
    expect(groups[0].representative.name).toBe("better.jpg");
    expect(groups[0].duplicates[0].name).toBe("worse.jpg");
  });

  it("leaves genuinely different images in separate groups", () => {
    const groups = groupDuplicates([
      scored("a.jpg", "0".repeat(16), 0.9),
      scored("b.jpg", "f".repeat(16), 0.8),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.duplicates.length === 0)).toBe(true);
  });

  it("groups images exactly at the threshold", () => {
    const groups = groupDuplicates(
      [scored("a.jpg", "0".repeat(16), 0.9), scored("b.jpg", hashWithBits(10), 0.5)],
      10,
    );
    expect(groups).toHaveLength(1);
  });

  it("does not group images one bit beyond the threshold", () => {
    const groups = groupDuplicates(
      [scored("a.jpg", "0".repeat(16), 0.9), scored("b.jpg", hashWithBits(11), 0.5)],
      10,
    );
    expect(groups).toHaveLength(2);
  });

  it("honours a tightened threshold", () => {
    const photos = [scored("a.jpg", "0".repeat(16), 0.9), scored("b.jpg", hashWithBits(6), 0.5)];
    expect(groupDuplicates(photos, 10)).toHaveLength(1);
    expect(groupDuplicates(photos, 2)).toHaveLength(2);
  });

  it("chains a drifting burst into one group, even across the threshold end to end", () => {
    // a..b and b..c are each within 6 bits, but a..c is 12 -- beyond the threshold.
    // Transitive grouping must still treat the burst as one set.
    const groups = groupDuplicates(
      [
        scored("a.jpg", "0".repeat(16), 0.5),
        scored("b.jpg", "f0".padEnd(16, "0"), 0.9),
        scored("c.jpg", "ff0".padEnd(16, "0"), 0.4),
      ],
      6,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].representative.name).toBe("b.jpg");
    expect(groups[0].duplicates).toHaveLength(2);
  });

  it("orders groups by their representative's score", () => {
    const groups = groupDuplicates([
      scored("low.jpg", "0".repeat(16), 0.2),
      scored("high.jpg", "f".repeat(16), 0.95),
    ]);
    expect(groups[0].representative.name).toBe("high.jpg");
  });

  it("returns nothing for an empty batch", () => {
    expect(groupDuplicates([])).toEqual([]);
  });
});
