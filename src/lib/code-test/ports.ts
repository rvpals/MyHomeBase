// What the Code Tester's experiments need from the outside world.
//
// Ports, so each experiment's report is unit-tested with hand-written fakes -- no NAS,
// no native module. The real adapters are `createTimedPhotoReader` (over the read-only
// `PhotoFileStore`) and `SharpImageLibProbe`.

/**
 * Timed reads of the archive, for an experiment to measure.
 *
 * READ-ONLY, all three: this sits on `PhotoFileStore`, which has no write method, so an
 * experiment cannot modify the archive. `stat` and `readHeader` are OBSERVATIONS in the
 * same sense that port's doc comment uses -- they add no capability, they only let an
 * experiment measure the cheap reads the app already makes in production.
 */
export interface TimedPhotoReader {
  /** The whole file, or `undefined` when it is missing or unreadable. */
  read(relativePath: string): Promise<{ data: Uint8Array; ms: number } | undefined>;

  /**
   * The file's size without reading its contents, or `undefined` when unreadable.
   *
   * What makes scanning a whole folder affordable: a stat per photo instead of pulling
   * every multi-megabyte file over SMB to learn how big it is.
   */
  stat(relativePath: string): Promise<{ bytes: number; ms: number } | undefined>;

  /**
   * The first `byteCount` bytes, or `undefined` when unreadable.
   *
   * The read the shipped thumbnail route actually makes (`readPhotoThumbnail` takes
   * `EXIF_HEADER_BYTES`), so an experiment can time the real path rather than a
   * whole-file read production never performs.
   */
  readHeader(
    relativePath: string,
    byteCount: number,
  ): Promise<{ data: Uint8Array; ms: number } | undefined>;
}

/**
 * What every Code Tester experiment needs: timed archive reads, the image library under
 * measurement, and a clock.
 *
 * One shared shape because the experiments run together in one report and must be timed
 * on the same clock. `ServerResizeTestDeps` is the old name for it.
 */
export interface CodeTestDeps {
  reader: TimedPhotoReader;
  imageLib: ImageLibProbe;
  /** Milliseconds from an arbitrary origin, for the totals. `performance.now` in production. */
  now: () => number;
}

/** Facts about the image library, for the report's header. */
export interface ImageLibInfo {
  /** e.g. `0.35.4`. */
  version: string;
  /** The underlying codec library, e.g. `libvips 8.17.1`. Empty when unknown. */
  detail: string;
  /** `process.platform` -- `linux` on the NAS. */
  platform: string;
  /** `process.arch` -- `arm64` on the NAS. */
  arch: string;
}

/** Dimensions and orientation, as stored (before any rotation). */
export interface ImageMetadata {
  width?: number;
  height?: number;
  /** EXIF orientation, 1-8, when present. */
  orientation?: number;
}

/**
 * The image library being measured.
 *
 * Every method throws when the library is unavailable (a missing native module); the
 * experiment catches that and says so in its report rather than failing.
 */
export interface ImageLibProbe {
  /**
   * Loads the library if it is not loaded yet.
   *
   * `ms` is the load time when THIS call loaded it, and `undefined` when an earlier
   * call in this server process already had -- so the first-use cost is reported
   * separately from every resize, and only once.
   */
  load(): Promise<{ ms: number | undefined; info: ImageLibInfo }>;
  metadata(bytes: Uint8Array): Promise<ImageMetadata>;
  /**
   * Decode, auto-orient, shrink so the LONGER edge is `longEdge` (never enlarging), and
   * encode as JPEG. `ms` covers all of that.
   */
  resize(bytes: Uint8Array, longEdge: number): Promise<{ data: Uint8Array; ms: number }>;
}
