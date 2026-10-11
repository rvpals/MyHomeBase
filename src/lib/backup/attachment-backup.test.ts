import { beforeEach, describe, expect, it } from "vitest";
import { archivedName, backupAttachments, isNewer, timestampSuffix } from "./attachment-backup";
import type { BackupFileInfo, BackupFileStore, RootCheck } from "./ports";

const NOW = new Date(2026, 9, 9, 17, 0, 0); // 2026-10-09 17:00:00 local

/**
 * An in-memory `BackupFileStore`. Two flat maps of relativePath -> mtime, which is
 * all the newer-than rule looks at.
 */
class FakeStore implements BackupFileStore {
  source = new Map<string, number>();
  backup = new Map<string, number>();
  /** Relative paths that throw when copied, to exercise the per-file failure path. */
  failOnCopy = new Set<string>();
  renames: { from: string; to: string }[] = [];

  async listFiles(root: string): Promise<BackupFileInfo[]> {
    const map = root === "src" ? this.source : this.backup;
    return [...map.entries()].map(([relativePath, modifiedAtMs]) => ({
      relativePath,
      modifiedAtMs,
      sizeBytes: 1,
    }));
  }

  async statFile(root: string, relativePath: string): Promise<BackupFileInfo | undefined> {
    const map = root === "src" ? this.source : this.backup;
    const modifiedAtMs = map.get(relativePath);
    return modifiedAtMs === undefined
      ? undefined
      : { relativePath, modifiedAtMs, sizeBytes: 1 };
  }

  async copyFile(_fromRoot: string, _toRoot: string, relativePath: string): Promise<void> {
    if (this.failOnCopy.has(relativePath)) throw new Error("disk full");
    this.backup.set(relativePath, this.source.get(relativePath)!);
  }

  async renameWithin(_root: string, from: string, to: string): Promise<void> {
    this.renames.push({ from, to });
    const existing = this.backup.get(from)!;
    this.backup.delete(from);
    this.backup.set(to, existing);
  }

  async writeFile(): Promise<void> {}
  async deleteFile(): Promise<void> {}
  async listTopLevelFiles(): Promise<string[]> {
    return [];
  }
  async checkRoot(root: string): Promise<RootCheck> {
    return { kind: "ok", path: root };
  }
}

let store: FakeStore;

beforeEach(() => {
  store = new FakeStore();
});

function run() {
  return backupAttachments({ store, sourceRoot: "src", backupRoot: "dst", now: NOW });
}

describe("timestampSuffix / archivedName", () => {
  it("formats the stamp with no colons", () => {
    // `:` is not a legal filename character on Windows or an SMB share.
    expect(timestampSuffix(NOW)).toBe("2026-10-09-17-00-00");
  });

  it("puts the stamp before the extension so the file still opens", () => {
    expect(archivedName("receipt.pdf", NOW)).toBe("receipt_2026-10-09-17-00-00.pdf");
  });

  it("keeps the sub-folder on an archived name", () => {
    expect(archivedName("2026/receipt.pdf", NOW)).toBe("2026/receipt_2026-10-09-17-00-00.pdf");
  });

  it("handles a file with no extension", () => {
    expect(archivedName("NOTES", NOW)).toBe("NOTES_2026-10-09-17-00-00");
  });

  it("treats a dotfile as a name, not an extension", () => {
    expect(archivedName(".env", NOW)).toBe(".env_2026-10-09-17-00-00");
  });
});

describe("isNewer", () => {
  const source: BackupFileInfo = { relativePath: "a.pdf", modifiedAtMs: 1_000, sizeBytes: 1 };

  it("is true when there is no backup copy", () => {
    expect(isNewer(source, undefined)).toBe(true);
  });

  it("is false when the timestamps are equal", () => {
    // Equal means this is the copy already backed up; copying again would fill the
    // folder with identical duplicates on every pass.
    expect(isNewer(source, { ...source, modifiedAtMs: 1_000 })).toBe(false);
  });

  it("is false when the backup copy is newer", () => {
    expect(isNewer(source, { ...source, modifiedAtMs: 2_000 })).toBe(false);
  });
});

describe("backupAttachments", () => {
  it("copies a file that has no backup copy", async () => {
    store.source.set("2026/a.pdf", 1_000);

    const summary = await run();

    expect(summary.copied).toBe(1);
    expect(summary.files[0]).toEqual({ relativePath: "2026/a.pdf", status: "copied" });
    expect(store.backup.get("2026/a.pdf")).toBe(1_000);
  });

  it("renames the older copy aside, then copies the newer file", async () => {
    store.source.set("a.pdf", 2_000);
    store.backup.set("a.pdf", 1_000);

    const summary = await run();

    expect(summary.replaced).toBe(1);
    expect(summary.files[0].archivedAs).toBe("a_2026-10-09-17-00-00.pdf");
    // The rename happened before the copy, so the good copy was never overwritten.
    expect(store.renames).toEqual([{ from: "a.pdf", to: "a_2026-10-09-17-00-00.pdf" }]);
    expect(store.backup.get("a_2026-10-09-17-00-00.pdf")).toBe(1_000);
    expect(store.backup.get("a.pdf")).toBe(2_000);
  });

  it("skips a file whose backup copy is current", async () => {
    store.source.set("a.pdf", 1_000);
    store.backup.set("a.pdf", 1_000);

    const summary = await run();

    expect(summary.skipped).toBe(1);
    expect(store.renames).toEqual([]);
  });

  it("keeps going after one file fails, and reports it", async () => {
    // A pass that aborted on the first unreadable file would leave a partial backup
    // and no record of what was missed.
    store.source.set("bad.pdf", 1_000);
    store.source.set("good.pdf", 1_000);
    store.failOnCopy.add("bad.pdf");

    const summary = await run();

    expect(summary.failed).toBe(1);
    expect(summary.copied).toBe(1);
    expect(summary.files.find((file) => file.relativePath === "bad.pdf")?.error).toBe("disk full");
    expect(store.backup.get("good.pdf")).toBe(1_000);
  });

  it("does nothing on an empty source folder", async () => {
    const summary = await run();

    expect(summary.files).toEqual([]);
    expect(summary.copied + summary.replaced + summary.skipped + summary.failed).toBe(0);
  });
});
