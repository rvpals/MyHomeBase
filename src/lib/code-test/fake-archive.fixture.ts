import type { ImageLibInfo, ImageLibProbe, ImageMetadata, TimedPhotoReader } from "./ports";

// Test support only -- not exported from index.ts.
//
// A `TimedPhotoReader` and an `ImageLibProbe` over hand-written entries, so every
// experiment's report is tested with no NAS and no native module. `sizeBytes` lets a test
// claim a 4MB photo without allocating 4MB: the scan reads a stat and a header, never the
// whole file, so the claimed size and the actual bytes are allowed to differ.

export interface FakeEntry {
  /** The file's content. Also what `read` returns. */
  bytes?: Uint8Array;
  /** What `stat` reports, when it should differ from `bytes.length`. */
  sizeBytes?: number;
  stat?: "missing" | "throws";
  header?: "missing" | "throws";
  read?: "missing" | "throws";
}

export class FakeArchive implements TimedPhotoReader {
  /** Every call, in order, as `"<op> <path>"` -- so a test can assert what was NOT read. */
  calls: string[] = [];

  constructor(private readonly entries: Record<string, FakeEntry>) {}

  async read(relativePath: string) {
    this.calls.push(`read ${relativePath}`);
    const entry = this.entryOf(relativePath, "read");
    if (entry === undefined) return undefined;
    return { data: entry.bytes ?? new Uint8Array(0), ms: 7 };
  }

  async stat(relativePath: string) {
    this.calls.push(`stat ${relativePath}`);
    const entry = this.entryOf(relativePath, "stat");
    if (entry === undefined) return undefined;
    return { bytes: entry.sizeBytes ?? entry.bytes?.length ?? 0, ms: 1 };
  }

  async readHeader(relativePath: string, byteCount: number) {
    this.calls.push(`header ${relativePath}`);
    const entry = this.entryOf(relativePath, "header");
    if (entry === undefined) return undefined;
    return { data: (entry.bytes ?? new Uint8Array(0)).subarray(0, byteCount), ms: 2 };
  }

  /** `undefined` for a missing entry or one this operation should fail; throws for "throws". */
  private entryOf(relativePath: string, op: "read" | "stat" | "header"): FakeEntry | undefined {
    const entry = this.entries[relativePath];
    if (entry === undefined) return undefined;
    if (entry[op] === "throws") throw new Error(`${op} failed: share dropped`);
    if (entry[op] === "missing") return undefined;
    return entry;
  }
}

export const FAKE_LIB_INFO: ImageLibInfo = {
  version: "0.35.5",
  detail: "libvips 8.18.7",
  platform: "linux",
  arch: "arm64",
};

/** An `ImageLibProbe` whose resize cost is proportional to the input, like a real one. */
export class FakeImageLib implements ImageLibProbe {
  resizes: { bytes: number; longEdge: number }[] = [];
  /** Highest number of resizes in flight at once -- what the concurrency test asserts. */
  peakInFlight = 0;
  private inFlight = 0;

  constructor(
    private readonly options: {
      /** Milliseconds each resize reports, whatever its input. */
      resizeMs?: number;
      /** `resize` throws for an input of exactly this many bytes. */
      failBytes?: number;
      metadata?: ImageMetadata;
    } = {},
  ) {}

  async load() {
    return { ms: undefined, info: FAKE_LIB_INFO };
  }

  async metadata(): Promise<ImageMetadata> {
    return this.options.metadata ?? { width: 4000, height: 3000, orientation: 6 };
  }

  async resize(bytes: Uint8Array, longEdge: number) {
    this.inFlight += 1;
    this.peakInFlight = Math.max(this.peakInFlight, this.inFlight);
    // A real tick, so overlapping calls genuinely overlap and the gate is exercised.
    await new Promise((resolve) => setTimeout(resolve, 0));
    this.inFlight -= 1;

    this.resizes.push({ bytes: bytes.length, longEdge });
    if (this.options.failBytes === bytes.length) throw new Error("resize failed: out of memory");
    return { data: new Uint8Array(longEdge), ms: this.options.resizeMs ?? longEdge / 10 };
  }
}

/** A clock that advances `step` ms per call, so every total in a report is predictable. */
export function steppingClock(step = 100): () => number {
  let t = 0;
  return () => {
    t += step;
    return t;
  };
}
