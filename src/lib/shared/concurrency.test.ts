import { describe, expect, it } from "vitest";
import { createConcurrencyLimit } from "./concurrency";

/** A promise plus the handles to settle it from the test. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets queued microtasks (the gate's hand-offs) run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createConcurrencyLimit", () => {
  it("never runs more than `max` tasks at once, and starts the rest in order", async () => {
    const limit = createConcurrencyLimit(2);
    const gates = [deferred(), deferred(), deferred(), deferred()];
    const started: number[] = [];
    let running = 0;
    let peak = 0;

    const results = gates.map((gate, index) =>
      limit(async () => {
        started.push(index);
        running += 1;
        peak = Math.max(peak, running);
        await gate.promise;
        running -= 1;
        return index;
      }),
    );

    await flush();
    expect(started).toEqual([0, 1]);

    gates[0].resolve();
    await flush();
    expect(started).toEqual([0, 1, 2]);

    gates[1].resolve();
    gates[2].resolve();
    gates[3].resolve();
    expect(await Promise.all(results)).toEqual([0, 1, 2, 3]);
    expect(peak).toBe(2);
  });

  it("frees the slot when a task throws, and passes the error to its caller", async () => {
    const limit = createConcurrencyLimit(1);

    await expect(limit(async () => Promise.reject(new Error("share dropped")))).rejects.toThrow(
      "share dropped",
    );
    // Would hang forever if the failed task had kept the only slot.
    await expect(limit(async () => "next")).resolves.toBe("next");
  });

  it("treats a max below 1 as 1 rather than admitting nothing", async () => {
    const limit = createConcurrencyLimit(0);
    await expect(limit(async () => 42)).resolves.toBe(42);
  });
});
