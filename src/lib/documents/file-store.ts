// The document folder: the port the use-cases depend on, and its Node implementation.
//
// Like the HSA receipt folder and unlike the photo archive (read-only by design), this
// folder is WRITTEN — it is where the app files a document's attachments. Every path a
// use-case passes is relative to the configured root and is resolved through
// `resolveInside`, which refuses anything that would land outside it, so a crafted
// path can't write, read or delete elsewhere on the share.
//
// Nothing here deletes recursively and nothing here unlinks a document's files. A
// delete-with-files MOVES the document's folder into `_deleted/`, which is what makes a
// mistaken delete recoverable by hand on the NAS.

import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { DELETED_FOLDER } from "./attachment-path";

/** One level of the folder browser. */
export interface FolderListing {
  /** The folder being shown, as the server resolved it. */
  path: string;
  /** Its parent, or `null` at a filesystem root. */
  parent: string | null;
  /** Sub-folder names, alphabetical. Hidden and NAS-housekeeping folders are left out. */
  folders: string[];
}

export type DocumentRootCheck =
  | { kind: "ok"; path: string }
  | { kind: "not-configured" }
  | { kind: "missing"; path: string }
  | { kind: "not-a-directory"; path: string }
  | { kind: "not-writable"; path: string; reason: string };

export interface DocumentFileStore {
  /** Writes (or overwrites) a file, creating its document folder if needed. */
  write(root: string, relativePath: string, data: Buffer): Promise<void>;
  /** The bytes, or `undefined` if the file is not there. */
  read(root: string, relativePath: string): Promise<Buffer | undefined>;
  exists(root: string, relativePath: string): Promise<boolean>;
  /**
   * Moves a document's whole folder into `_deleted/`, so the files survive a delete.
   *
   * A no-op when the folder isn't there — a document whose files were already moved or
   * removed by hand must still be deletable.
   */
  moveToDeleted(root: string, documentId: number): Promise<void>;
  /** Moves one file into `_deleted/`, for removing a single attachment. */
  moveFileToDeleted(root: string, relativePath: string): Promise<void>;
  /** Whether the root exists, is a folder, and accepts a write. */
  checkRoot(root: string): Promise<DocumentRootCheck>;
  /** The folder browser. An empty `absolutePath` starts at the server's filesystem root. */
  listFolders(absolutePath: string): Promise<FolderListing>;
}

/** NAS housekeeping folders nobody files a document into. Same list as the photo store. */
const SKIPPED_FOLDERS = new Set(["@eadir", ".@__thumb", "#recycle", ".ds_store"]);

/**
 * Resolves a relative path inside `root`, refusing one that escapes it.
 *
 * Exported for its test: this is the guard that stands between a stored or crafted
 * `relative_path` and the rest of the share. Every method below goes through it, and
 * nothing in this module may build a path any other way.
 */
export function resolveInside(root: string, relativePath: string): string {
  if (root.trim() === "") throw new Error("No document folder is set.");
  const base = path.resolve(root);
  const target = path.resolve(base, relativePath);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error("That document path is outside the document folder.");
  }
  return target;
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException)?.code;
}

/**
 * A name that cannot already exist, for a `_deleted` destination.
 *
 * Deleting a document, re-filing it and deleting it again would otherwise collide on
 * `_deleted/doc_17`, and `rename` onto an existing non-empty folder fails on Windows.
 * The timestamp makes each delete its own folder and keeps them in date order.
 */
function deletedStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export class NodeDocumentFileStore implements DocumentFileStore {
  async write(root: string, relativePath: string, data: Buffer): Promise<void> {
    const target = resolveInside(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  async read(root: string, relativePath: string): Promise<Buffer | undefined> {
    try {
      return await readFile(resolveInside(root, relativePath));
    } catch (error) {
      if (errorCode(error) === "ENOENT") return undefined;
      throw error;
    }
  }

  async exists(root: string, relativePath: string): Promise<boolean> {
    try {
      await stat(resolveInside(root, relativePath));
      return true;
    } catch (error) {
      if (errorCode(error) === "ENOENT") return false;
      throw error;
    }
  }

  async moveToDeleted(root: string, documentId: number): Promise<void> {
    const from = resolveInside(root, `doc_${documentId}`);
    const to = resolveInside(root, `${DELETED_FOLDER}/doc_${documentId}_${deletedStamp()}`);
    try {
      await mkdir(path.dirname(to), { recursive: true });
      await rename(from, to);
    } catch (error) {
      // A document with no files on disk is still a document, and must still delete.
      if (errorCode(error) === "ENOENT") return;
      throw error;
    }
  }

  async moveFileToDeleted(root: string, relativePath: string): Promise<void> {
    const from = resolveInside(root, relativePath);
    const fileName = path.basename(relativePath);
    const to = resolveInside(root, `${DELETED_FOLDER}/${deletedStamp()}_${fileName}`);
    try {
      await mkdir(path.dirname(to), { recursive: true });
      await rename(from, to);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return;
      throw error;
    }
  }

  async checkRoot(root: string): Promise<DocumentRootCheck> {
    const trimmed = root.trim();
    if (trimmed === "") return { kind: "not-configured" };
    try {
      const stats = await stat(trimmed);
      if (!stats.isDirectory()) return { kind: "not-a-directory", path: trimmed };
    } catch (error) {
      if (errorCode(error) === "ENOENT") return { kind: "missing", path: trimmed };
      return { kind: "not-writable", path: trimmed, reason: errorCode(error) ?? String(error) };
    }
    // `access(W_OK)` alone is not trusted: on an SMB share or a Synology ACL it can
    // report writable for a folder that then refuses the write. Writing and removing a
    // probe file is the only honest answer. The same lesson the HSA receipt store
    // records, and the reason this check exists at all.
    const probe = path.join(trimmed, `.myhomebase-write-test-${process.pid}-${Date.now()}`);
    try {
      await access(trimmed, constants.W_OK);
      await writeFile(probe, "ok");
      await rm(probe, { force: true });
      return { kind: "ok", path: trimmed };
    } catch (error) {
      return { kind: "not-writable", path: trimmed, reason: errorCode(error) ?? String(error) };
    }
  }

  async listFolders(absolutePath: string): Promise<FolderListing> {
    const start = absolutePath.trim() === "" ? path.parse(process.cwd()).root : absolutePath.trim();
    const resolved = path.resolve(start);
    let entries;
    try {
      entries = await readdir(resolved, { withFileTypes: true });
    } catch (error) {
      const code = errorCode(error);
      throw new Error(
        code === "ENOENT"
          ? `There is no folder at ${resolved}.`
          : code === "ENOTDIR"
            ? `${resolved} is a file, not a folder.`
            : `The server cannot open ${resolved} (${code ?? "unknown error"}).`,
      );
    }
    const folders = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith(".") && !SKIPPED_FOLDERS.has(name.toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    const parent = path.dirname(resolved);
    return { path: resolved, parent: parent === resolved ? null : parent, folders };
  }
}
