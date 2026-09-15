import { describe, expect, it } from "vitest";
import { matchesCriteria, matchesDateRange } from "./criteria";
import {
  canStartScan,
  clearPhotoIndex,
  countIndexedPhotos,
  countPhotoMagicCandidates,
  deletePhotoMagicList,
  describePhotoMagicFailure,
  generatePhotoMagicList,
  getScanStatus,
  listPhotoMagicLists,
  loadGeneratedPhotos,
  loadPhotoMagicList,
  regeneratePhotoMagicList,
  savePhotoMagicList,
  updatePhotoMagicList,
  type PhotoMagicDependencies,
} from "./magic";
import type {
  MagicScanRunRepository,
  PhotoIndexRepository,
  PhotoMagicListRepository,
} from "./ports";
import type {
  IndexedPhoto,
  MagicScanRun,
  PhotoFileFacts,
  PhotoMagicCriteria,
  PhotoMagicList,
  PhotoMagicListSummary,
  ScanRunProgress,
} from "./types";
import { emptyCriteria } from "./types";

// Use-cases against hand-written in-memory fakes, per ARCHITECTURE.md -- fakes over
// mocks, so the tests read as "given this data" rather than as call-order assertions.
//
// The index fake filters with `matchesCriteria`, the same function the real SQL clause
// mirrors. That is deliberate: it makes these tests exercise the documented semantics
// rather than a second, divergent copy of them.

function photo(overrides: Partial<IndexedPhoto> = {}): IndexedPhoto {
  return {
    relativePath: "2019/2019-06-09 Farm/IMG_0001.jpg",
    bytes: 4 * 1024 * 1024,
    width: 1920,
    height: 1080,
    takenAtDate: "2019-06-09",
    takenAtSource: "exif",
    ...overrides,
  };
}

function criteria(overrides: Partial<PhotoMagicCriteria> = {}): PhotoMagicCriteria {
  return { ...emptyCriteria(), ...overrides };
}

class FakePhotoIndex implements PhotoIndexRepository {
  constructor(public photos: IndexedPhoto[] = []) {}

  listCandidates(c: PhotoMagicCriteria): IndexedPhoto[] {
    return this.photos.filter((p) => matchesCriteria(p, c));
  }
  countCandidates(c: PhotoMagicCriteria): number {
    return this.listCandidates(c).length;
  }
  countUnknownSizeInRange(c: PhotoMagicCriteria): number {
    return this.photos.filter(
      (p) => matchesDateRange(p, c) && (p.width === undefined || p.height === undefined),
    ).length;
  }
  getFileFacts(relativePath: string): PhotoFileFacts | undefined {
    const found = this.photos.find((p) => p.relativePath === relativePath);
    return found === undefined
      ? undefined
      : { relativePath, bytes: found.bytes, mtime: "2019-06-09T14:35:01.000Z" };
  }
  upsertPhoto(p: IndexedPhoto & { mtime: string }): void {
    const index = this.photos.findIndex((x) => x.relativePath === p.relativePath);
    if (index >= 0) this.photos[index] = p;
    else this.photos.push(p);
  }
  countIndexed(): number {
    return this.photos.length;
  }
  clearIndex(): void {
    this.photos = [];
  }
}

/** Thrown by the fake to stand in for the unique index on `name`. */
class FakeUniqueError extends Error {
  code = "SQLITE_CONSTRAINT_UNIQUE";
  constructor() {
    super("UNIQUE constraint failed: pho_magic_list.name");
  }
}

class FakeListRepo implements PhotoMagicListRepository {
  private nextId = 1;
  lists = new Map<number, PhotoMagicList>();
  sets = new Map<number, string[]>();

