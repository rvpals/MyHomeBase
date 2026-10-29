import { beforeEach, describe, expect, it } from "vitest";
// The same in-memory fake the rest of the module's tests drive, deliberately:
// a second fake would be a second definition of what a clips repository does,
// and the two would drift. It models the bin for real — a restore puts back what
// the recycle took — so the round trips below prove something.
import { FakeClipsRepository } from "./clips.test";
import { createClip, listClips, setClipPinned } from "./clips";
import {
  countRecycledClips,
  deleteRecycledClipsForever,
  emptyClipsRecycleBin,
  listRecycledClips,
  recycleClips,
  restoreRecycledClips,
} from "./recycle";

let repo: FakeClipsRepository;

beforeEach(() => {
  repo = new FakeClipsRepository();
});

/** Writes a clip and returns it, so each test reads as what it is testing. */
function addClip(title: string, contentHtml = "<p>body</p>") {
  return createClip(repo, { title, contentHtml, categories: [], tags: [] }).clip;
}

describe("recycleClips", () => {
  it("moves a clip out of the list and into the bin", () => {
    const clip = addClip("Flight details");

    const result = recycleClips(repo, [clip.id]);

    expect(result).toEqual({ movedCount: 1, skippedCount: 0 });
    expect(listClips(repo)).toHaveLength(0);
    expect(countRecycledClips(repo)).toBe(1);
  });

  it("skips an id that is already gone rather than throwing", () => {
    const clip = addClip("Still here");

    const result = recycleClips(repo, [clip.id, 9999]);

    // The count reports what actually moved — a stale button must not produce
    // an error in the reader's face, nor a count that overstates the work.
    expect(result).toEqual({ movedCount: 1, skippedCount: 1 });
    expect(countRecycledClips(repo)).toBe(1);
  });

  it("de-dupes a double-submitted id so the count matches what was shown", () => {
    const clip = addClip("Clicked twice");

    expect(recycleClips(repo, [clip.id, clip.id])).toEqual({ movedCount: 1, skippedCount: 0 });
  });

  it("refuses an empty selection", () => {
    // An empty list means the UI lost the ticks — worth surfacing, not hiding.
    expect(() => recycleClips(repo, [])).toThrow();
  });

  it("rejects an id that is not a positive integer", () => {
    expect(() => recycleClips(repo, [0])).toThrow();
    expect(() => recycleClips(repo, [-3])).toThrow();
    expect(() => recycleClips(repo, [1.5])).toThrow();
  });
});

describe("listRecycledClips", () => {
  it("returns the bin newest deleted first", () => {
    const first = addClip("First");
    const second = addClip("Second");
    recycleClips(repo, [first.id]);
    recycleClips(repo, [second.id]);

    const binned = listRecycledClips(repo, 100);

    expect(binned.map((c) => c.title)).toEqual(["Second", "First"]);
  });

  it("carries a handle distinct from the clip's own id", () => {
    const clip = addClip("Binned");
    recycleClips(repo, [clip.id]);

    const [binned] = listRecycledClips(repo, 100);

    // `id` is still the id the clip had; `recycledId` is what restore and purge
    // take, because the same clip can be binned, restored and binned again.
    expect(binned.id).toBe(clip.id);
    expect(binned.recycledId).toBeGreaterThan(0);
    expect(binned.deletedAt).not.toBe("");
  });

  it("is empty when nothing has been deleted", () => {
    expect(listRecycledClips(repo, 100)).toEqual([]);
    expect(countRecycledClips(repo)).toBe(0);
  });
});

