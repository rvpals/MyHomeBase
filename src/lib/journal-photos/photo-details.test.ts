import { describe, expect, it } from "vitest";
import { buildJpegWithExif } from "./exif.fixture";
import { readPhotoDetails } from "./photo-details";
import type { PhotoFileStore } from "./ports";
import type { PhotoRootCheck } from "./types";

// This use-case only ever calls `readHeader`, so the fake implements that honestly and
// throws on everything else -- a test that started depending on a folder listing here
// would be a design regression worth failing loudly rather than passing quietly.

interface FakeOptions {
  /** Header bytes per relative path. A path absent from this reads as unreadable. */
  headers?: Record<string, Uint8Array>;
  /** Make `readHeader` throw, as a dropped SMB share does. */
  throwOnRead?: boolean;
}

class FakePhotoFileStore implements PhotoFileStore {
  readCount = 0;
  lastByteCount: number | undefined;

  constructor(private readonly options: FakeOptions = {}) {}

  async readHeader(relativePath: string, byteCount: number): Promise<Uint8Array | undefined> {
    this.readCount += 1;
    this.lastByteCount = byteCount;
    if (this.options.throwOnRead) throw new Error("share dropped");
    return this.options.headers?.[relativePath];
  }

  async isRootAvailable(): Promise<boolean> {
    throw new Error("not needed: readPhotoDetails must not check the root");
  }
  async checkRoot(): Promise<PhotoRootCheck> {
    throw new Error("not needed: readPhotoDetails must not check the root");
  }
  async folderExists(): Promise<boolean> {
    throw new Error("not needed: readPhotoDetails inspects one file");
  }
  async listFolderNames(): Promise<string[]> {
    throw new Error("not needed: readPhotoDetails inspects one file");
  }
  async listPhotoNames(): Promise<string[]> {
    throw new Error("not needed: readPhotoDetails inspects one file");
  }
  async readPhoto(): Promise<{ data: Uint8Array; mimeType: string } | undefined> {
    throw new Error("not needed: the details read is partial, never the whole file");
  }
}

const DAY_FOLDER = "2019/2019-06-09 Von Thun Farm";
const MONTH_FOLDER = "2019/2019-06 June";

describe("readPhotoDetails", () => {
  it("reports the EXIF capture date and time, and says so", () => {
    const path = `${MONTH_FOLDER}/DSC00123.jpg`;
    const store = new FakePhotoFileStore({
      headers: { [path]: buildJpegWithExif({ dateTimeOriginal: "2019:06:09 14:35:01" }) },
    });

    return readPhotoDetails(store, { relativePath: path }).then((details) => {
      expect(details).toEqual({
        relativePath: path,
        takenAtDate: "2019-06-09",
        takenAtTime: "14:35:01",
        takenAtSource: "exif",
      });
    });
  });

  it("reads only the EXIF header, never the whole file", () => {
    // The partial read IS the feature: this runs per photo looked at, over SMB.
    const path = `${MONTH_FOLDER}/DSC00123.jpg`;
    const store = new FakePhotoFileStore({
      headers: { [path]: buildJpegWithExif({ dateTimeOriginal: "2019:06:09 14:35:01" }) },
    });

    return readPhotoDetails(store, { relativePath: path }).then(() => {
      expect(store.readCount).toBe(1);
      expect(store.lastByteCount).toBe(128 * 1024);
    });
  });

  it("keeps the date when EXIF carries no usable clock", () => {
    const path = `${MONTH_FOLDER}/DSC00123.jpg`;
    const store = new FakePhotoFileStore({
      headers: { [path]: buildJpegWithExif({ dateTimeOriginal: "2019:06:09 00:00:00" }) },
    });

    return readPhotoDetails(store, { relativePath: path }).then((details) => {
      expect(details.takenAtDate).toBe("2019-06-09");
      expect(details.takenAtTime).toBeUndefined();
      expect(details.takenAtSource).toBe("exif");
    });
  });

  it("falls back to the file name when there is no EXIF, and labels it as inferred", () => {
    // A stripped or re-saved file. The archive's naming is still good evidence, but it
    // must not be reported as though the camera said it.
    const path = `${MONTH_FOLDER}/IMG_20190609_143501.jpg`;
    const store = new FakePhotoFileStore({
      headers: { [path]: buildJpegWithExif({ withoutExif: true }) },
    });

    return readPhotoDetails(store, { relativePath: path }).then((details) => {
      expect(details.takenAtDate).toBe("2019-06-09");
      expect(details.takenAtSource).toBe("file-name");
      // No time: a name is not a clock reading, even when it contains digits.
      expect(details.takenAtTime).toBeUndefined();
    });
  });

  it("falls back to a day folder's date when the file name carries none", () => {
    const path = `${DAY_FOLDER}/DSC00123.jpg`;
    const store = new FakePhotoFileStore({ headers: {} });

    return readPhotoDetails(store, { relativePath: path }).then((details) => {
      expect(details.takenAtDate).toBe("2019-06-09");
      expect(details.takenAtSource).toBe("folder");
    });
  });

  it("establishes nothing for a counter-named photo in a month folder", () => {
    // A month folder names no single day, so inventing one would be worse than saying
    // "not available" -- which is what the viewer then shows.
    const path = `${MONTH_FOLDER}/DSC00123.jpg`;
    const store = new FakePhotoFileStore({ headers: {} });

    return readPhotoDetails(store, { relativePath: path }).then((details) => {
      expect(details.takenAtDate).toBeUndefined();
      expect(details.takenAtSource).toBe("none");
      expect(details.relativePath).toBe(path);
    });
  });

  it("survives a share that drops mid-read", () => {
    // Never throws across the boundary: the path is still worth showing.
    const path = `${MONTH_FOLDER}/DSC00123.jpg`;
    const store = new FakePhotoFileStore({ throwOnRead: true });

    return readPhotoDetails(store, { relativePath: path }).then((details) => {
      expect(details.takenAtSource).toBe("none");
      expect(details.relativePath).toBe(path);
    });
  });

  it("refuses a traversal path without reading anything", () => {
    const store = new FakePhotoFileStore();

    return readPhotoDetails(store, { relativePath: "2019/../../etc/passwd" }).then(
      (details) => {
        expect(details.takenAtSource).toBe("none");
        expect(store.readCount).toBe(0);
      },
    );
  });

  it("normalises the path it reports back", () => {
    const store = new FakePhotoFileStore({ headers: {} });

    return readPhotoDetails(store, {
      relativePath: `/${MONTH_FOLDER}/DSC00123.jpg`,
    }).then((details) => {
      expect(details.relativePath).toBe(`${MONTH_FOLDER}/DSC00123.jpg`);
    });
  });
});