  createList(list: { name: string; description: string; criteria: PhotoMagicCriteria }): number {
    for (const existing of this.lists.values()) {
      if (existing.name.toLowerCase() === list.name.toLowerCase()) throw new FakeUniqueError();
    }
    const id = this.nextId++;
    this.lists.set(id, {
      id,
      name: list.name,
      description: list.description,
      criteria: list.criteria,
      createdAt: "2026-09-13 10:00:00",
      updatedAt: "2026-09-13 10:00:00",
    });
    return id;
  }
  updateList(
    id: number,
    list: { name: string; description: string; criteria: PhotoMagicCriteria },
  ): void {
    for (const [otherId, existing] of this.lists) {
      if (otherId !== id && existing.name.toLowerCase() === list.name.toLowerCase()) {
        throw new FakeUniqueError();
      }
    }
    const current = this.lists.get(id);
    if (current !== undefined) this.lists.set(id, { ...current, ...list });
  }
  deleteList(id: number): void {
    this.lists.delete(id);
    this.sets.delete(id);
  }
  getList(id: number): PhotoMagicList | undefined {
    return this.lists.get(id);
  }
  listLists(): PhotoMagicListSummary[] {
    return [...this.lists.values()].map((list) => ({
      id: list.id,
      name: list.name,
      description: list.description,
      maxPhotos: list.criteria.maxPhotos,
      photoCount: this.sets.get(list.id)?.length ?? 0,
      lastGeneratedAt: list.lastGeneratedAt,
      updatedAt: list.updatedAt,
    }));
  }
  saveGeneratedPhotos(id: number, relativePaths: readonly string[]): void {
    this.sets.set(id, [...relativePaths]);
    const current = this.lists.get(id);
    if (current !== undefined) {
      this.lists.set(id, { ...current, lastGeneratedAt: "2026-09-13 11:00:00" });
    }
  }
  listGeneratedPhotos(id: number): IndexedPhoto[] {
    return (this.sets.get(id) ?? []).map((relativePath) => photo({ relativePath }));
  }
}

class FakeScanRuns implements MagicScanRunRepository {
  private nextId = 1;
  runs = new Map<number, MagicScanRun>();
  abandonedCalls = 0;

  createRun(range: { fromDate: string; toDate: string }): number {
    const id = this.nextId++;
    this.runs.set(id, {
      id,
      fromDate: range.fromDate,
      toDate: range.toDate,
      status: "running",
      filesTotal: 0,
      filesSeen: 0,
      filesIndexed: 0,
      filesCached: 0,
      filesFailed: 0,
      currentPath: "",
      lastError: "",
      startedAt: "2026-09-13 10:00:00",
      updatedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
    });
    return id;
  }
  setRunTotal(id: number, filesTotal: number): void {
    const run = this.runs.get(id);
    if (run !== undefined) this.runs.set(id, { ...run, filesTotal });
  }
  updateProgress(id: number, progress: ScanRunProgress): void {
    const run = this.runs.get(id);
    if (run !== undefined) this.runs.set(id, { ...run, ...progress, lastError: progress.lastError ?? "" });
  }
  finishRun(id: number, status: "completed" | "failed" | "cancelled", lastError?: string): void {
    const run = this.runs.get(id);
    if (run !== undefined) {
      this.runs.set(id, { ...run, status, lastError: lastError ?? run.lastError });
    }
  }
  getRun(id: number): MagicScanRun | undefined {
    return this.runs.get(id);
  }
  getActiveRun(): MagicScanRun | undefined {
    return [...this.runs.values()].find((run) => run.status === "running");
  }
  failAbandonedRuns(): number {
    this.abandonedCalls += 1;
    return 0;
  }
}

function makeDeps(photos: IndexedPhoto[] = []): PhotoMagicDependencies & {
  listRepo: FakeListRepo;
  photoIndex: FakePhotoIndex;
  scanRuns: FakeScanRuns;
} {
  return {
    listRepo: new FakeListRepo(),
    photoIndex: new FakePhotoIndex(photos),
    scanRuns: new FakeScanRuns(),
  };
}

const alwaysZero = () => 0;

