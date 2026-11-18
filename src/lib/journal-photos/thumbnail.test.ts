import { describe, expect, it } from "vitest";
import { createConcurrencyLimit } from "@/lib/shared/concurrency";
import { FAKE_PREVIEW, buildJpegWithPreview } from "./embedded-thumbnail.fixture";
import { buildJpegWithExif } from "./exif.fixture";
import type { PhotoFileStore, PhotoThumbnailRenderer } from "./ports";
import { THUMBNAIL_SIZE, readPhotoThumbnail } from "./thumbnail";
import type { PhotoRootCheck } from "./types";

// The use-case only reads a header and, failing that, the whole photo. The fake
// implements those two honestly and throws on everything else.

const PATH = "2019/2019-06-09 Von Thun Farm/DSC00123.jpg";
const ORIGINAL = new Uint8Array([0xff, 0xd8, 9, 9, 9, 0xff, 0xd9]);

class FakeStore implements PhotoFileStore {
  photoReads = 0;
  constructor(
    private readonly header: Uint8Array | undefined,
    // `null`, not `undefined`, means "the photo can't be read": passing `undefined`
    // explicitly would trigger the default and hand back ORIGINAL instead.
    private readonly photo: Uint8Array | null = ORIGINAL,
  ) {}
  async readHeader(): Promise<Uint8Array | undefined> {
    return this.header;
  }
  async readPhoto(): Promise<{ data: Uint8Array; mimeType: string } | undefined> {
    this.photoReads += 1;
    return this.photo === null ? undefined : { data: this.photo, mimeType: "image/jpeg" };
  }
  async isRootAvailable(): Promise<boolean> {
    throw new Error("not needed");
  }
  async checkRoot(): Promise<PhotoRootCheck> {
    throw new Error("not needed");
  }
  async folderExists(): Promise<boolean> {
    throw new Error("not needed");
  }
  async listFolderNames(): Promise<string[]> {
    throw new Error("not needed");
  }
  async listPhotoNames(): Promise<string[]> {
    throw new Error("not needed");
  }
  async statPhoto(): Promise<{ bytes: number; mtime: string } | undefined> {
    throw new Error("not needed");
  }
}

/** Records what it was asked to do and returns a marker, or throws when "unavailable". */
class FakeRenderer implements PhotoThumbnailRenderer {
  calls: Parameters<PhotoThumbnailRenderer["render"]>[] = [];
  constructor(private readonly isAvailable = true) {}
  async render(...args: Parameters<PhotoThumbnailRenderer["render"]>): Promise<Uint8Array> {
    this.calls.push(args);
    if (!this.isAvailable) throw new Error("sharp failed to load");
    return new Uint8Array([0xaa]);
  }
}

function deps(store: FakeStore, renderer = new FakeRenderer()) {
  return { store, renderer, limit: createConcurrencyLimit(3) };
}

describe("readPhotoThumbnail", () => {
  it("serves an upright EXIF preview as-is, without reading the whole photo", async () => {
    const store = new FakeStore(buildJpegWithPreview());
    const renderer = new FakeRenderer();
    const result = await readPhotoThumbnail(deps(store, renderer), { relativePath: PATH });

    expect(result?.source).toBe("embedded");
    expect([...result!.data]).toEqual(FAKE_PREVIEW);
    expect(store.photoReads).toBe(0);
    expect(renderer.calls).toHaveLength(0);
  });

  it("turns a sideways preview with the original's orientation", async () => {
    const store = new FakeStore(buildJpegWithPreview({ orientation: 6 }));
    const renderer = new FakeRenderer();
    const result = await readPhotoThumbnail(deps(store, renderer), { relativePath: PATH });

    expect(result?.source).toBe("embedded");
    expect(renderer.calls[0][1]).toEqual({
      size: THUMBNAIL_SIZE,
      transform: { rotate: 90, flop: false, flip: false },
    });
    expect(store.photoReads).toBe(0);
  });

  it("shrinks the original when there is no preview", async () => {
    const store = new FakeStore(buildJpegWithExif({ dateTimeOriginal: "2019:06:09 14:35:01" }));
    const renderer = new FakeRenderer();
    const result = await readPhotoThumbnail(deps(store, renderer), { relativePath: PATH });

    expect(result?.source).toBe("rendered");
    expect(store.photoReads).toBe(1);
    // No transform: the renderer orients an original from its own EXIF.
    expect(renderer.calls[0][1]).toEqual({ size: THUMBNAIL_SIZE });
  });

  it("serves the original as-is when image processing is unavailable", async () => {
    const store = new FakeStore(undefined);
    const result = await readPhotoThumbnail(deps(store, new FakeRenderer(false)), {
      relativePath: PATH,
    });

    expect(result?.source).toBe("original");
    expect([...result!.data]).toEqual([...ORIGINAL]);
  });

  it("falls back to the original rather than serve a sideways preview it could not turn", async () => {
    const store = new FakeStore(buildJpegWithPreview({ orientation: 6 }));
    const result = await readPhotoThumbnail(deps(store, new FakeRenderer(false)), {
      relativePath: PATH,
    });

    expect(result?.source).toBe("original");
    expect(store.photoReads).toBe(1);
  });

  it("reports a photo that cannot be read at all as undefined", async () => {
    const store = new FakeStore(undefined, null);
    expect(await readPhotoThumbnail(deps(store), { relativePath: PATH })).toBeUndefined();
  });

  it("refuses an unsafe path without touching the store", async () => {
    const store = new FakeStore(buildJpegWithPreview());
    expect(await readPhotoThumbnail(deps(store), { relativePath: "../../etc/passwd.jpg" })).toBeUndefined();
    expect(store.photoReads).toBe(0);
  });

  it("builds originals through the shared limit, so a burst cannot exceed it", async () => {
    let running = 0;
    let peak = 0;
    const slowRenderer: PhotoThumbnailRenderer = {
      async render() {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return new Uint8Array([0xaa]);
      },
    };
    const store = new FakeStore(undefined);
    const shared = { store, renderer: slowRenderer, limit: createConcurrencyLimit(2) };

    await Promise.all(
      Array.from({ length: 6 }, () => readPhotoThumbnail(shared, { relativePath: PATH })),
    );
    expect(peak).toBe(2);
  });
});
