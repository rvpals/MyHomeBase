import { describe, expect, it } from "vitest";
import { PRUNE_INTERVAL_MINUTES, shouldPruneNow } from "./prune-runner";

// `runAuthEventPruneNow` itself resolves `deps` at module scope, so the pure
// interval decision is what's worth testing here -- and it's the part that changed
// behaviour: the job used to prune on every boot regardless of when it last ran.

const DAY_MS = PRUNE_INTERVAL_MINUTES * 60_000;
const NOW = Date.parse("2026-08-26T04:00:00Z");

describe("shouldPruneNow", () => {
  it("prunes when it has never run", () => {
    expect(shouldPruneNow(undefined, NOW)).toBe(true);
  });

  it("prunes once a full day has elapsed", () => {
    expect(shouldPruneNow(NOW - DAY_MS, NOW)).toBe(true);
  });

  it("does not prune again on a restart minutes later", () => {
    // The regression this constant exists to prevent: `start.sh` restarts the
    // process on every deploy and after any crash, and the startup pass must not
    // read that as a new day.
    expect(shouldPruneNow(NOW - 5 * 60_000, NOW)).toBe(false);
  });

  it("does not prune a second before it is due", () => {
    expect(shouldPruneNow(NOW - DAY_MS + 1_000, NOW)).toBe(false);
  });
});