describe("savePhotoMagicList", () => {
  it("saves a list and returns its id", () => {
    const deps = makeDeps();
    const result = savePhotoMagicList(deps, {
      name: "Summer 2019",
      description: "The good ones",
      criteria: criteria({ fromDate: "2019-06-01", toDate: "2019-08-31" }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(deps.listRepo.getList(result.value)?.name).toBe("Summer 2019");
  });

  it("reports a duplicate name rather than making a twin", () => {
    const deps = makeDeps();
    savePhotoMagicList(deps, { name: "Summer", description: "", criteria: criteria() });
    const second = savePhotoMagicList(deps, {
      name: "Summer",
      description: "",
      criteria: criteria(),
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.failure).toEqual({ kind: "duplicate-name", name: "Summer" });
  });

  it("treats a name differing only in case as a duplicate", () => {
    // NOCASE in the index: two lists a reader cannot tell apart are two lists they
    // will open the wrong one of.
    const deps = makeDeps();
    savePhotoMagicList(deps, { name: "Summer", description: "", criteria: criteria() });
    const second = savePhotoMagicList(deps, {
      name: "summer",
      description: "",
      criteria: criteria(),
    });
    expect(second.ok).toBe(false);
  });

  it("lets an unrelated error through rather than calling it a name clash", () => {
    const deps = makeDeps();
    deps.listRepo.createList = () => {
      throw new Error("disk is full");
    };
    expect(() =>
      savePhotoMagicList(deps, { name: "Summer", description: "", criteria: criteria() }),
    ).toThrow("disk is full");
  });
});

describe("updatePhotoMagicList", () => {
  it("replaces name, description and criteria", () => {
    const deps = makeDeps();
    const created = savePhotoMagicList(deps, {
      name: "Old",
      description: "",
      criteria: criteria({ maxPhotos: 10 }),
    });
    if (!created.ok) throw new Error("setup failed");

    const result = updatePhotoMagicList(deps, {
      id: created.value,
      name: "New",
      description: "changed",
      criteria: criteria({ maxPhotos: 99 }),
    });

    expect(result.ok).toBe(true);
    const stored = deps.listRepo.getList(created.value);
    expect(stored?.name).toBe("New");
    expect(stored?.criteria.maxPhotos).toBe(99);
  });

  it("lets a list keep its own name", () => {
    // Without the `exceptId`-style check, saving an unchanged name would collide with
    // the very row being renamed.
    const deps = makeDeps();
    const created = savePhotoMagicList(deps, {
      name: "Summer",
      description: "",
      criteria: criteria(),
    });
    if (!created.ok) throw new Error("setup failed");
    const result = updatePhotoMagicList(deps, {
      id: created.value,
      name: "Summer",
      description: "edited",
      criteria: criteria(),
    });
    expect(result.ok).toBe(true);
  });

  it("refuses a name another list already has", () => {
    const deps = makeDeps();
    savePhotoMagicList(deps, { name: "Taken", description: "", criteria: criteria() });
    const mine = savePhotoMagicList(deps, {
      name: "Mine",
      description: "",
      criteria: criteria(),
    });
    if (!mine.ok) throw new Error("setup failed");

    const result = updatePhotoMagicList(deps, {
      id: mine.value,
      name: "Taken",
      description: "",
      criteria: criteria(),
    });
    expect(result.ok).toBe(false);
  });

  it("reports a missing list", () => {
    const result = updatePhotoMagicList(makeDeps(), {
      id: 404,
      name: "Ghost",
      description: "",
      criteria: criteria(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("not-found");
  });
});

describe("deletePhotoMagicList", () => {
  it("deletes the list and its stored set", () => {
    const deps = makeDeps([photo()]);
    const created = savePhotoMagicList(deps, {
      name: "Doomed",
      description: "",
      criteria: criteria(),
    });
    if (!created.ok) throw new Error("setup failed");
    generatePhotoMagicList(deps, { listId: created.value, criteria: criteria() }, alwaysZero);

    expect(deletePhotoMagicList(deps, created.value).ok).toBe(true);
    expect(deps.listRepo.getList(created.value)).toBeUndefined();
    expect(deps.listRepo.sets.get(created.value)).toBeUndefined();
  });

  it("reports a missing list", () => {
    const result = deletePhotoMagicList(makeDeps(), 404);
    expect(result.ok).toBe(false);
  });
});

describe("generatePhotoMagicList", () => {
  it("draws matching photographs and reports the candidate count", () => {
    const deps = makeDeps([
      photo({ relativePath: "a.jpg", takenAtDate: "2019-06-01" }),
      photo({ relativePath: "b.jpg", takenAtDate: "2019-06-02" }),
      photo({ relativePath: "c.jpg", takenAtDate: "2021-01-01" }),
    ]);

    const result = generatePhotoMagicList(
      deps,
      { criteria: criteria({ fromDate: "2019-01-01", toDate: "2019-12-31" }) },
      alwaysZero,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stats.candidateCount).toBe(2);
    expect(result.value.photos).toHaveLength(2);
  });

  it("stores the draw when a list id is given", () => {
    const deps = makeDeps([photo({ relativePath: "a.jpg" })]);
    const created = savePhotoMagicList(deps, {
      name: "Kept",
      description: "",
      criteria: criteria(),
    });
    if (!created.ok) throw new Error("setup failed");

    generatePhotoMagicList(deps, { listId: created.value, criteria: criteria() }, alwaysZero);

    expect(deps.listRepo.sets.get(created.value)).toEqual(["a.jpg"]);
    expect(deps.listRepo.getList(created.value)?.lastGeneratedAt).toBeDefined();
  });

  it("writes nothing when no list id is given", () => {
    // "Create the list" works on whatever is in the form, saved or not.
    const deps = makeDeps([photo()]);
    const result = generatePhotoMagicList(deps, { criteria: criteria() }, alwaysZero);
    expect(result.ok).toBe(true);
    expect(deps.listRepo.sets.size).toBe(0);
  });

  it("reports a missing list rather than generating into nothing", () => {
    const result = generatePhotoMagicList(
      makeDeps([photo()]),
      { listId: 404, criteria: criteria() },
      alwaysZero,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("not-found");
  });

  it("counts unreadable-dimension exclusions only when resolution is bounded", () => {
    const deps = makeDeps([
      photo({ relativePath: "known.jpg" }),
      photo({ relativePath: "unknown.jpg", width: undefined, height: undefined }),
    ]);

    const bounded = generatePhotoMagicList(
      deps,
      { criteria: criteria({ minWidth: 1920 }) },
      alwaysZero,
    );
    if (!bounded.ok) throw new Error("expected ok");
    expect(bounded.value.stats.excludedUnknownSize).toBe(1);
    expect(bounded.value.photos).toHaveLength(1);

    // Without a resolution bound the number would be a meaningless aside, so it is
    // not even asked for.
    const unbounded = generatePhotoMagicList(deps, { criteria: criteria() }, alwaysZero);
    if (!unbounded.ok) throw new Error("expected ok");
    expect(unbounded.value.stats.excludedUnknownSize).toBe(0);
    expect(unbounded.value.photos).toHaveLength(2);
  });

  it("returns an empty set, not an error, when nothing matches", () => {
    const deps = makeDeps([photo({ takenAtDate: "2019-06-09" })]);
    const result = generatePhotoMagicList(
      deps,
      { criteria: criteria({ fromDate: "2030-01-01" }) },
      alwaysZero,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.photos).toEqual([]);
    expect(result.value.stats.candidateCount).toBe(0);
  });
});

describe("regeneratePhotoMagicList", () => {
  it("uses the list's SAVED criteria, not whatever a form holds", () => {
    // The distinction that keeps a saved list from quietly changing meaning.
    const deps = makeDeps([
      photo({ relativePath: "in-range.jpg", takenAtDate: "2019-06-09" }),
      photo({ relativePath: "out-of-range.jpg", takenAtDate: "2021-01-01" }),
    ]);
    const created = savePhotoMagicList(deps, {
      name: "2019 only",
      description: "",
      criteria: criteria({ fromDate: "2019-01-01", toDate: "2019-12-31" }),
    });
    if (!created.ok) throw new Error("setup failed");

    const result = regeneratePhotoMagicList(deps, created.value, alwaysZero);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.photos.map((p) => p.relativePath)).toEqual(["in-range.jpg"]);
  });

  it("reports a missing list", () => {
    const result = regeneratePhotoMagicList(makeDeps(), 404, alwaysZero);
    expect(result.ok).toBe(false);
  });
});

describe("loadPhotoMagicList and loadGeneratedPhotos", () => {
  it("loads a saved list with its criteria", () => {
    const deps = makeDeps();
    const created = savePhotoMagicList(deps, {
      name: "Big ones",
      description: "note",
      criteria: criteria({ minBytes: 5_000_000, maxPhotos: 42 }),
    });
    if (!created.ok) throw new Error("setup failed");

    const result = loadPhotoMagicList(deps, created.value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.criteria.minBytes).toBe(5_000_000);
    expect(result.value.criteria.maxPhotos).toBe(42);
  });

  it("reports a missing list", () => {
    const result = loadPhotoMagicList(makeDeps(), 404);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual({ kind: "not-found", id: 404 });
  });

  it("replays a stored set without re-rolling it", () => {
    const deps = makeDeps([photo({ relativePath: "a.jpg" }), photo({ relativePath: "b.jpg" })]);
    const created = savePhotoMagicList(deps, {
      name: "Kept",
      description: "",
      criteria: criteria(),
    });
    if (!created.ok) throw new Error("setup failed");
    generatePhotoMagicList(deps, { listId: created.value, criteria: criteria() }, alwaysZero);

    const first = loadGeneratedPhotos(deps, created.value).map((p) => p.relativePath);
    const second = loadGeneratedPhotos(deps, created.value).map((p) => p.relativePath);
    expect(second).toEqual(first);
  });
});

describe("listPhotoMagicLists", () => {
  it("returns every saved list with its photo count", () => {
    const deps = makeDeps([photo({ relativePath: "a.jpg" })]);
    const created = savePhotoMagicList(deps, {
      name: "One",
      description: "",
      criteria: criteria(),
    });
    if (!created.ok) throw new Error("setup failed");
    savePhotoMagicList(deps, { name: "Two", description: "", criteria: criteria() });
    generatePhotoMagicList(deps, { listId: created.value, criteria: criteria() }, alwaysZero);

    const summaries = listPhotoMagicLists(deps);
    expect(summaries).toHaveLength(2);
    expect(summaries.find((s) => s.name === "One")?.photoCount).toBe(1);
    expect(summaries.find((s) => s.name === "Two")?.photoCount).toBe(0);
  });
});

describe("countPhotoMagicCandidates", () => {
  it("counts without drawing", () => {
    const deps = makeDeps([
      photo({ relativePath: "a.jpg", bytes: 10 }),
      photo({ relativePath: "b.jpg", bytes: 5_000_000 }),
    ]);
    expect(countPhotoMagicCandidates(deps, criteria({ minBytes: 1000 }))).toBe(1);
  });
});

describe("the index as a cache", () => {
  it("counts and clears", () => {
    const deps = makeDeps([photo({ relativePath: "a.jpg" }), photo({ relativePath: "b.jpg" })]);
    expect(countIndexedPhotos(deps)).toBe(2);
    clearPhotoIndex(deps);
    expect(countIndexedPhotos(deps)).toBe(0);
  });

  it("does not lose a saved list when the index is cleared", () => {
    // The reason `pho_magic_list_photos` stores a path rather than an index row id.
    const deps = makeDeps([photo({ relativePath: "a.jpg" })]);
    const created = savePhotoMagicList(deps, {
      name: "Kept",
      description: "",
      criteria: criteria(),
    });
    if (!created.ok) throw new Error("setup failed");
    generatePhotoMagicList(deps, { listId: created.value, criteria: criteria() }, alwaysZero);

    clearPhotoIndex(deps);

    expect(deps.listRepo.getList(created.value)).toBeDefined();
    expect(loadGeneratedPhotos(deps, created.value)).toHaveLength(1);
  });
});

describe("scan status", () => {
  it("returns undefined when nothing has run", () => {
    expect(getScanStatus(makeDeps())).toBeUndefined();
  });

  it("reports a running scan and closes abandoned rows first", () => {
    const deps = makeDeps();
    const id = deps.scanRuns.createRun({ fromDate: "", toDate: "" });
    const status = getScanStatus(deps, id);
    expect(status?.status).toBe("running");
    expect(status?.isStale).toBe(false);
    // Checked on read, because there is no scheduler to do it on a timer.
    expect(deps.scanRuns.abandonedCalls).toBeGreaterThan(0);
  });

  it("blocks a second scan while one is running", () => {
    const deps = makeDeps();
    expect(canStartScan(deps)).toBe(true);
    deps.scanRuns.createRun({ fromDate: "", toDate: "" });
    expect(canStartScan(deps)).toBe(false);
  });

  it("allows a scan when the running row is stale", () => {
    // Otherwise a crashed process would lock the feature until someone edited the DB.
    const deps = makeDeps();
    const id = deps.scanRuns.createRun({ fromDate: "", toDate: "" });
    const run = deps.scanRuns.runs.get(id)!;
    deps.scanRuns.runs.set(id, { ...run, updatedAt: "2020-01-01 00:00:00" });
    expect(canStartScan(deps)).toBe(true);
  });
});

describe("describePhotoMagicFailure", () => {
  it("names the clashing list", () => {
    expect(describePhotoMagicFailure({ kind: "duplicate-name", name: "Summer" })).toContain(
      "Summer",
    );
  });

  it("has a sentence for every failure kind", () => {
    expect(describePhotoMagicFailure({ kind: "not-found", id: 1 })).toBeTruthy();
    expect(describePhotoMagicFailure({ kind: "scan-in-progress" })).toContain("scan");
  });
});
