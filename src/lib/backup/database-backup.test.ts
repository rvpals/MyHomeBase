import { describe, expect, it } from "vitest";
import { archiveName, archivesToPrune, backupDatabase, isArchiveName } from "./database-backup";
import type { BackupFileStore, Compressor, DatabaseSnapshotter, RootCheck } from "./ports";

const NOW = new Date(2026, 9, 9, 17, 0, 0);

class FakeStore implements BackupFileStore {
  written = new Map<string, Uint8Array>();
  deleted: string[] = [];
  existing: string[] = [];

  async listFiles() {
    return [];
  }
  async statFile() {
    return undefined;
  }
  async copyFile(): Promise<void> {}
  async renameWithin(): Promise<void> {}
  async writeFile(_root: string, name: string, data: Uint8Array): Promise<void> {
    this.written.set(name, data);
    this.existing.push(name);
  }
  async deleteFile(_root: string, name: string): Promise<void> {
    this.deleted.push(name);
    this.existing = this.existing.filter((entry) => entry !== name);
  }
  async listTopLevelFiles(): Promise<string[]> {
    return [...this.existing];
  }
  async checkRoot(root: string): Promise<RootCheck> {
    return { kind: "ok", path: root };
  }
}

class FakeSnapshotter implements DatabaseSnapshotter {
  snapshots: string[] = [];
  deleted: string[] = [];
  failWith?: Error;

  async snapshotTo(destinationPath: string): Promise<number> {
    if (this.failWith) throw this.failWith;
    this.snapshots.push(destinationPath);
    return 100;
  }
  async readFile(): Promise<Uint8Array> {
    return new Uint8Array([1, 2, 3, 4, 5]);
  }
  async deleteFile(absolutePath: string): Promise<void> {
    this.deleted.push(absolutePath);
  }
  stagingPath(name: string): string {
    return `/tmp/${name}`;
  }
}

/** Halves the input, so a compressed length distinct from the input is observable. */
const compressor: Compressor = {
  async compress(data: Uint8Array) {
    return data.slice(0, Math.ceil(data.length / 2));
  },
};

function run(store: FakeStore, snapshotter: FakeSnapshotter, keepCount = 3) {
  return backupDatabase({
    store,
    snapshotter,
    compressor,
    backupRoot: "dst",
    keepCount,
    now: NOW,
  });
}

describe("archiveName / isArchiveName", () => {
  it("names the archive for the moment it was taken", () => {
    expect(archiveName(NOW)).toBe("2026-10-09-17-00-00.zip");
  });

  it("recognises only this job's own archive names", () => {
    expect(isArchiveName("2026-10-09-17-00-00.zip")).toBe(true);
    expect(isArchiveName("notes.zip")).toBe(false);
    expect(isArchiveName("2026-10-09.zip")).toBe(false);
    expect(isArchiveName("2026-10-09-17-00-00.txt")).toBe(false);
  });
});

describe("archivesToPrune", () => {
  const names = [
    "2026-10-01-00-00-00.zip",
    "2026-10-02-00-00-00.zip",
    "2026-10-03-00-00-00.zip",
  ];

  it("returns the oldest beyond the keep count", () => {
    expect(archivesToPrune(names, 2)).toEqual(["2026-10-01-00-00-00.zip"]);
  });

  it("returns nothing when there is room", () => {
    expect(archivesToPrune(names, 3)).toEqual([]);
    expect(archivesToPrune(names, 10)).toEqual([]);
  });

  it("never touches a file that is not one of its archives", () => {
    // A reader's own file in the backup folder must not be deleted by a retention
    // rule it was never part of.
    expect(archivesToPrune([...names, "my-notes.txt", "important.zip"], 1)).toEqual([
      "2026-10-01-00-00-00.zip",
      "2026-10-02-00-00-00.zip",
    ]);
  });

  it("sorts by name, which for this stamp format is by age", () => {
    const shuffled = [names[2], names[0], names[1]];
    expect(archivesToPrune(shuffled, 1)).toEqual([
      "2026-10-01-00-00-00.zip",
      "2026-10-02-00-00-00.zip",
    ]);
  });
});

describe("backupDatabase", () => {
  it("snapshots, compresses, writes the archive and clears the staging file", async () => {
    const store = new FakeStore();
    const snapshotter = new FakeSnapshotter();

    const summary = await run(store, snapshotter);

    expect(snapshotter.snapshots).toEqual(["/tmp/myhomebase-backup-2026-10-09-17-00-00.db"]);
    expect(summary.archiveName).toBe("2026-10-09-17-00-00.zip");
    expect(store.written.has("2026-10-09-17-00-00.zip")).toBe(true);
    // 5 bytes in, halved by the fake compressor.
    expect(summary.archiveBytes).toBe(3);
    expect(snapshotter.deleted).toEqual(["/tmp/myhomebase-backup-2026-10-09-17-00-00.db"]);
  });

  it("prunes only after the new archive is written", async () => {
    const store = new FakeStore();
    store.existing = [
      "2026-10-01-00-00-00.zip",
      "2026-10-02-00-00-00.zip",
      "2026-10-03-00-00-00.zip",
    ];

    const summary = await run(store, new FakeSnapshotter(), 2);

    // Four archives existed at prune time (three old + the new one), so the two
    // oldest go. The new one is never a candidate.
    expect(summary.prunedNames).toEqual(["2026-10-01-00-00-00.zip", "2026-10-02-00-00-00.zip"]);
    expect(store.existing).toContain("2026-10-09-17-00-00.zip");
  });

  it("deletes nothing when the snapshot fails", async () => {
    // The whole reason the prune runs last: a failed pass must never be the thing
    // that destroys the only good backup.
    const store = new FakeStore();
    store.existing = ["2026-10-01-00-00-00.zip", "2026-10-02-00-00-00.zip"];
    const snapshotter = new FakeSnapshotter();
    snapshotter.failWith = new Error("database is locked");

    await expect(run(store, snapshotter, 1)).rejects.toThrow("database is locked");

    expect(store.deleted).toEqual([]);
    expect(store.existing).toEqual(["2026-10-01-00-00-00.zip", "2026-10-02-00-00-00.zip"]);
  });

  it("still clears the staging file when the snapshot fails", async () => {
    const snapshotter = new FakeSnapshotter();
    snapshotter.failWith = new Error("disk full");

    await expect(run(new FakeStore(), snapshotter)).rejects.toThrow("disk full");

    expect(snapshotter.deleted).toEqual(["/tmp/myhomebase-backup-2026-10-09-17-00-00.db"]);
  });
});
