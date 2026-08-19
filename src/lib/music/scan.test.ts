import { describe, expect, it } from "vitest";
import type { MusicExtension } from "./formats";
import type {
  AudioMetadataReader,
  MusicFileStore,
  MusicRepository,
  TrackTags,
} from "./ports";
import { scanLibrary } from "./scan";
import type { AlbumCover, FolderNode, TrackFileFacts, TrackUpsert } from "./types";

// Tested with fakes: no disk, no database, no audio. The scanner's job is decisions --
// what to skip, what to count, when to stop -- and those are what these pin down.

interface FakeFile {
  relativePath: string;
  fileSize: number;
  fileMtime: string;
  tags?: TrackTags;
  /** Simulates a corrupt file: present on disk, unreadable by the tag parser. */
  unreadable?: boolean;
}

function fakeStore(files: FakeFile[], available = true): MusicFileStore {
  return {
    isRootAvailable: async () => available,
    listFolders: async (): Promise<FolderNode[]> => [],
    walkAudioFiles: async function* (
      relativeFolder: string,
      extensions: readonly MusicExtension[],
    ): AsyncIterable<TrackFileFacts> {
      const allowed = new Set(extensions);
      for (const file of files) {
        const extension = file.relativePath.split(".").pop() as MusicExtension;
        if (!allowed.has(extension)) continue;
        if (relativeFolder !== "" && !file.relativePath.startsWith(`${relativeFolder}/`)) continue;
        yield {
          relativePath: file.relativePath,
          fileSize: file.fileSize,
          fileMtime: file.fileMtime,
        };
      }
    },
    statFile: async (relativePath) => {
      const file = files.find((entry) => entry.relativePath === relativePath);
      return file === undefined
        ? undefined
        : { relativePath, fileSize: file.fileSize, fileMtime: file.fileMtime };
    },
    openRange: async () => new ReadableStream(),
    readFolderCover: async (): Promise<AlbumCover | undefined> => undefined,
  };
}

function fakeReader(files: FakeFile[]): AudioMetadataReader {
  return {
    read: async (relativePath) => {
      const file = files.find((entry) => entry.relativePath === relativePath);
      if (file === undefined || file.unreadable === true) return undefined;
      return file.tags ?? {};
    },
  };
}

function fakeRepo(existing: TrackFileFacts[] = []) {
  const upserts: TrackUpsert[] = [];
  const facts = new Map(existing.map((entry) => [entry.relativePath, entry]));
  const albums = new Map<string, number>();
  const covers = new Map<number, AlbumCover>();
  const runs: Record<string, unknown>[] = [];
  const recounted: number[] = [];
  let deletedFrom: { folder: string; kept: readonly string[] } | undefined;
  let finished: { status: string; error?: string } | undefined;
  let total = 0;

  const repo = {
    createScanRun: () => 1,
    setScanRunTotal: (_id: number, filesTotal: number) => {
      total = filesTotal;
    },
    updateScanRunProgress: (_id: number, progress: Record<string, unknown>) => {
      runs.push({ ...progress });
    },
    finishScanRun: (_id: number, status: string, error?: string) => {
      finished = { status, error };
    },
    getTrackFileFacts: (relativePath: string) => facts.get(relativePath),
    upsertTrack: (track: TrackUpsert) => {
      upserts.push(track);
      facts.set(track.relativePath, {
        relativePath: track.relativePath,
        fileSize: track.fileSize,
        fileMtime: track.fileMtime,
      });
      return upserts.length;
    },
    upsertAlbum: (album: { name: string; albumArtist: string }) => {
      const key = `${album.name}::${album.albumArtist}`.toLowerCase();
      if (!albums.has(key)) albums.set(key, albums.size + 1);
      return albums.get(key) as number;
    },
    albumHasCover: (albumId: number) => covers.has(albumId),
    recountAlbumTracks: (albumId: number) => {
      recounted.push(albumId);
    },
    setAlbumCover: (albumId: number, cover: AlbumCover) => {
      covers.set(albumId, cover);
    },
    deleteTracksMissingFrom: (folder: string, kept: readonly string[]) => {
      deletedFrom = { folder, kept };
      const removable = [...facts.keys()].filter((path) => !kept.includes(path));
      for (const path of removable) facts.delete(path);
      return removable.length;
    },
  } as unknown as MusicRepository;

  return {
    repo,
    upserts,
    albums,
    covers,
    runs,
    recounted,
    get total() {
      return total;
    },
    get finished() {
      return finished;
    },
    get deletedFrom() {
      return deletedFrom;
    },
  };
}

const MP3_FLAC: MusicExtension[] = ["mp3", "flac"];

