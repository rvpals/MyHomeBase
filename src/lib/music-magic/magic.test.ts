import { beforeEach, describe, expect, it } from "vitest";
import type { Track } from "@/lib/music";
import {
  countMagicCandidates,
  deleteMagicList,
  describeMagicFailure,
  generateMagicPlaylist,
  listMagicLists,
  loadMagicList,
  regenerateMagicList,
  saveMagicList,
  updateMagicList,
  type MagicDependencies,
} from "./magic";
import type {
  MagicAlbumOption,
  MagicCandidateSource,
  MagicListRepository,
  MagicPickerOption,
} from "./ports";
import type { MagicCriteria, MagicList, MagicListSummary } from "./types";
import { emptyCriteria } from "./types";

// Use-cases tested against hand-written fakes implementing the two ports, per
// ARCHITECTURE.md. No database, no SQL -- the candidate FILTERING is the repository's job
// and is not re-implemented here; these tests cover the decisions the use-cases make.

function track(id: number, overrides: Partial<Track> = {}): Track {
  return {
    id,
    relativePath: `music/${id}.mp3`,
    fileName: `${id}.mp3`,
    title: `Track ${id}`,
    displayTitle: `Track ${id}`,
    artist: "An Artist",
    album: "An Album",
    albumArtist: "An Artist",
    genre: "Rock",
    durationSeconds: 300,
    extension: "mp3",
    mimeType: "audio/mpeg",
    fileSize: 1024,
    fileMtime: "2026-01-01T00:00:00.000Z",
    isStreamable: true,
    hasCueSheet: false,
    playCount: 0,
    ...overrides,
  };
}

/** An in-memory candidate source. Records the criteria it was asked with. */
class FakeCandidateSource implements MagicCandidateSource {
  lastCriteria?: MagicCriteria;

  constructor(private candidates: Track[]) {}

  setCandidates(candidates: Track[]): void {
    this.candidates = candidates;
  }

  listCandidates(criteria: MagicCriteria): Track[] {
    this.lastCriteria = criteria;
    return this.candidates;
  }

  countCandidates(criteria: MagicCriteria): number {
    this.lastCriteria = criteria;
    return this.candidates.length;
  }

  listGenreOptions(): MagicPickerOption[] {
    return [{ value: "Rock", label: "Rock", trackCount: 10 }];
  }

  listArtistOptions(): MagicPickerOption[] {
    return [{ value: "", label: "Unknown artist", trackCount: 2 }];
  }

  listAlbumOptions(): MagicAlbumOption[] {
    return [{ albumId: 1, label: "An Album", albumArtist: "An Artist", trackCount: 8 }];
  }
}

/** An in-memory saved-list store, enforcing the unique name the real index does. */
class FakeMagicListRepository implements MagicListRepository {
  private lists = new Map<number, MagicList>();
  private tracksByList = new Map<number, number[]>();
  private nextId = 1;
  /** Track ids that exist in the catalog. Anything else is dropped on read, as SQL's join does. */
  existingTrackIds = new Set<number>();

  createMagicList(list: { name: string; description: string; criteria: MagicCriteria }): number {
    if (this.findByName(list.name) !== undefined) throw new Error("UNIQUE constraint failed");
    const id = this.nextId;
    this.nextId += 1;
    this.lists.set(id, {
      id,
      name: list.name,
      description: list.description,
      criteria: { ...list.criteria },
      createdAt: "2026-08-19 10:00:00",
      updatedAt: "2026-08-19 10:00:00",
    });
    return id;
  }

  updateMagicList(
    id: number,
    list: { name: string; description: string; criteria: MagicCriteria },
  ): void {
    const clash = this.findByName(list.name);
    if (clash !== undefined && clash.id !== id) throw new Error("UNIQUE constraint failed");
    const existing = this.lists.get(id);
    if (existing === undefined) return;
    this.lists.set(id, {
      ...existing,
      name: list.name,
      description: list.description,
      criteria: { ...list.criteria },
      updatedAt: "2026-08-19 11:00:00",
    });
  }