describe("restoreRecycledClips", () => {
  it("puts a clip back at its original id, with what it was carrying", () => {
    const clip = createClip(repo, {
      title: "Recipe",
      contentHtml: "<p>Mix</p>",
      categories: ["Food"],
      tags: ["dinner"],
    }).clip;
    setClipPinned(repo, { id: clip.id, isPinned: true });
    recycleClips(repo, [clip.id]);

    const [binned] = listRecycledClips(repo, 100);
    const result = restoreRecycledClips(repo, [binned.recycledId]);

    expect(result).toEqual({ restoredCount: 1, skippedCount: 0 });
    const [restored] = listClips(repo);
    // The original id is what keeps an existing link — and the journal badge it
    // draws — pointing at the right clip across a delete and a restore.
    expect(restored.id).toBe(clip.id);
    expect(restored.categories).toEqual(["Food"]);
    expect(restored.tags).toEqual(["dinner"]);
    // A pin is something a person deliberately set; a restore that dropped it
    // would quietly undo that.
    expect(restored.isPinned).toBe(true);
    expect(countRecycledClips(repo)).toBe(0);
  });

  it("restores under a fresh id when the original has been taken since", () => {
    const first = addClip("Original");
    recycleClips(repo, [first.id]);
    const [binned] = listRecycledClips(repo, 100);

    // Something else claims the id while the clip sits in the bin.
    repo.clips.set(first.id, { ...first, title: "Took the id" });

    restoreRecycledClips(repo, [binned.recycledId]);

    const titles = listClips(repo).map((c) => c.title);
    // Both exist: nothing is merged and nothing is overwritten.
    expect(titles).toContain("Original");
    expect(titles).toContain("Took the id");
  });

  it("skips a handle that is no longer in the bin", () => {
    const clip = addClip("Gone");
    recycleClips(repo, [clip.id]);
    const [binned] = listRecycledClips(repo, 100);
    deleteRecycledClipsForever(repo, [binned.recycledId]);

    expect(restoreRecycledClips(repo, [binned.recycledId])).toEqual({
      restoredCount: 0,
      skippedCount: 1,
    });
  });

  it("refuses an empty selection", () => {
    expect(() => restoreRecycledClips(repo, [])).toThrow();
  });
});

describe("deleteRecycledClipsForever", () => {
  it("removes a clip from the bin without restoring it", () => {
    const clip = addClip("Purge me");
    recycleClips(repo, [clip.id]);
    const [binned] = listRecycledClips(repo, 100);

    const result = deleteRecycledClipsForever(repo, [binned.recycledId]);

    expect(result).toEqual({ deletedCount: 1, skippedCount: 0 });
    expect(countRecycledClips(repo)).toBe(0);
    // Gone for good — not back in the list.
    expect(listClips(repo)).toHaveLength(0);
  });

  it("skips a handle that is already gone", () => {
    expect(deleteRecycledClipsForever(repo, [9999])).toEqual({
      deletedCount: 0,
      skippedCount: 1,
    });
  });

  it("refuses an empty selection", () => {
    expect(() => deleteRecycledClipsForever(repo, [])).toThrow();
  });
});

describe("emptyClipsRecycleBin", () => {
  it("removes everything and reports how many went", () => {
    const first = addClip("One");
    const second = addClip("Two");
    recycleClips(repo, [first.id, second.id]);

    expect(emptyClipsRecycleBin(repo)).toEqual({ deletedCount: 2 });
    expect(countRecycledClips(repo)).toBe(0);
  });

  it("is a harmless no-op on an empty bin", () => {
    // No id list, so no minimum — unlike the selection-based calls, where an
    // empty list means the UI lost the reader's ticks.
    expect(emptyClipsRecycleBin(repo)).toEqual({ deletedCount: 0 });
  });
});

describe("the round trip", () => {
  it("leaves a clip where it started after a delete and a restore", () => {
    const clip = addClip("There and back", "<p>Unchanged</p>");
    const before = listClips(repo);

    recycleClips(repo, [clip.id]);
    const [binned] = listRecycledClips(repo, 100);
    restoreRecycledClips(repo, [binned.recycledId]);

    expect(listClips(repo)).toEqual(before);
    expect(countRecycledClips(repo)).toBe(0);
  });
});
