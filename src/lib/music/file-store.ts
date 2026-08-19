import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { extensionOf, isMusicExtension, type MusicExtension } from "./formats";
import { normaliseRelativePath, resolveTrackPath, toRelativePath } from "./paths";
import type { MusicFileStore } from "./ports";
import type { AlbumCover, FolderNode, TrackFileFacts } from "./types";

// Real filesystem access for the music folder, over the music root configured in
// wiring.ts (`//NAS_DS223/MEDIA/AUDIO` from Windows in dev, `/volume1/MEDIA/AUDIO`
// on the NAS itself).
//
// READ-ONLY, AND MUST STAY THAT WAY. This class imports only reading functions from
// node:fs -- no writeFile, no rename, no unlink, no mkdir, no utimes. The music
// collection is irreplaceable and this module exists to catalog it, not to manage
// it. Adding a write here would defeat the guarantee the port documents, so do not:
// a feature that genuinely needs to write needs its own named port and a migration
// log entry justifying it.

/** Sibling filenames that conventionally hold album art, in preference order. */
const COVER_BASENAMES = ["cover", "folder", "front", "album", "albumart"];
const COVER_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

/**
 * Folders that never hold music worth cataloguing.
 *
 * `@eaDir` is Synology's own thumbnail and index store and appears in EVERY folder
 * on a DSM volume -- walking into it would roughly double the traversal and
 * catalog duplicate junk. `#recycle` is the share's recycle bin, which can hold
 * deleted copies of real tracks.
 */
const SKIPPED_FOLDERS = new Set(["@eadir", ".@__thumb", "#recycle", ".ds_store"]);

export class NodeMusicFileStore implements MusicFileStore {
  constructor(private readonly musicRoot: string) {}

  async isRootAvailable(): Promise<boolean> {
    if (this.musicRoot.trim() === "") return false;
    try {
      const stats = await stat(this.musicRoot);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  async listFolders(relativeFolder: string): Promise<FolderNode[]> {
    const absolute = this.absoluteOf(relativeFolder);
    if (absolute === undefined) return [];

    let entries;
    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch {
      // An unreadable folder is empty as far as the picker is concerned -- a
      // permissions problem on one sub-folder must not break the whole tree.
      return [];
    }

    const folders: FolderNode[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIPPED_FOLDERS.has(entry.name.toLowerCase())) continue;

      const childRelative = joinRelative(relativeFolder, entry.name);
      folders.push({
        name: entry.name,
        relativePath: childRelative,
        hasChildren: await this.hasSubfolder(childRelative),
      });
    }

    return folders.sort((left, right) => left.name.localeCompare(right.name));
  }

  /**
   * Walks for candidate audio files without opening any of them.
   *
   * An async generator rather than an array: the library measured 20k files, and the
   * two-phase scan walks it twice (once to count for the progress bar, once to read
   * tags). Materialising 20k paths each time would be wasteful, and yielding lets a
   * cancelled scan stop mid-walk instead of finishing the traversal first.
   */
  async *walkAudioFiles(
    relativeFolder: string,
    extensions: readonly MusicExtension[],
  ): AsyncIterable<TrackFileFacts> {
    const allowed = new Set(extensions.map((extension) => extension.toLowerCase()));
    const start = normaliseRelativePath(relativeFolder);

    // An explicit stack rather than recursion: this library nests up to 8 levels and
    // a deep tree should not put that on the call stack.
    const pending: string[] = [start];

    while (pending.length > 0) {
      const folder = pending.pop() as string;
      const absolute = this.absoluteOf(folder);
      if (absolute === undefined) continue;

      let entries;
      try {
        entries = await readdir(absolute, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!SKIPPED_FOLDERS.has(entry.name.toLowerCase())) {
            pending.push(joinRelative(folder, entry.name));
          }
          continue;
        }
        if (!entry.isFile()) continue;

        const extension = extensionOf(entry.name);
        if (!isMusicExtension(extension) || !allowed.has(extension)) continue;

        const facts = await this.statFile(joinRelative(folder, entry.name));
        if (facts !== undefined) yield facts;
      }
    }
  }

  async statFile(relativePath: string): Promise<TrackFileFacts | undefined> {
    const absolute = this.absoluteOf(relativePath);
    if (absolute === undefined) return undefined;
    try {
      const stats = await stat(absolute);
      if (!stats.isFile()) return undefined;
      return {
        relativePath: normaliseRelativePath(relativePath),
        fileSize: stats.size,
        fileMtime: stats.mtime.toISOString(),
      };
    } catch {
      return undefined;
    }
  }

  /**
   * A byte range of a file as a web stream, for the streaming route.
   *
   * `createReadStream` with start/end rather than reading the file: a 40 MB FLAC
   * buffered per listener would be 40 MB of RAM on a 2 GB NAS, and seeking would be
   * impossible. This way the cost is one buffer regardless of file size.
   */
  async openRange(
    relativePath: string,
    start: number,
    end: number,
  ): Promise<ReadableStream<Uint8Array>> {
    const absolute = this.absoluteOf(relativePath);
    if (absolute === undefined) {
      throw new Error(`Refusing to read a path outside the music root: "${relativePath}".`);
    }
    const nodeStream = createReadStream(absolute, { start, end });
    return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  }

  async readFolderCover(relativeFolder: string): Promise<AlbumCover | undefined> {
    const absolute = this.absoluteOf(relativeFolder);
    if (absolute === undefined) return undefined;

    let entries;
    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch {
      return undefined;
    }

    // Case-insensitive lookup: the same folder is reached over SMB from Windows in
    // dev and from ext4/btrfs on the NAS, which disagree about case.
    const byName = new Map<string, string>();
    for (const entry of entries) {
      if (entry.isFile()) byName.set(entry.name.toLowerCase(), entry.name);
    }

    for (const base of COVER_BASENAMES) {
      for (const extension of COVER_EXTENSIONS) {
        const actualName = byName.get(`${base}.${extension}`);
        if (actualName === undefined) continue;
        const coverPath = this.absoluteOf(joinRelative(relativeFolder, actualName));
        if (coverPath === undefined) continue;
        try {
          return { data: await readFile(coverPath), mimeType: mimeForImage(extension) };
        } catch {
          // Try the next candidate rather than failing the whole scan.
        }
      }
    }

    return undefined;
  }

  /** Whether a folder has a sub-folder, so the picker knows to show a chevron. */
  private async hasSubfolder(relativeFolder: string): Promise<boolean> {
    const absolute = this.absoluteOf(relativeFolder);
    if (absolute === undefined) return false;
    try {
      const entries = await readdir(absolute, { withFileTypes: true });
      return entries.some(
        (entry) => entry.isDirectory() && !SKIPPED_FOLDERS.has(entry.name.toLowerCase()),
      );
    } catch {
      return false;
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
      return this.musicRoot.trim() === "" ? undefined : this.musicRoot;
    }
    return resolveTrackPath(this.musicRoot, normalised);
  }

  /** Exposed for the scanner, which walks absolute paths and stores relative ones. */
  relativeOf(absolutePath: string): string | undefined {
    return toRelativePath(this.musicRoot, absolutePath);
  }
}

function joinRelative(folder: string, name: string): string {
  const base = normaliseRelativePath(folder);
  return base === "" ? name : `${base}/${name}`;
}

function mimeForImage(extension: string): string {
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return "image/jpeg";
}
