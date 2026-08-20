import { describe, expect, it } from "vitest";
import { shuffle } from "./random";

// Pure, so tested directly with plain inputs and an injected rng. These cases moved here
// with `shuffle` itself when the play queue became its second caller -- they were written
// against music-magic/generate.ts and are unchanged.

/** An rng that never shuffles: returns 0, so Fisher-Yates swaps each item with index 0. */
const zeroRandom = () => 0;

/**
 * A deterministic rng cycling a fixed sequence.
 *
 * A fake rather than a seeded PRNG library: the only property the tests need is
 * repeatability, and a cycled sequence gives that with nothing to install.
 */
function sequenceRandom(values: readonly number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length] as number;
    index += 1;
    return value;
  };
}

describe("shuffle", () => {
  it("keeps every item exactly once", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = shuffle(items, sequenceRandom([0.1, 0.9, 0.4, 0.7, 0.2, 0.5]));
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
  });

  it("does not modify the input", () => {
    const items = [1, 2, 3];
    shuffle(items, sequenceRandom([0.5]));
    expect(items).toEqual([1, 2, 3]);
  });

  it("is deterministic for a given rng", () => {
    const items = [1, 2, 3, 4, 5];
    const first = shuffle(items, sequenceRandom([0.3, 0.8, 0.1, 0.6]));
    const second = shuffle(items, sequenceRandom([0.3, 0.8, 0.1, 0.6]));
    expect(first).toEqual(second);
  });

  it("survives an rng that returns 1, which would index off the end", () => {
    // Math.random never returns 1, but an injected source might, and an unclamped
    // implementation would leave `undefined` holes in the array.
    const shuffled = shuffle([1, 2, 3, 4], () => 1);
    expect(shuffled).toHaveLength(4);
    expect(shuffled.every((entry) => entry !== undefined)).toBe(true);
  });

  it("returns an empty array for no items", () => {
    expect(shuffle([], zeroRandom)).toEqual([]);
  });
});
