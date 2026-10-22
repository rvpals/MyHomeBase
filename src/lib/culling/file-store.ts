import { readdir, readFile, stat } from "node:fs/promises";
import { normaliseRelativePath, resolvePhotoPath, type PhotoRootCheck } from "../journal-photos";
import { SUPPORTED_EXTENSIONS, UNSUPPORTED_EXTENSIONS } from "./config";
import type { CullingImageStore } from "./ports";

// Real filesystem access for the culler, over the same archive root the journal uses.
//
// READ-ONLY, AND MUST STAY THAT WAY. This class imports only reading functions from
// node:fs -- no writeFile, no rename, no unlink, no mkdir, no utimes. Culling ranks
// photographs; it does not act on the ranking, and there is no code path from a score
// to a deletion because the capability does not exist here. Same rule, same reasoning,
// as `NodePhotoFileStore`.

/**
 * Folders that never hold photos worth culling.
 *
 * `@eaDir` is Synology's own thumbnail store and appears in every folder on a DSM
 * volume; culling it would rank postage stamps. `#recycle` can hold deleted copies of
 * the very photos being culled, which would then group as duplicates of themselves.
 */
const SKIPPED_NAMES = new Set(["@eadir", ".@__thumb", "#recycle", ".ds_store"]);

export class NodeCullingImageStore implements CullingImageStore {
  constructor(private readonly photoRoot: string) {}

  /** @see CullingImageStore.checkRoot */
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
      return { kind: "unreachable", path: root, code };
    }
  }

  /** @see CullingImageStore.listImageNames */
  async listImageNames(relativeFolder: string): Promise<string[]> {
    return this.listMatching(relativeFolder, SUPPORTED_EXTENSIONS);
  }

  /** @see CullingImageStore.listUndecodableNames */
  async listUndecodableNames(relativeFolder: string): Promise<string[]> {
    return this.listMatching(relativeFolder, UNSUPPORTED_EXTENSIONS);
  }

  /** @see CullingImageStore.readImage */
  async readImage(relativePath: string): Promise<Uint8Array | undefined> {
    const absolute = resolvePhotoPath(this.photoRoot, relativePath);
    if (absolute === undefined) return undefined;

    try {
      return new Uint8Array(await readFile(absolute));
    } catch {
      // One unreadable photo is the caller's to record, not a reason to fail the run.
      return undefined;
    }
  }

  /** File names in a folder whose extension is in `extensions`, sorted. */
  private async listMatching(
    relativeFolder: string,
    extensions: readonly string[],
  ): Promise<string[]> {
    const absolute = resolvePhotoPath(this.photoRoot, normaliseRelativePath(relativeFolder));
    if (absolute === undefined) return [];

    let entries;
    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch {
      return [];
    }

    const wanted = new Set(extensions);

    return entries
      .filter((entry) => entry.isFile() && !SKIPPED_NAMES.has(entry.name.toLowerCase()))
      .map((entry) => entry.name)
      .filter((name) => {
        const dot = name.lastIndexOf(".");
        return dot > 0 && wanted.has(name.slice(dot + 1).toLowerCase());
      })
      .sort((left, right) => left.localeCompare(right));
  }
}