  deleteMagicList(id: number): void {
    this.lists.delete(id);
    this.tracksByList.delete(id);
  }

  getMagicList(id: number): MagicList | undefined {
    const found = this.lists.get(id);
    return found === undefined ? undefined : { ...found, criteria: { ...found.criteria } };
  }

  listMagicLists(): MagicListSummary[] {
    return [...this.lists.values()].map((list) => ({
      id: list.id,
      name: list.name,
      description: list.description,
      targetSeconds: list.criteria.targetSeconds,
      trackCount: this.storedTrackIds(list.id).length,
      lastGeneratedAt: list.lastGeneratedAt,
      updatedAt: list.updatedAt,
    }));
  }

  saveGeneratedTracks(id: number, trackIds: readonly number[]): void {
    this.tracksByList.set(id, [...trackIds]);
    const existing = this.lists.get(id);
    if (existing !== undefined) {
      this.lists.set(id, { ...existing, lastGeneratedAt: "2026-08-19 12:00:00" });
    }
  }

  listGeneratedTracks(id: number): Track[] {
    return this.storedTrackIds(id).map((trackId) => track(trackId));
  }

  /** The stored ids, minus any whose track has gone -- what the real INNER JOIN does. */
  private storedTrackIds(id: number): number[] {
    const stored = this.tracksByList.get(id) ?? [];
    if (this.existingTrackIds.size === 0) return stored;
    return stored.filter((trackId) => this.existingTrackIds.has(trackId));
  }

  /** What was stored, ignoring whether the tracks still exist. For asserting a rebuild. */
  rawStoredTrackIds(id: number): number[] {
    return this.tracksByList.get(id) ?? [];
  }

  private findByName(name: string): MagicList | undefined {
    return [...this.lists.values()].find(
      (list) => list.name.toLowerCase() === name.toLowerCase(),
    );
  }
}

let magicListRepo: FakeMagicListRepository;
let candidateSource: FakeCandidateSource;
let deps: MagicDependencies;

beforeEach(() => {
  magicListRepo = new FakeMagicListRepository();
  candidateSource = new FakeCandidateSource(
    Array.from({ length: 30 }, (_, index) => track(index + 1)),
  );
  deps = { magicListRepo, candidateSource, random: () => 0 };
});

const criteria = (overrides: Partial<MagicCriteria> = {}): MagicCriteria => ({
  ...emptyCriteria(),
  ...overrides,
});

describe("generateMagicPlaylist", () => {
  it("returns tracks filling the target, without saving anything", () => {
    const result = generateMagicPlaylist(deps, criteria({ targetSeconds: 1800 }));

    expect(result.tracks).toHaveLength(6);
    expect(result.stats.totalSeconds).toBe(1800);
    expect(magicListRepo.listMagicLists()).toEqual([]);
  });

  it("passes the criteria through to the candidate source", () => {
    generateMagicPlaylist(
      deps,
      criteria({ genres: ["Rock", "Pop"], artists: ["Michael Jackson"], matchAny: false }),
    );

    expect(candidateSource.lastCriteria?.genres).toEqual(["Rock", "Pop"]);
    expect(candidateSource.lastCriteria?.artists).toEqual(["Michael Jackson"]);
    expect(candidateSource.lastCriteria?.matchAny).toBe(false);
  });

  it("rejects a target below the minimum rather than generating a one-track list", () => {
    expect(() => generateMagicPlaylist(deps, criteria({ targetSeconds: 5 }))).toThrow();
  });

  it("rejects a target beyond the maximum", () => {
    expect(() => generateMagicPlaylist(deps, criteria({ targetSeconds: 100 * 60 * 60 }))).toThrow();
  });

  it("reports an empty result rather than throwing when nothing matches", () => {
    candidateSource.setCandidates([]);
    const result = generateMagicPlaylist(deps, criteria({ genres: ["Nonexistent"] }));

    expect(result.tracks).toEqual([]);
    expect(result.stats.candidateCount).toBe(0);
  });
});

