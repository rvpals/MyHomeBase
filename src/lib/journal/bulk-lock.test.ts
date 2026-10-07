import { describe, expect, it } from "vitest";
import { bulkSetEntriesLocked, describeBulkLockResult } from "./bulk-lock";
import type { BulkEntryLockOutcome, JournalRepository } from "./index";

/**
 * A fake standing in for the one repository method this use-case calls.
 *
 * `bulkSetEntriesLocked` in `lib` is validation and count-reporting over a
 * single repository call, so what these tests pin down is that contract: what
 * reaches SQL, and what the reported counts mean.
 *
 * `stored` is the lock state the "database" holds for each id. An id absent from
 * the map is an entry that no longer exists, which is how the missing case is
 * expressed without a database.
 */
function fakeRepo(stored: Record<number, boolean>) {
  const calls: { ids: number[]; isLocked: boolean }[] = [];

  const repo = {
    bulkSetEntriesLocked: (ids: number[], isLocked: boolean): BulkEntryLockOutcome => {
      calls.push({ ids, isLocked });
      const outcome: BulkEntryLockOutcome = { changedIds: [], unchangedIds: [], missingIds: [] };
      for (const id of ids) {
        if (!(id in stored)) outcome.missingIds.push(id);
        else if (stored[id] === isLocked) outcome.unchangedIds.push(id);
        else outcome.changedIds.push(id);
      }
      return outcome;
    },
  } as unknown as JournalRepository;

  return { repo, calls };
}

describe("bulkSetEntriesLocked", () => {
  it("locks every selected entry and reports the count", () => {
    const { repo, calls } = fakeRepo({ 1: false, 2: false, 3: false });

    const result = bulkSetEntriesLocked(repo, [1, 2, 3], true);

    expect(result).toEqual({
      isLocked: true,
      changedCount: 3,
      unchangedCount: 0,
      missingCount: 0,
    });
    expect(calls).toEqual([{ ids: [1, 2, 3], isLocked: true }]);
  });

  it("unlocks when asked to, rather than toggling each row", () => {
    // The mixed selection is the point: a toggle would lock 2 while unlocking 1
    // and 3, which no button label could honestly describe.
    const { repo } = fakeRepo({ 1: true, 2: false, 3: true });

    const result = bulkSetEntriesLocked(repo, [1, 2, 3], false);

    expect(result).toEqual({
      isLocked: false,
      changedCount: 2,
      unchangedCount: 1,
      missingCount: 0,
    });
  });

  it("writes locked entries instead of skipping them, unlike a bulk edit", () => {
    // Changing the lock *is* the operation here, so an already-locked row being
    // unlocked must count as a change. If this ever reports 0, the lock has
    // become a trap with no key.
    const { repo } = fakeRepo({ 1: true, 2: true });

    expect(bulkSetEntriesLocked(repo, [1, 2], false).changedCount).toBe(2);
  });

  it("counts rows already in the requested state separately from writes", () => {
    const { repo } = fakeRepo({ 1: true, 2: false });

    const result = bulkSetEntriesLocked(repo, [1, 2], true);

    expect(result.changedCount).toBe(1);
    expect(result.unchangedCount).toBe(1);
  });

  it("reports ids that no longer exist separately", () => {
    const { repo } = fakeRepo({ 1: false });

    const result = bulkSetEntriesLocked(repo, [1, 2, 3], true);

    expect(result).toEqual({
      isLocked: true,
      changedCount: 1,
      unchangedCount: 0,
      missingCount: 2,
    });
  });

  it("de-dupes the selection so a double-submitted id isn't counted twice", () => {
    const { repo, calls } = fakeRepo({ 1: false, 2: false });

    const result = bulkSetEntriesLocked(repo, [1, 1, 2, 2, 2], true);

    expect(calls[0].ids).toEqual([1, 2]);
    expect(result.changedCount).toBe(2);
  });

  it("refuses an empty selection rather than reporting a silent no-op", () => {
    const { repo } = fakeRepo({});

    expect(() => bulkSetEntriesLocked(repo, [], true)).toThrow(/Select at least one entry/);
  });

  it("refuses ids that aren't positive integers", () => {
    const { repo, calls } = fakeRepo({ 1: false });

    expect(() => bulkSetEntriesLocked(repo, [1, -4], true)).toThrow();
    expect(calls).toEqual([]);
  });
});

describe("describeBulkLockResult", () => {
  it("names the direction of the change", () => {
    expect(
      describeBulkLockResult({
        isLocked: true,
        changedCount: 4,
        unchangedCount: 0,
        missingCount: 0,
      }),
    ).toBe("Locked 4 entries.");
    expect(
      describeBulkLockResult({
        isLocked: false,
        changedCount: 4,
        unchangedCount: 0,
        missingCount: 0,
      }),
    ).toBe("Unlocked 4 entries.");
  });

  it("uses the singular for one entry", () => {
    expect(
      describeBulkLockResult({
        isLocked: true,
        changedCount: 1,
        unchangedCount: 0,
        missingCount: 0,
      }),
    ).toBe("Locked 1 entry.");
  });

  it("explains a short count rather than leaving it a mystery", () => {
    expect(
      describeBulkLockResult({
        isLocked: true,
        changedCount: 2,
        unchangedCount: 3,
        missingCount: 1,
      }),
    ).toBe("Locked 2 entries. 3 were already locked. 1 no longer exists.");
  });

  it("phrases 'already' to match the direction", () => {
    expect(
      describeBulkLockResult({
        isLocked: false,
        changedCount: 0,
        unchangedCount: 1,
        missingCount: 0,
      }),
    ).toBe("Unlocked 0 entries. 1 was already unlocked.");
  });
});
