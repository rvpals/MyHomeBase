// What the Code Tester's experiments need from the outside world.
//
// Ports, so each experiment's report is unit-tested with hand-written fakes -- no NAS,
// no native module. The real adapters are `createTimedPhotoReader` (over the read-only
// `PhotoFileStore`) and `SharpImageLibProbe`.

/** One photo's bytes from the archive, and how long the read took. */
export interface TimedPhotoReader {
  /**
   * The whole file, or `undefined` when it is missing or unreadable.
   *
   * READ-ONLY: this sits on `PhotoFileStore`, which has no write method, so an
   * experiment cannot modify the archive.
   */
  read(relativePath: string): Promise<{ data: Uint8Array; ms: number } | undefined>;
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
