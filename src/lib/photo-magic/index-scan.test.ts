import { describe, expect, it } from "vitest";
import type { PhotoFileStore, PhotoRootCheck } from "@/lib/journal-photos";
import { buildJpegWithExif } from "@/lib/journal-photos/exif.fixture";
import { scanPhotoIndex, type IndexScanDependencies } from "./index-scan";
import type {
  MagicScanRunRepository,
  PhotoIndexRepository,
} from "./ports";
import type {
  IndexedPhoto,
  MagicScanRun,
  PhotoFileFacts,
  PhotoMagicCriteria,
  ScanRunProgress,
} from "./types";

// The scan is the expensive half of the feature, so these tests are mostly about what
// it manages NOT to do: re-read a file whose size and mtime are unchanged, open a photo
// twice for its date and its dimensions, or let one unreadable file fail the run.

/**
 * A JPEG whose EXIF date AND frame dimensions are both readable.
 *
 * The EXIF module's fixture builder emits SOI, an APP1 block and then a token SOS --
 * deliberately, since it exists to test a date parser. It carries no SOF, so a scan fed
 * it alone would record every photograph as having unknown dimensions and the tests
 * here would prove nothing about the two facts arriving together. So the frame header
 * is spliced in ahead of the SOS, which is where a real encoder puts it.
 */
function jpegBytes(date: string, width = 1920, height = 1080): Uint8Array {
  const withExif = buildJpegWithExif({ dateTimeOriginal: date });
  const sof = [
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
  ];

  // Insert before the SOS marker: past it the bytes are entropy-coded and the size
  // parser stops looking, exactly as it would in a real file.
  const sosIndex = findSos(withExif);
  return new Uint8Array([
    ...withExif.slice(0, sosIndex),
    ...sof,
    ...withExif.slice(sosIndex),
  ]);
}

/** Where the scan-start marker begins, so the frame can be spliced in before it. */
function findSos(bytes: Uint8Array): number {
  for (let index = 2; index + 1 < bytes.length; index += 1) {
    if (bytes[index] === 0xff && bytes[index + 1] === 0xda) return index;
  }
  return bytes.length;
}

interface FakeFile {
  bytes: number;
  mtime: string;
  header?: Uint8Array;
  /** Make `statPhoto` fail, standing in for a permissions problem on one file. */
  unreadable?: boolean;
}

class FakePhotoStore implements PhotoFileStore {
  headerReads = 0;
  statCalls = 0;

  constructor(
    private folders: Record<string, string[]>,
    private files: Record<string, FakeFile>,
    private rootOk = true,
  ) {}

  async isRootAvailable(): Promise<boolean> {
    return this.rootOk;
  }
  async checkRoot(): Promise<PhotoRootCheck> {
    return this.rootOk ? { kind: "ok", path: "/photos" } : { kind: "missing", path: "/photos" };
  }
  async folderExists(relativeFolder: string): Promise<boolean> {
    return relativeFolder in this.folders;
  }
  async listFolderNames(relativeFolder: string): Promise<string[]> {
    const prefix = relativeFolder === "" ? "" : `${relativeFolder}/`;
    const names = new Set<string>();
    for (const path of Object.keys(this.folders)) {
      if (relativeFolder === "" && !path.includes("/")) names.add(path);
      else if (path.startsWith(prefix) && path !== relativeFolder) {
        const rest = path.slice(prefix.length);
        if (!rest.includes("/")) names.add(rest);
      }
    }
    return [...names].sort();
  }
  async listPhotoNames(relativeFolder: string): Promise<string[]> {
    return this.folders[relativeFolder] ?? [];
  }
  async readHeader(relativePath: string, _byteCount: number): Promise<Uint8Array | undefined> {
    this.headerReads += 1;
    return this.files[relativePath]?.header;
  }
  async readPhoto(): Promise<{ data: Uint8Array; mimeType: string } | undefined> {
    return undefined;
  }
  async statPhoto(relativePath: string): Promise<{ bytes: number; mtime: string } | undefined> {
    this.statCalls += 1;
    const file = this.files[relativePath];
    if (file === undefined || file.unreadable === true) return undefined;
    return { bytes: file.bytes, mtime: file.mtime };
  }
}

class FakePhotoIndex implements PhotoIndexRepository {
  rows = new Map<string, IndexedPhoto & { mtime: string }>();
  upserts = 0;

  listCandidates(_c: PhotoMagicCriteria): IndexedPhoto[] {
    return [...this.rows.values()];
  }
  countCandidates(): number {
    return this.rows.size;
  }
  countUnknownSizeInRange(): number {
    return 0;
  }
  getFileFacts(relativePath: string): PhotoFileFacts | undefined {
    const row = this.rows.get(relativePath);
    return row === undefined
      ? undefined
      : { relativePath, bytes: row.bytes, mtime: row.mtime };
  }
  upsertPhoto(photo: IndexedPhoto & { mtime: string }): void {
    this.upserts += 1;
    this.rows.set(photo.relativePath, photo);
  }
  countIndexed(): number {
    return this.rows.size;
  }
  clearIndex(): void {
    this.rows.clear();
  }
}

