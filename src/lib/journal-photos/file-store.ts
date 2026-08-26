import { open, readdir, readFile, stat } from "node:fs/promises";
import { isPhotoFileName, normaliseRelativePath, resolvePhotoPath } from "./paths";
import type { PhotoFileStore } from "./ports";
import type { PhotoRootCheck } from "./types";

// Real filesystem access for the photo archive, over the root configured in wiring.ts
// (`/volume1/MEDIA/PHOTO/BY YEAR` on the NAS, a UNC path to the same share from
// Windows in dev).
//
// READ-ONLY, AND MUST STAY THAT WAY. This class imports only reading functions from
// node:fs -- no writeFile, no rename, no unlink, no mkdir, no utimes. These are the
// household's only copies of these photographs and this module exists to find them,
// not to manage them. See the note on PhotoFileStore before adding anything here.

/**
 * Folders that never hold photos worth listing.
 *
 * `@eaDir` is Synology's own thumbnail and index store and appears in EVERY folder on
 * a DSM volume -- it is full of JPEG thumbnails, so listing it would offer folders of
 * postage stamps alongside the real ones. `#recycle` is the share's recycle bin, which
 * can hold deleted copies of the same photos.
 */
const SKIPPED_FOLDERS = new Set(["@eadir", ".@__thumb", "#recycle", ".ds_store"]);

export class NodePhotoFileStore implements PhotoFileStore {
  constructor(private readonly photoRoot: string) {}

  async isRootAvailable(): Promise<boolean> {
    return (await this.checkRoot()).kind === "ok";
  }

  /**
   * Why the root is or isn't usable, as opposed to just whether it is.
   *
   * A bare boolean here cost real debugging time: an unset env var, a wrong path, a
   * share the app's user cannot read, and a file-where-a-folder-was all looked
   * identical in the UI ("isn't configured or can't be reached"), so the one message
   * gave no clue which of four fixes to apply. `stat` already knows -- it throws
   * ENOENT, EACCES or EPERM -- and this keeps that distinction instead of discarding
   * it.
   *
   * Permissions are the case worth calling out on a Synology: DSM shared folders are
   * owned by root with per-share ACLs, so the app's own user can be denied a folder
   * that plainly exists and that any admin shell can list.
   */
  async checkRoot(): Promise<PhotoRootCheck> {
    const root = this.photoRoot.trim();
    if (root === "") return { kind: "not-configured" };

    try {
      const stats = await stat(root);
      if (!stats.isDirectory()) return { kind: "not-a-directory", path: root };
      return { kind: "ok", path: root };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return { kind: "missing", path: root };
      if (code === "EACCES" || code === "EPERM") return { kind: "no-permission", path: root };
      // ETIMEDOUT / EHOSTUNREACH / EIO -- a share that is configured but not answering.
      return { kind: "unreachable", path: root, code };
    }
  }

  async folderExists(relativeFolder: string): Promise<boolean> {
    const absolute = this.absoluteOf(relativeFolder);
    if (absolute === undefined) return false;
    try {
      const stats = await stat(absolute);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  async listFolderNames(relativeFolder: string): Promise<string[]> {
    const absolute = this.absoluteOf(relativeFolder);
    if (absolute === undefined) return [];

    let entries;
    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch {
      // An unreadable folder is empty as far as the lookup is concerned -- a
      // permissions problem on one year must not break the card.
      return [];
    }

    return entries
      .filter((entry) => entry.isDirectory() && !SKIPPED_FOLDERS.has(entry.name.toLowerCase()))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  }

  async listPhotoNames(relativeFolder: string): Promise<string[]> {
    const absolute = this.absoluteOf(relativeFolder);
    if (absolute === undefined) return [];

    let entries;
    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch {
      return [];
    }

    return entries
      .filter((entry) => entry.isFile() && isPhotoFileName(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  }

  /**
   * The first `byteCount` bytes of a file.
   *
   * A file handle and one positional read rather than `readFile`: this runs once per
   * photo in a month folder, and pulling whole 6MB JPEGs over SMB to read a timestamp
   * in the first few KB would take the scan from seconds to minutes. A short file is
   * fine -- the read simply returns fewer bytes and the parser handles a truncated
   * buffer.
   */
  async readHeader(relativePath: string, byteCount: number): Promise<Uint8Array | undefined> {
    const absolute = this.absoluteOf(relativePath);
    if (absolute === undefined) return undefined;

    let handle;
    try {
      handle = await open(absolute, "r");
    } catch {
      return undefined;
    }

    try {
      const buffer = new Uint8Array(byteCount);
      const { bytesRead } = await handle.read(buffer, 0, byteCount, 0);
      return buffer.subarray(0, bytesRead);
    } catch {
      return undefined;
    } finally {
      // Always closed, including on a mid-read failure -- a month scan opens hundreds
      // of handles and a leak here would exhaust the process rather than fail one photo.
      await handle.close().catch(() => {});
    }
  }

  async readPhoto(
    relativePath: string,
  ): Promise<{ data: Uint8Array; mimeType: string } | undefined> {
    const absolute = this.absoluteOf(relativePath);
    if (absolute === undefined) return undefined;
    if (!isPhotoFileName(relativePath)) return undefined;

    try {
      const stats = await stat(absolute);
      if (!stats.isFile()) return undefined;
      return { data: await readFile(absolute), mimeType: "image/jpeg" };
    } catch {
      return undefined;
    }
  }

  /**
   * The absolute path for a relative one, or `undefined` when it is not safe.
   *
   * Every filesystem call in this class goes through here, so the traversal guard in
   * paths.ts cannot be bypassed by adding a method that forgets to apply it.
   */
  private absoluteOf(relativePath: string): string | undefined {
    const normalised = normaliseRelativePath(relativePath);
    if (normalised === "") {
      return this.photoRoot.trim() === "" ? undefined : this.photoRoot;
    }
    return resolvePhotoPath(this.photoRoot, normalised);
  }
}