function file(relativePath: string, overrides: Partial<FakeFile> = {}): FakeFile {
  return { relativePath, fileSize: 1000, fileMtime: "2026-01-01T00:00:00Z", ...overrides };
}

describe("scanLibrary", () => {
  it("catalogs new files and reports what it did", async () => {
    const files = [
      file("CHINESE/Beyond/AMANI.flac", { tags: { title: "AMANI", artist: "Beyond" } }),
      file("ENGLISH/A/x.mp3", { tags: { title: "X", artist: "Y" } }),
    ];
    const repo = fakeRepo();

    const summary = await scanLibrary(
      { musicRepo: repo.repo, fileStore: fakeStore(files), metadataReader: fakeReader(files) },
      { folder: "", extensions: MP3_FLAC, skipUnstreamable: true },
    );

    expect(summary.status).toBe("completed");
    expect(summary.tracksAdded).toBe(2);
    expect(summary.filesSeen).toBe(2);
    expect(repo.upserts.map((entry) => entry.title)).toEqual(["AMANI", "X"]);
  });

  it("counts a total in phase one so a percentage is possible", async () => {
    const files = [file("a.mp3"), file("b.mp3"), file("c.flac")];
    const repo = fakeRepo();

    await scanLibrary(
      { musicRepo: repo.repo, fileStore: fakeStore(files), metadataReader: fakeReader(files) },
      { folder: "", extensions: MP3_FLAC, skipUnstreamable: true },
    );

    // Without this the progress bar has no denominator.
    expect(repo.total).toBe(3);
  });

  it("reports the file it is working on, for the progress display", async () => {
    const files = [file("a.mp3", { tags: { title: "A" } })];
    const repo = fakeRepo();

    await scanLibrary(
      { musicRepo: repo.repo, fileStore: fakeStore(files), metadataReader: fakeReader(files) },
      { folder: "", extensions: MP3_FLAC, skipUnstreamable: true },
    );

    expect(repo.runs.some((entry) => entry.currentPath === "a.mp3")).toBe(true);
  });

  it("skips a file whose size and mtime are unchanged", async () => {
    // This is what makes a re-scan take seconds instead of minutes.
    const files = [file("a.mp3", { tags: { title: "A" } })];
    const repo = fakeRepo([
      { relativePath: "a.mp3", fileSize: 1000, fileMtime: "2026-01-01T00:00:00Z" },
    ]);

    const summary = await scanLibrary(
      { musicRepo: repo.repo, fileStore: fakeStore(files), metadataReader: fakeReader(files) },
      { folder: "", extensions: MP3_FLAC, skipUnstreamable: true },
    );

    expect(summary.filesSkipped).toBe(1);
    expect(summary.tracksAdded).toBe(0);
    expect(repo.upserts).toHaveLength(0);
  });

  it("re-reads a file whose mtime moved", async () => {
    const files = [file("a.mp3", { fileMtime: "2026-06-01T00:00:00Z", tags: { title: "New" } })];
    const repo = fakeRepo([
      { relativePath: "a.mp3", fileSize: 1000, fileMtime: "2026-01-01T00:00:00Z" },
    ]);

    const summary = await scanLibrary(
      { musicRepo: repo.repo, fileStore: fakeStore(files), metadataReader: fakeReader(files) },
      { folder: "", extensions: MP3_FLAC, skipUnstreamable: true },
    );

    expect(summary.tracksUpdated).toBe(1);
    expect(summary.filesSkipped).toBe(0);
  });

  it("counts a corrupt file as failed and carries on", async () => {
    // One bad file in twenty thousand must not end the scan.
    const files = [
      file("bad.mp3", { unreadable: true }),
      file("good.mp3", { tags: { title: "Good" } }),
    ];
    const repo = fakeRepo();

    const summary = await scanLibrary(
      { musicRepo: repo.repo, fileStore: fakeStore(files), metadataReader: fakeReader(files) },
      { folder: "", extensions: MP3_FLAC, skipUnstreamable: true },
    );

    expect(summary.status).toBe("completed");
    expect(summary.filesFailed).toBe(1);
    expect(summary.tracksAdded).toBe(1);
    expect(summary.lastError).toContain("bad.mp3");
  });

  it("honours the format allowlist, never opening what it was not asked for", async () => {
    const files = [file("a.mp3", { tags: {} }), file("b.ape", { tags: {} })];
    const repo = fakeRepo();

    const summary = await scanLibrary(
      { musicRepo: repo.repo, fileStore: fakeStore(files), metadataReader: fakeReader(files) },
      { folder: "", extensions: ["mp3"], skipUnstreamable: true },
    );

    expect(summary.filesSeen).toBe(1);
    expect(repo.upserts.map((entry) => entry.relativePath)).toEqual(["a.mp3"]);
  });

  it("drops unplayable formats when skipUnstreamable is on", async () => {
    const files = [file("a.mp3", { tags: {} }), file("b.ape", { tags: {} })];
    const repo = fakeRepo();

    const summary = await scanLibrary(
      { musicRepo: repo.repo, fileStore: fakeStore(files), metadataReader: fakeReader(files) },
      { folder: "", extensions: ["mp3", "ape"], skipUnstreamable: true },
    );

    expect(repo.upserts.map((entry) => entry.relativePath)).toEqual(["a.mp3"]);
    expect(summary.filesSeen).toBe(1);
  });

  it("catalogs unplayable formats when asked to, marking them unstreamable", async () => {
    const files = [file("b.ape", { tags: { title: "Lossless" } })];
    const repo = fakeRepo();

    await scanLibrary(
      { musicRepo: repo.repo, fileStore: fakeStore(files), metadataReader: fakeReader(files) },
      { folder: "", extensions: ["ape"], skipUnstreamable: false },
    );

    expect(repo.upserts[0]).toMatchObject({ extension: "ape", isStreamable: false });
  });

  it("scans only the chosen folder", async () => {
    const files = [
      file("CHINESE/a.mp3", { tags: {} }),
      file("ENGLISH/b.mp3", { tags: {} }),
    ];
    const repo = fakeRepo();

    const summary = await scanLibrary(
      { musicRepo: repo.repo, fileStore: fakeStore(files), metadataReader: fakeReader(files) },
      { folder: "CHINESE", extensions: MP3_FLAC, skipUnstreamable: true },
    );

    expect(summary.filesSeen).toBe(1);
    expect(repo.upserts[0].relativePath).toBe("CHINESE/a.mp3");
  });

  it("groups tracks into albums and stores cover art once", async () => {
    const cover: AlbumCover = { data: Buffer.from("art"), mimeType: "image/jpeg" };
    const files = [
      file("a/1.mp3", { tags: { album: "Album", artist: "A", cover } }),
      file("a/2.mp3", { tags: { album: "Album", artist: "A", cover } }),
    ];
    const repo = fakeRepo();

    await scanLibrary(
      { musicRepo: repo.repo, fileStore: fakeStore(files), metadataReader: fakeReader(files) },
      { folder: "", extensions: MP3_FLAC, skipUnstreamable: true },
    );

    expect(repo.albums.size).toBe(1);
    // Written once, not once per track -- that would be thousands of pointless writes.
    expect(repo.covers.size).toBe(1);
    expect(repo.upserts[0].albumId).toBe(repo.upserts[1].albumId);
    // track_count is denormalized, so the scan has to refresh it or the browse screen
    // shows every album as empty.
    expect(repo.recounted).toContain(repo.upserts[0].albumId);
  });

  it("falls back to the artist when a compilation has no album artist", async () => {
    const files = [file("a.mp3", { tags: { album: "Comp", artist: "Someone" } })];
    const repo = fakeRepo();

    await scanLibrary(
      { musicRepo: repo.repo, fileStore: fakeStore(files), metadataReader: fakeReader(files) },
      { folder: "", extensions: MP3_FLAC, skipUnstreamable: true },
    );

    expect(repo.upserts[0].albumArtist).toBe("Someone");
  });

  it("groups an untagged file under its containing folder", async () => {
    // Much of this library is untagged FLAC in a per-artist folder; grouping by folder
    // is what gets those tracks artwork and a heading instead of a flat orphan list.
    const files = [file("CHINESE/Beyond/a.flac", { tags: {} })];
    const repo = fakeRepo();

    await scanLibrary(
      { musicRepo: repo.repo, fileStore: fakeStore(files), metadataReader: fakeReader(files) },
      { folder: "", extensions: MP3_FLAC, skipUnstreamable: true },
    );

    expect(repo.upserts[0].album).toBe("Beyond");
    expect(repo.upserts[0].albumId).toBeDefined();
  });

  it("prefers a real album tag over the folder name", async () => {
    // Folder layout here is inconsistent (2-8 levels, genres/languages/alphabet
    // buckets), so a tag must always win.
    const files = [file("CHINESE/Beyond/a.flac", { tags: { album: "Real Album" } })];
    const repo = fakeRepo();

    await scanLibrary(
      { musicRepo: repo.repo, fileStore: fakeStore(files), metadataReader: fakeReader(files) },
      { folder: "", extensions: MP3_FLAC, skipUnstreamable: true },
    );

    expect(repo.upserts[0].album).toBe("Real Album");
  });

  it("leaves a file at the library root with no album", async () => {
    const files = [file("a.mp3", { tags: {} })];
    const repo = fakeRepo();

    await scanLibrary(
      { musicRepo: repo.repo, fileStore: fakeStore(files), metadataReader: fakeReader(files) },
      { folder: "", extensions: MP3_FLAC, skipUnstreamable: true },
    );

    expect(repo.upserts[0].albumId).toBeUndefined();
    expect(repo.albums.size).toBe(0);
  });

  it("falls back to a sibling cover file when tags embed no artwork", async () => {
    const files = [file("CHINESE/Beyond/a.flac", { tags: {} })];
    const repo = fakeRepo();
    const store = fakeStore(files);
    // 756 cover files were counted on disk, and untagged FLAC rarely embeds art.
    store.readFolderCover = async () => ({
      data: Buffer.from("folder-art"),
      mimeType: "image/webp",
    });

    await scanLibrary(
      { musicRepo: repo.repo, fileStore: store, metadataReader: fakeReader(files) },
      { folder: "", extensions: MP3_FLAC, skipUnstreamable: true },
    );

    expect(repo.covers.size).toBe(1);
    expect([...repo.covers.values()][0].mimeType).toBe("image/webp");
  });

  it("stops at a limit, for timing a sample before a full run", async () => {
    const files = Array.from({ length: 50 }, (_unused, index) =>
      file(`t${index}.mp3`, { tags: {} }),
    );
    const repo = fakeRepo();

    const summary = await scanLibrary(
      { musicRepo: repo.repo, fileStore: fakeStore(files), metadataReader: fakeReader(files) },
      { folder: "", extensions: MP3_FLAC, skipUnstreamable: true, limit: 10 },
    );

    expect(summary.filesTotal).toBe(10);
    expect(summary.filesSeen).toBeLessThanOrEqual(10);
  });

  it("prunes catalog rows for files that have vanished", async () => {
    // Removes DATABASE rows only -- nothing on disk is touched.
    const files = [file("kept.mp3", { tags: {} })];
    const repo = fakeRepo([
      { relativePath: "kept.mp3", fileSize: 999, fileMtime: "old" },
      { relativePath: "gone.mp3", fileSize: 1, fileMtime: "old" },
    ]);

    const summary = await scanLibrary(
      { musicRepo: repo.repo, fileStore: fakeStore(files), metadataReader: fakeReader(files) },
      { folder: "", extensions: MP3_FLAC, skipUnstreamable: true, pruneMissing: true },
    );

    expect(summary.tracksRemoved).toBe(1);
    expect(repo.deletedFrom?.kept).toEqual(["kept.mp3"]);
  });

  it("does not prune during a limited sample scan", async () => {
    const files = [file("a.mp3", { tags: {} })];
    const repo = fakeRepo([{ relativePath: "gone.mp3", fileSize: 1, fileMtime: "old" }]);

    const summary = await scanLibrary(
      { musicRepo: repo.repo, fileStore: fakeStore(files), metadataReader: fakeReader(files) },
      { folder: "", extensions: MP3_FLAC, skipUnstreamable: true, limit: 1, pruneMissing: true },
    );

    // A sample has not seen enough of the library to conclude anything is missing.
    expect(summary.tracksRemoved).toBe(0);
    expect(repo.deletedFrom).toBeUndefined();
  });

  it("fails cleanly when the music folder is unreachable", async () => {
    const repo = fakeRepo();

    const summary = await scanLibrary(
      { musicRepo: repo.repo, fileStore: fakeStore([], false), metadataReader: fakeReader([]) },
      { folder: "", extensions: MP3_FLAC, skipUnstreamable: true },
    );

    expect(summary.status).toBe("failed");
    expect(summary.lastError).toContain("not reachable");
    expect(repo.finished?.status).toBe("failed");
  });

  it("stops when cancelled and records it as cancelled, not failed", async () => {
    const files = Array.from({ length: 500 }, (_unused, index) =>
      file(`t${index}.mp3`, { tags: {} }),
    );
    const repo = fakeRepo();
    let calls = 0;

    const summary = await scanLibrary(
      { musicRepo: repo.repo, fileStore: fakeStore(files), metadataReader: fakeReader(files) },
      {
        folder: "",
        extensions: MP3_FLAC,
        skipUnstreamable: true,
        // Cancel after the counting phase has had a chance to run.
        isCancelled: () => ++calls > 1,
      },
    );

    expect(summary.status).toBe("cancelled");
    expect(repo.finished?.status).toBe("cancelled");
  });
});