class FakeScanRuns implements MagicScanRunRepository {
  private nextId = 1;
  runs = new Map<number, MagicScanRun>();
  progressWrites = 0;

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
      updatedAt: "2026-09-13 10:00:00",
    });
    return id;
  }
  setRunTotal(id: number, filesTotal: number): void {
    const run = this.runs.get(id)!;
    this.runs.set(id, { ...run, filesTotal });
  }
  updateProgress(id: number, progress: ScanRunProgress): void {
    this.progressWrites += 1;
    const run = this.runs.get(id)!;
    this.runs.set(id, { ...run, ...progress, lastError: progress.lastError ?? "" });
  }
  finishRun(id: number, status: "completed" | "failed" | "cancelled", lastError?: string): void {
    const run = this.runs.get(id)!;
    this.runs.set(id, { ...run, status, lastError: lastError ?? run.lastError });
  }
  getRun(id: number): MagicScanRun | undefined {
    return this.runs.get(id);
  }
  getActiveRun(): MagicScanRun | undefined {
    return [...this.runs.values()].find((run) => run.status === "running");
  }
  failAbandonedRuns(): number {
    return 0;
  }
}

/** One day folder holding two readable JPEGs. */
function makeDeps(): IndexScanDependencies & {
  fileStore: FakePhotoStore;
  photoIndex: FakePhotoIndex;
  scanRuns: FakeScanRuns;
} {
  const header = jpegBytes("2019:06:09 14:35:01");
  const store = new FakePhotoStore(
    { "2019": [], "2019/2019-06-09 Farm": ["IMG_0001.jpg", "IMG_0002.jpg"] },
    {
      "2019/2019-06-09 Farm/IMG_0001.jpg": { bytes: 4_000_000, mtime: "2019-06-09T14:35:01.000Z", header },
      "2019/2019-06-09 Farm/IMG_0002.jpg": { bytes: 5_000_000, mtime: "2019-06-09T14:36:01.000Z", header },
    },
  );
  return { fileStore: store, photoIndex: new FakePhotoIndex(), scanRuns: new FakeScanRuns() };
}

