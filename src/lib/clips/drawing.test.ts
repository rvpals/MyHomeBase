import { beforeEach, describe, expect, it } from "vitest";
import { ClipIsEncryptedError, ClipNotFoundError, TooManyClipImagesError, createClip } from "./clips";
import { FakeClipsRepository } from "./clips.test";
import {
  CLIP_DRAWING_MAX_POINTS,
  ClipDrawingNotFoundError,
  getClipDrawing,
  listClipDrawings,
  replaceClipImageReference,
  saveClipDrawing,
  type ClipDrawing,
} from "./drawing";
import type { ClipImageProcessor } from "./ports";
import { CLIP_MAX_IMAGES } from "./schema";

const processor: ClipImageProcessor = {
  async prepare(image) {
    return { image, width: 1200, height: 900 };
  },
};

const PNG_BASE64 = Buffer.from("not really a png").toString("base64");

const DRAWING: ClipDrawing = {
  version: 1,
  width: 1200,
  height: 900,
  strokes: [
    { ink: "blue", size: 6, erase: false, points: [[10, 10], [20, 30]] },
    { ink: "ink", size: 24, erase: true, points: [[15, 15]] },
  ],
};

let repo: FakeClipsRepository;

beforeEach(() => {
  repo = new FakeClipsRepository();
});

function newClip(contentHtml = "<p>hello</p>") {
  return createClip(repo, { title: "Sketch", contentHtml, categories: [], tags: [], color: "" }, 1)
    .clip;
}

describe("saveClipDrawing", () => {
  it("stores a new drawing and appends it to the body", async () => {
    const clip = newClip();
    const { image, clip: updated } = await saveClipDrawing(repo, processor, {
      clipId: clip.id,
      base64Data: PNG_BASE64,
      drawing: DRAWING,
    });

    expect(image.isDrawing).toBe(true);
    expect(updated.contentHtml).toContain("<p>hello</p>");
    expect(updated.contentHtml).toContain(`/api/clips/images/${image.id}"`);
    expect(getClipDrawing(repo, image.id)).toEqual(DRAWING);
  });

  it("replaces an edited drawing with a new row and repoints the body", async () => {
    const clip = newClip();
    const first = await saveClipDrawing(repo, processor, {
      clipId: clip.id,
      base64Data: PNG_BASE64,
      drawing: DRAWING,
    });

    const edited: ClipDrawing = { ...DRAWING, strokes: DRAWING.strokes.slice(0, 1) };
    const second = await saveClipDrawing(repo, processor, {
      clipId: clip.id,
      base64Data: PNG_BASE64,
      drawing: edited,
      replacesImageId: first.image.id,
    });

    expect(second.image.id).not.toBe(first.image.id);
    expect(second.clip.contentHtml).toContain(`/api/clips/images/${second.image.id}"`);
    expect(second.clip.contentHtml).not.toContain(`/api/clips/images/${first.image.id}"`);
    // The old row is gone, so only one drawing remains, and it holds the edit.
    expect(listClipDrawings(repo, clip.id).map((i) => i.id)).toEqual([second.image.id]);
    expect(getClipDrawing(repo, second.image.id)).toEqual(edited);
  });

  it("lets a clip at the image cap have its drawing edited", async () => {
    const clip = newClip();
    const drawing = await saveClipDrawing(repo, processor, {
      clipId: clip.id,
      base64Data: PNG_BASE64,
      drawing: DRAWING,
    });
    for (let i = 1; i < CLIP_MAX_IMAGES; i++) {
      repo.addClipImage(clip.id, { data: Buffer.from("x"), mimeType: "image/png" }, 1, 1);
    }

    await expect(
      saveClipDrawing(repo, processor, { clipId: clip.id, base64Data: PNG_BASE64, drawing: DRAWING }),
    ).rejects.toThrow(TooManyClipImagesError);

    await expect(
      saveClipDrawing(repo, processor, {
        clipId: clip.id,
        base64Data: PNG_BASE64,
        drawing: DRAWING,
        replacesImageId: drawing.image.id,
      }),
    ).resolves.toBeDefined();
  });

  it("refuses a missing clip", async () => {
    await expect(
      saveClipDrawing(repo, processor, { clipId: 999, base64Data: PNG_BASE64, drawing: DRAWING }),
    ).rejects.toThrow(ClipNotFoundError);
  });

  it("refuses a sealed clip", async () => {
    const clip = newClip();
    repo.sealClip(clip.id, { titleEncrypted: "x", contentEncrypted: "y", passwordHint: "" });
    await expect(
      saveClipDrawing(repo, processor, { clipId: clip.id, base64Data: PNG_BASE64, drawing: DRAWING }),
    ).rejects.toThrow(ClipIsEncryptedError);
  });

  it("refuses to replace an image that is not a drawing on this clip", async () => {
    const clip = newClip();
    const other = newClip();
    const plain = repo.addClipImage(clip.id, { data: Buffer.from("x"), mimeType: "image/png" }, 1, 1);
    const foreign = await saveClipDrawing(repo, processor, {
      clipId: other.id,
      base64Data: PNG_BASE64,
      drawing: DRAWING,
    });

    for (const replacesImageId of [plain.id, foreign.image.id]) {
      await expect(
        saveClipDrawing(repo, processor, {
          clipId: clip.id,
          base64Data: PNG_BASE64,
          drawing: DRAWING,
          replacesImageId,
        }),
      ).rejects.toThrow(ClipDrawingNotFoundError);
    }
  });

  it("refuses an ink that is not on the palette", async () => {
    const clip = newClip();
    await expect(
      saveClipDrawing(repo, processor, {
        clipId: clip.id,
        base64Data: PNG_BASE64,
        drawing: {
          ...DRAWING,
          strokes: [{ ink: "#ff00ff" as never, size: 6, erase: false, points: [[1, 1]] }],
        },
      }),
    ).rejects.toThrow(/palette/);
  });

  it("refuses a stroke with too many points", async () => {
    const clip = newClip();
    const points = Array.from({ length: CLIP_DRAWING_MAX_POINTS + 1 }, (_, i) => [i, i] as [number, number]);
    await expect(
      saveClipDrawing(repo, processor, {
        clipId: clip.id,
        base64Data: PNG_BASE64,
        drawing: { ...DRAWING, strokes: [{ ink: "ink", size: 3, erase: false, points }] },
      }),
    ).rejects.toThrow(/too long/);
  });
});

describe("getClipDrawing", () => {
  it("refuses a plain image", () => {
    const clip = newClip();
    const plain = repo.addClipImage(clip.id, { data: Buffer.from("x"), mimeType: "image/png" }, 1, 1);
    expect(() => getClipDrawing(repo, plain.id)).toThrow(ClipDrawingNotFoundError);
  });
});

describe("replaceClipImageReference", () => {
  it("rewrites only the exact id", () => {
    const html =
      '<img src="/api/clips/images/12"><img src="/api/clips/images/123"><img src=\'/api/clips/images/12\'>';
    expect(replaceClipImageReference(html, 12, 40)).toBe(
      '<img src="/api/clips/images/40"><img src="/api/clips/images/123"><img src=\'/api/clips/images/40\'>',
    );
  });
});
