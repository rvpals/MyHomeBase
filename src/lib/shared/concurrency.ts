// A tiny "at most N at once" gate for async work.
//
// Written for the photo thumbnail route: building a thumbnail from an original means a
// multi-megabyte read over an SMB share, and Node runs file reads on a pool of only four
// threads. A burst of strip thumbnails would otherwise take every one of them and leave
// the main photograph and the EXIF lookup queued behind work the reader cares less about.
//
// Generic on purpose -- nothing here knows about photos -- so it lives in `shared/`.

/** Runs `task` once a slot is free, and resolves or rejects with its result. */
export type ConcurrencyLimit = <T>(task: () => Promise<T>) => Promise<T>;

/**
 * A gate that lets at most `max` tasks run at the same time; the rest wait in order.
 *
 * A task that throws still frees its slot, so one failing read cannot wedge the gate.
 * `max` below 1 is treated as 1 -- a gate that admits nothing would hang every caller.
 */
export function createConcurrencyLimit(max: number): ConcurrencyLimit {
  const capacity = Math.max(1, Math.floor(max));
  let running = 0;
  const waiting: (() => void)[] = [];

  const release = () => {
    running -= 1;
    const next = waiting.shift();
    if (next !== undefined) next();
  };

  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= capacity) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    running += 1;
    try {
      return await task();
    } finally {
      release();
    }
  };
}