describe("scanPhotoIndex", () => {
  it("indexes every photograph in the range", async () => {
    const deps = makeDeps();
    const summary = await scanPhotoIndex(deps, { fromDate: "2019-01-01", toDate: "2019-12-31" });

    expect(summary.status).toBe("completed");
    expect(summary.filesSeen).toBe(2);
    expect(summary.filesIndexed).toBe(2);
    expect(deps.photoIndex.countIndexed()).toBe(2);
  });

  it("records size, dimensions and capture date", async () => {
    const deps = makeDeps();
    await scanPhotoIndex(deps, { fromDate: "2019-01-01", toDate: "2019-12-31" });

    const row = deps.photoIndex.rows.get("2019/2019-06-09 Farm/IMG_0001.jpg");
    expect(row?.bytes).toBe(4_000_000);
    expect(row?.takenAtDate).toBe("2019-06-09");
    expect(row?.takenAtSource).toBe("exif");
    // The dimensions come out of the SAME buffer the date did -- which is the whole
    // reason resolution costs no extra I/O.
    expect(row?.width).toBe(1920);
    expect(row?.height).toBe(1080);
  });

  it("sets the total before reading, so the bar has a denominator", async () => {
    const deps = makeDeps();
    const summary = await scanPhotoIndex(deps, { fromDate: "2019-01-01", toDate: "2019-12-31" });
    expect(deps.scanRuns.getRun(summary.scanRunId)?.filesTotal).toBe(2);
  });

  it("skips a file whose size and mtime are unchanged", async () => {
    // THE SKIP: what makes a re-scan take seconds instead of minutes. A second run
    // must open nothing.
    const deps = makeDeps();
    await scanPhotoIndex(deps, { fromDate: "2019-01-01", toDate: "2019-12-31" });
    const readsAfterFirst = deps.fileStore.headerReads;

    const second = await scanPhotoIndex(deps, { fromDate: "2019-01-01", toDate: "2019-12-31" });

    expect(second.filesCached).toBe(2);
    expect(second.filesIndexed).toBe(0);
    expect(deps.fileStore.headerReads).toBe(readsAfterFirst);
  });

  it("re-indexes a file whose size changed", async () => {
    const deps = makeDeps();
    await scanPhotoIndex(deps, { fromDate: "2019-01-01", toDate: "2019-12-31" });

    const cached = deps.photoIndex.rows.get("2019/2019-06-09 Farm/IMG_0001.jpg")!;
    deps.photoIndex.rows.set("2019/2019-06-09 Farm/IMG_0001.jpg", { ...cached, bytes: 1 });

    const second = await scanPhotoIndex(deps, { fromDate: "2019-01-01", toDate: "2019-12-31" });
    expect(second.filesIndexed).toBe(1);
    expect(second.filesCached).toBe(1);
  });

  it("re-indexes a file whose mtime changed", async () => {
    const deps = makeDeps();
    await scanPhotoIndex(deps, { fromDate: "2019-01-01", toDate: "2019-12-31" });

    const cached = deps.photoIndex.rows.get("2019/2019-06-09 Farm/IMG_0001.jpg")!;
    deps.photoIndex.rows.set("2019/2019-06-09 Farm/IMG_0001.jpg", {
      ...cached,
      mtime: "2020-01-01T00:00:00.000Z",
    });

    const second = await scanPhotoIndex(deps, { fromDate: "2019-01-01", toDate: "2019-12-31" });
    expect(second.filesIndexed).toBe(1);
  });

  it("reads each photograph's header only once", async () => {
    // The date and the dimensions come out of the SAME buffer. Reading twice would
    // double the cost of the whole scan for nothing.
    const deps = makeDeps();
    await scanPhotoIndex(deps, { fromDate: "2019-01-01", toDate: "2019-12-31" });
    expect(deps.fileStore.headerReads).toBe(2);
  });

  it("counts an unreadable file and carries on", async () => {
    // One bad photo in a folder of hundreds must not fail the run.
    const deps = makeDeps();
    deps.fileStore = new FakePhotoStore(
      { "2019": [], "2019/2019-06-09 Farm": ["good.jpg", "bad.jpg"] },
      {
        "2019/2019-06-09 Farm/good.jpg": {
          bytes: 100,
          mtime: "2019-06-09T14:35:01.000Z",
          header: jpegBytes("2019:06:09 14:35:01"),
        },
        "2019/2019-06-09 Farm/bad.jpg": {
          bytes: 100,
          mtime: "2019-06-09T14:35:01.000Z",
          unreadable: true,
        },
      },
    );

    const summary = await scanPhotoIndex(deps, { fromDate: "2019-01-01", toDate: "2019-12-31" });

    expect(summary.status).toBe("completed");
    expect(summary.filesIndexed).toBe(1);
    expect(summary.filesFailed).toBe(1);
  });

  it("still indexes a photograph whose header will not parse", async () => {
    // Dimensions unknown, but size and path are still worth recording -- a size-only
    // criterion must still find it.
    const deps = makeDeps();
    deps.fileStore = new FakePhotoStore(
      { "2019": [], "2019/2019-06-09 Farm": ["odd.jpg"] },
      {
        "2019/2019-06-09 Farm/odd.jpg": {
          bytes: 999,
          mtime: "2019-06-09T14:35:01.000Z",
          header: new Uint8Array([0, 1, 2, 3]),
        },
      },
    );

    await scanPhotoIndex(deps, { fromDate: "2019-01-01", toDate: "2019-12-31" });

    const row = deps.photoIndex.rows.get("2019/2019-06-09 Farm/odd.jpg");
    expect(row?.bytes).toBe(999);
    expect(row?.width).toBeUndefined();
    // No EXIF either, so the day folder's own name is the evidence.
    expect(row?.takenAtDate).toBe("2019-06-09");
    expect(row?.takenAtSource).toBe("folder");
  });

  it("fails the run, with a reason, when the archive is unavailable", async () => {
    const deps = makeDeps();
    deps.fileStore = new FakePhotoStore({}, {}, false);

    const summary = await scanPhotoIndex(deps, { fromDate: "2019-01-01", toDate: "2019-12-31" });

    expect(summary.status).toBe("failed");
    expect(summary.lastError).toContain("missing");
    // The row must be closed, or the running guard blocks every later attempt.
    expect(deps.scanRuns.getRun(summary.scanRunId)?.status).toBe("failed");
  });

  it("reports into an existing run row when given one", async () => {
    // The fire-and-forget path: the action creates the row so it can hand the id back
    // for polling, then the scan reports into THAT row rather than opening a second.
    const deps = makeDeps();
    const scanRunId = deps.scanRuns.createRun({ fromDate: "2019-01-01", toDate: "2019-12-31" });

    const summary = await scanPhotoIndex(deps, {
      fromDate: "2019-01-01",
      toDate: "2019-12-31",
      scanRunId,
    });

    expect(summary.scanRunId).toBe(scanRunId);
    expect(deps.scanRuns.runs.size).toBe(1);
  });

  it("stops early at the limit", async () => {
    const deps = makeDeps();
    const summary = await scanPhotoIndex(deps, {
      fromDate: "2019-01-01",
      toDate: "2019-12-31",
      limit: 1,
    });
    expect(summary.filesSeen).toBe(1);
    expect(deps.scanRuns.getRun(summary.scanRunId)?.filesTotal).toBe(1);
  });

  it("cancels between phases without marking the run complete", async () => {
    const deps = makeDeps();
    const summary = await scanPhotoIndex(deps, {
      fromDate: "2019-01-01",
      toDate: "2019-12-31",
      isCancelled: () => true,
    });
    expect(summary.status).toBe("cancelled");
    expect(deps.scanRuns.getRun(summary.scanRunId)?.status).toBe("cancelled");
  });

  it("finishes the run and clears the current path", async () => {
    const deps = makeDeps();
    const summary = await scanPhotoIndex(deps, { fromDate: "2019-01-01", toDate: "2019-12-31" });
    const run = deps.scanRuns.getRun(summary.scanRunId);
    expect(run?.status).toBe("completed");
    expect(run?.currentPath).toBe("");
  });
});
