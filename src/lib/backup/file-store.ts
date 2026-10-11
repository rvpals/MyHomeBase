// The Node adapter behind `BackupFileStore`. The only file in this module that
// touches a real filesystem.
//
// Paths are kept relative-with-forward-slashes in the domain and converted at this
// boundary, so the use-cases compare `notes/receipt.pdf` on every platform while
// Windows still gets a real `\` path.

import { constants } from "node:fs";
import { access, copyFile, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BackupFileInfo, BackupFileStore, RootCheck } from "./ports";

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException)?.code;
}

/**
 * Resolves a relative path inside a root, refusing anything that escapes it.
 *
 * The same guard as `resolveInside` in `src/lib/household/receipt-store.ts`. These
 * paths come from the names of files on disk rather than from a request, but a
 * symlinked or oddly-named entry must still not let a copy land outside the folder
 * the reader chose.
 */
function resolveInside(root: string, relativePath: string): string {
  const base = path.resolve(root);
  const target = path.resolve(base, relativePath);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error("That path is outside the backup folder.");
  }
  return target;
}

/** Folders a NAS keeps for itself, never worth backing up. Mirrors receipt-store.ts. */
const SKIPPED_FOLDERS = new Set(["@eadir", ".@__thumb", "#recycle", ".ds_store"]);

export class NodeBackupFileStore implements BackupFileStore {
  async listFiles(root: string): Promise<BackupFileInfo[]> {
    const base = path.resolve(root);
    const found: BackupFileInfo[] = [];

    const walk = async (directory: string, prefix: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        // A missing root is an empty list, not a throw: the preflight is what tells
        // the reader their folder is gone, with the path in the message.
        if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return;
        throw error;
      }

      for (const entry of entries) {
        if (entry.name.startsWith(".") || SKIPPED_FOLDERS.has(entry.name.toLowerCase())) continue;
        const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;

        if (entry.isDirectory()) {
          await walk(path.join(directory, entry.name), relativePath);
          continue;
        }
        if (!entry.isFile()) continue;

        const stats = await stat(path.join(directory, entry.name));
        found.push({
          relativePath,
          modifiedAtMs: stats.mtimeMs,
          sizeBytes: stats.size,
        });
      }
    };

    await walk(base, "");
    return found;
  }

  async statFile(root: string, relativePath: string): Promise<BackupFileInfo | undefined> {
    try {
      const stats = await stat(resolveInside(root, relativePath));
      return { relativePath, modifiedAtMs: stats.mtimeMs, sizeBytes: stats.size };
    } catch (error) {
      if (errorCode(error) === "ENOENT") return undefined;
      throw error;
    }
  }

  async copyFile(fromRoot: string, toRoot: string, relativePath: string): Promise<void> {
    const target = resolveInside(toRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(resolveInside(fromRoot, relativePath), target);
  }

  async renameWithin(root: string, fromRelativePath: string, toRelativePath: string): Promise<void> {
    const to = resolveInside(root, toRelativePath);
    await mkdir(path.dirname(to), { recursive: true });
    await rename(resolveInside(root, fromRelativePath), to);
  }

  async writeFile(root: string, name: string, data: Uint8Array): Promise<void> {
    const target = resolveInside(root, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  async deleteFile(root: string, name: string): Promise<void> {
    // `force` makes a missing file a no-op. Never recursive: this deletes one file.
    await rm(resolveInside(root, name), { force: true });
  }

  async listTopLevelFiles(root: string): Promise<string[]> {
    try {
      const entries = await readdir(path.resolve(root), { withFileTypes: true });
      return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    } catch (error) {
      if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return [];
      throw error;
    }
  }

  async checkRoot(root: string): Promise<RootCheck> {
    const trimmed = root.trim();
    try {
      const stats = await stat(trimmed);
      if (!stats.isDirectory()) return { kind: "not-a-directory", path: trimmed };
    } catch (error) {
      if (errorCode(error) === "ENOENT") return { kind: "missing", path: trimmed };
      return { kind: "not-writable", path: trimmed, reason: errorCode(error) ?? String(error) };
    }

    // `access(W_OK)` alone is not trusted: on an SMB share or a Synology ACL it can
    // report writable for a folder that then refuses the write. Writing and removing
    // a probe file is the only honest answer. Same test as receipt-store.ts.
    const probe = path.join(trimmed, `.myhomebase-backup-test-${process.pid}-${Date.now()}`);
    try {
      await access(trimmed, constants.W_OK);
      await writeFile(probe, "ok");
      await rm(probe, { force: true });
      return { kind: "ok", path: trimmed };
    } catch (error) {
      return { kind: "not-writable", path: trimmed, reason: errorCode(error) ?? String(error) };
    }
  }
}