describe("countMagicCandidates", () => {
  it("counts without generating", () => {
    expect(countMagicCandidates(deps, criteria())).toBe(30);
  });
});

describe("saveMagicList", () => {
  it("saves the criteria and generates the first set in one step", () => {
    const result = saveMagicList(deps, {
      name: "Friday night",
      description: "Something upbeat",
      criteria: criteria({ genres: ["Rock"], targetSeconds: 1800 }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.magicList.name).toBe("Friday night");
    expect(result.value.magicList.criteria.genres).toEqual(["Rock"]);
    expect(result.value.generated.tracks).toHaveLength(6);
    // The generated set was persisted, not just returned.
    expect(magicListRepo.rawStoredTrackIds(result.value.magicList.id)).toHaveLength(6);
  });

  it("stamps lastGeneratedAt so a saved-but-never-rolled list is distinguishable", () => {
    const result = saveMagicList(deps, { name: "Rolled", criteria: criteria() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(magicListRepo.getMagicList(result.value.magicList.id)?.lastGeneratedAt).toBeDefined();
  });

  it("refuses a duplicate name with a readable failure instead of throwing", () => {
    saveMagicList(deps, { name: "Friday night", criteria: criteria() });
    const again = saveMagicList(deps, { name: "friday night", criteria: criteria() });

    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.failure.kind).toBe("duplicate-name");
    expect(describeMagicFailure(again.failure)).toContain("already exists");
  });

  it("rejects a blank name at the boundary", () => {
    expect(() => saveMagicList(deps, { name: "   ", criteria: criteria() })).toThrow();
  });
});

describe("loadMagicList", () => {
  it("replays the stored set rather than re-rolling it", () => {
    const saved = saveMagicList(deps, { name: "Keep me", criteria: criteria({ targetSeconds: 1800 }) });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const firstIds = saved.value.generated.tracks.map((entry) => entry.id);

    // A different rng would shuffle differently -- proving load does not generate.
    deps = { ...deps, random: () => 0.999 };
    const loaded = loadMagicList(deps, saved.value.magicList.id);

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.tracks.map((entry) => entry.id)).toEqual(firstIds);
  });

  it("returns the criteria so the form can be repopulated", () => {
    const saved = saveMagicList(deps, {
      name: "With criteria",
      criteria: criteria({ genres: ["Rock", "Pop"], albumIds: [3], matchAny: true }),
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const loaded = loadMagicList(deps, saved.value.magicList.id);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.magicList.criteria.genres).toEqual(["Rock", "Pop"]);
    expect(loaded.value.magicList.criteria.albumIds).toEqual([3]);
    expect(loaded.value.magicList.criteria.matchAny).toBe(true);
  });

  it("fails cleanly for a list that does not exist", () => {
    const loaded = loadMagicList(deps, 999);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.failure.kind).toBe("no-such-list");
    expect(describeMagicFailure(loaded.failure)).toContain("no longer exists");
  });

  it("drops tracks whose files have gone, rather than erroring", () => {
    const saved = saveMagicList(deps, { name: "Pruned", criteria: criteria({ targetSeconds: 1800 }) });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const storedIds = magicListRepo.rawStoredTrackIds(saved.value.magicList.id);

    // Only the first two of the six survive a scan.
    magicListRepo.existingTrackIds = new Set(storedIds.slice(0, 2));

    const loaded = loadMagicList(deps, saved.value.magicList.id);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.tracks).toHaveLength(2);
  });
});

describe("regenerateMagicList", () => {
  it("re-rolls from the list's own stored criteria and replaces the tracks", () => {
    const saved = saveMagicList(deps, {
      name: "Re-roll me",
      criteria: criteria({ targetSeconds: 1800 }),
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const before = magicListRepo.rawStoredTrackIds(saved.value.magicList.id);

    // A different rng means a different draw.
    deps = { ...deps, random: () => 0.75 };
    const regenerated = regenerateMagicList(deps, saved.value.magicList.id);

    expect(regenerated.ok).toBe(true);
    if (!regenerated.ok) return;
    const after = magicListRepo.rawStoredTrackIds(saved.value.magicList.id);
    expect(after).not.toEqual(before);
    // Replaced wholesale, not appended -- the list must not grow on every regenerate.
    expect(after).toHaveLength(6);
    expect(regenerated.value.generated.tracks.map((entry) => entry.id)).toEqual(after);
  });

  it("uses the saved criteria, not whatever was last generated with", () => {
    const saved = saveMagicList(deps, {
      name: "Own criteria",
      criteria: criteria({ genres: ["Jazz"], targetSeconds: 1200 }),
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    regenerateMagicList(deps, saved.value.magicList.id);
    expect(candidateSource.lastCriteria?.genres).toEqual(["Jazz"]);
    expect(candidateSource.lastCriteria?.targetSeconds).toBe(1200);
  });

  it("fails cleanly for a list that does not exist", () => {
    const result = regenerateMagicList(deps, 4242);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("no-such-list");
  });
});

describe("updateMagicList", () => {
  it("rewrites the criteria and leaves the stored tracks alone", () => {
    const saved = saveMagicList(deps, {
      name: "Editable",
      criteria: criteria({ genres: ["Rock"], targetSeconds: 1800 }),
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const tracksBefore = magicListRepo.rawStoredTrackIds(saved.value.magicList.id);

    const updated = updateMagicList(deps, {
      magicListId: saved.value.magicList.id,
      name: "Edited",
      description: "Now with jazz",
      criteria: criteria({ genres: ["Jazz"], targetSeconds: 3600 }),
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.name).toBe("Edited");
    expect(updated.value.criteria.genres).toEqual(["Jazz"]);
    expect(updated.value.criteria.targetSeconds).toBe(3600);
    // Editing criteria is not regenerating -- that is a separate, explicit action.
    expect(magicListRepo.rawStoredTrackIds(saved.value.magicList.id)).toEqual(tracksBefore);
  });

  it("refuses a name another list already has", () => {
    saveMagicList(deps, { name: "First", criteria: criteria() });
    const second = saveMagicList(deps, { name: "Second", criteria: criteria() });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const clash = updateMagicList(deps, {
      magicListId: second.value.magicList.id,
      name: "First",
      criteria: criteria(),
    });

    expect(clash.ok).toBe(false);
    if (clash.ok) return;
    expect(clash.failure.kind).toBe("duplicate-name");
  });

  it("allows a list to keep its own name", () => {
    const saved = saveMagicList(deps, { name: "Same name", criteria: criteria() });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const updated = updateMagicList(deps, {
      magicListId: saved.value.magicList.id,
      name: "Same name",
      description: "New description",
      criteria: criteria({ targetSeconds: 2400 }),
    });

    expect(updated.ok).toBe(true);
  });

  it("fails cleanly for a list that does not exist", () => {
    const result = updateMagicList(deps, {
      magicListId: 777,
      name: "Ghost",
      criteria: criteria(),
    });
    expect(result.ok).toBe(false);
  });
});

describe("deleteMagicList", () => {
  it("removes the list", () => {
    const saved = saveMagicList(deps, { name: "Temporary", criteria: criteria() });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    expect(deleteMagicList(deps, saved.value.magicList.id).ok).toBe(true);
    expect(listMagicLists(deps)).toEqual([]);
  });

  it("fails cleanly for a list that does not exist", () => {
    expect(deleteMagicList(deps, 31337).ok).toBe(false);
  });
});

describe("listMagicLists", () => {
  it("reports each list with its playable track count", () => {
    saveMagicList(deps, { name: "One", criteria: criteria({ targetSeconds: 1800 }) });
    saveMagicList(deps, { name: "Two", criteria: criteria({ targetSeconds: 600 }) });

    const summaries = listMagicLists(deps);
    expect(summaries).toHaveLength(2);
    expect(summaries.map((entry) => entry.name).sort()).toEqual(["One", "Two"]);
    expect(summaries.find((entry) => entry.name === "One")?.trackCount).toBe(6);
    expect(summaries.find((entry) => entry.name === "Two")?.trackCount).toBe(2);
  });
});
