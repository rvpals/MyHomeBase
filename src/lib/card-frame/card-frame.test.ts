import { describe, expect, it } from "vitest";
import type { DecodedImage } from "@/lib/shared/image-upload";
import {
  MAX_CARD_FRAMES,
  MAX_CARD_FRAME_BYTES,
  addCardFrame,
  cardFrameVars,
  deleteCardFrame,
  getCardFrameById,
  getCardFrameImage,
  getCardFrameSelection,
  listCardFrames,
  renameCardFrame,
  replaceCardFrameImage,
  saveCardFrameSettings,
  selectCardFrame,
} from "./card-frame";
import type { CardFrameRepository } from "./ports";
import type { CardFrame, CardFrameSettings } from "./types";

/**
 * An in-memory stand-in for the library table plus the selection pointer, so
 * these tests exercise the use-cases rather than SQLite.
 *
 * It mirrors the two behaviours the real repository guarantees and the
 * use-cases rely on: a delete clears a selection pointing at the deleted row,
 * and every write bumps `updatedAt`.
 */
function makeRepo(): CardFrameRepository & {
  frames: CardFrame[];
  images: Map<number, DecodedImage>;
  selectedId?: number;
} {
  let nextId = 1;
  let clock = 0;
  const stamp = () => `2026-10-08 10:00:0${clock++}`;

  const repo = {
    frames: [] as CardFrame[],
    images: new Map<number, DecodedImage>(),
    selectedId: undefined as number | undefined,

    getSelection() {
      const frame = repo.frames.find((f) => f.id === repo.selectedId);
      return frame ? { frame } : {};
    },
    listFrames: () => repo.frames,
    getFrameById: (id: number) => repo.frames.find((f) => f.id === id),
    getFrameImage: (id?: number) => repo.images.get(id ?? repo.selectedId ?? -1),

    addFrame(name: string, image: DecodedImage, settings: CardFrameSettings) {
      const id = nextId++;
      repo.frames.push({ id, name, hasImage: true, ...settings, updatedAt: stamp() });
      repo.images.set(id, image);
      return id;
    },
    replaceFrameImage(id: number, image: DecodedImage) {
      const frame = repo.frames.find((f) => f.id === id);
      if (!frame) return false;
      repo.images.set(id, image);
      frame.updatedAt = stamp();
      return true;
    },
    renameFrame(id: number, name: string) {
      const frame = repo.frames.find((f) => f.id === id);
      if (!frame) return false;
      frame.name = name;
      frame.updatedAt = stamp();
      return true;
    },
    deleteFrame(id: number) {
      const index = repo.frames.findIndex((f) => f.id === id);
      if (index === -1) return false;
      repo.frames.splice(index, 1);
      repo.images.delete(id);
      // The real repository does this in the same transaction as the DELETE.
      if (repo.selectedId === id) repo.selectedId = undefined;
      return true;
    },
    selectFrame(id: number | undefined) {
      if (id !== undefined && !repo.frames.some((f) => f.id === id)) return false;
      repo.selectedId = id;
      return true;
    },
    setSettings(id: number, settings: CardFrameSettings) {
      const frame = repo.frames.find((f) => f.id === id);
      if (!frame) return false;
      Object.assign(frame, settings, { updatedAt: stamp() });
      return true;
    },
  };
  return repo;
}

const png: DecodedImage = { data: Buffer.from("frame-bytes"), mimeType: "image/png" };
const upload = { mimeType: "image/png" as const, base64Data: png.data.toString("base64") };

const settings: CardFrameSettings = {
  insets: { top: 24, right: 24, bottom: 24, left: 24 },
  fillOpacity: 1,
  fill: "stretch",
  centerFill: true,
};

describe("the frame library", () => {
  it("adds a frame, stores its bytes and returns its id", () => {
    const repo = makeRepo();
    const id = addCardFrame(repo, "Gilt", upload, settings);

    expect(listCardFrames(repo)).toHaveLength(1);
    expect(getCardFrameById(repo, id)?.name).toBe("Gilt");
    expect(getCardFrameImage(repo, id)?.data.toString()).toBe("frame-bytes");
  });

  it("trims a name and rejects an empty one", () => {
    const repo = makeRepo();
    const id = addCardFrame(repo, "  Gilt  ", upload, settings);
    expect(getCardFrameById(repo, id)?.name).toBe("Gilt");

    expect(() => renameCardFrame(repo, id, "   ")).toThrow();
  });

  it("refuses a frame once the library is full", () => {
    const repo = makeRepo();
    for (let i = 0; i < MAX_CARD_FRAMES; i++) addCardFrame(repo, `Frame ${i}`, upload, settings);

    expect(() => addCardFrame(repo, "One too many", upload, settings)).toThrow(
      /holds 20 pictures/,
    );
    expect(listCardFrames(repo)).toHaveLength(MAX_CARD_FRAMES);
  });

  it("refuses an image over the size cap", () => {
    const repo = makeRepo();
    const huge = {
      mimeType: "image/png" as const,
      base64Data: Buffer.alloc(MAX_CARD_FRAME_BYTES + 1).toString("base64"),
    };
    expect(() => addCardFrame(repo, "Huge", huge, settings)).toThrow(/too large/);
  });

  it("refuses a slice that is negative or past the cap", () => {
    const repo = makeRepo();
    const negative = { ...settings, insets: { ...settings.insets, top: -1 } };
    const enormous = { ...settings, insets: { ...settings.insets, top: 999 } };

    expect(() => addCardFrame(repo, "Bad", upload, negative)).toThrow();
    expect(() => addCardFrame(repo, "Bad", upload, enormous)).toThrow();
  });

  it("refuses an opacity outside 0..1", () => {
    const repo = makeRepo();
    expect(() => addCardFrame(repo, "Bad", upload, { ...settings, fillOpacity: 1.5 })).toThrow();
  });

  it("replaces bytes without disturbing the slices", () => {
    const repo = makeRepo();
    const id = addCardFrame(repo, "Gilt", upload, settings);
    const replacement = {
      mimeType: "image/png" as const,
      base64Data: Buffer.from("new-bytes").toString("base64"),
    };

    replaceCardFrameImage(repo, id, replacement);

    expect(getCardFrameImage(repo, id)?.data.toString()).toBe("new-bytes");
    expect(getCardFrameById(repo, id)?.insets).toEqual(settings.insets);
  });

  it("reports a missing frame rather than failing silently", () => {
    const repo = makeRepo();
    expect(() => renameCardFrame(repo, 99, "Ghost")).toThrow(/no longer exists/);
    expect(() => deleteCardFrame(repo, 99)).toThrow(/no longer exists/);
    expect(() => replaceCardFrameImage(repo, 99, upload)).toThrow(/no longer exists/);
    expect(() => saveCardFrameSettings(repo, 99, settings)).toThrow(/no longer exists/);
    expect(() => selectCardFrame(repo, 99)).toThrow(/no longer exists/);
  });
});

describe("the application-wide selection", () => {
  it("starts with no frame", () => {
    expect(getCardFrameSelection(makeRepo()).frame).toBeUndefined();
  });

  it("selects a frame and serves its bytes as the default image", () => {
    const repo = makeRepo();
    const id = addCardFrame(repo, "Gilt", upload, settings);
    selectCardFrame(repo, id);

    expect(getCardFrameSelection(repo).frame?.id).toBe(id);
    expect(getCardFrameImage(repo)?.data.toString()).toBe("frame-bytes");
  });

  it("turns frames off when selecting nothing", () => {
    const repo = makeRepo();
    selectCardFrame(repo, addCardFrame(repo, "Gilt", upload, settings));

    selectCardFrame(repo, undefined);

    expect(getCardFrameSelection(repo).frame).toBeUndefined();
  });

  it("clears the selection when the selected frame is deleted", () => {
    const repo = makeRepo();
    const id = addCardFrame(repo, "Gilt", upload, settings);
    selectCardFrame(repo, id);

    deleteCardFrame(repo, id);

    expect(getCardFrameSelection(repo).frame).toBeUndefined();
  });
});

describe("cardFrameVars", () => {
  const framed = (overrides: Partial<CardFrame> = {}): CardFrame => ({
    id: 7,
    name: "Gilt",
    hasImage: true,
    insets: { top: 10, right: 20, bottom: 30, left: 40 },
    fillOpacity: 0.5,
    fill: "round",
    centerFill: true,
    updatedAt: "2026-10-08 10:00:00",
    ...overrides,
  });

  it("emits nothing when no frame is selected", () => {
    expect(cardFrameVars({})).toBeUndefined();
  });

  it("emits nothing when every slice is zero", () => {
    // All-zero slices draw no border at all, which is indistinguishable from
    // having no frame — so say so rather than painting an invisible layer.
    expect(cardFrameVars({ frame: framed({ insets: { top: 0, right: 0, bottom: 0, left: 0 } }) }))
      .toBeUndefined();
  });

  it("writes the slice unitless and the width in px", () => {
    const vars = cardFrameVars({ frame: framed() })!;

    // `border-image-slice` takes bare numbers; a `px` here invalidates it.
    expect(vars["--card-frame-slice"]).toBe("10 20 30 40");
    // `border-image-width` does take units.
    expect(vars["--card-frame-width"]).toBe("10px 20px 30px 40px");
    expect(vars["--card-frame-repeat"]).toBe("round");
  });

  it("cache-busts the url with the row's updatedAt", () => {
    const vars = cardFrameVars({ frame: framed() })!;
    expect(vars["--card-frame-image"]).toContain("id=7");
    expect(vars["--card-frame-image"]).toContain(encodeURIComponent("2026-10-08 10:00:00"));
  });

  it("flags the centre off without dropping the border", () => {
    const vars = cardFrameVars({ frame: framed({ centerFill: false }) })!;

    // The CSS switches on this value rather than on a blanked variable: the
    // `fill` keyword is syntax, not a value, so it cannot be substituted away.
    expect(vars["--card-frame-center"]).toBe("off");
    // The border still draws — that is the whole point of a border-only frame.
    expect(vars["--card-frame-image"]).toContain("/api/card-frame");
  });

  it("flags the centre on by default", () => {
    expect(cardFrameVars({ frame: framed() })!["--card-frame-center"]).toBe("on");
  });

  it("carries the opacity through unchanged", () => {
    // It dims the whole frame now, border included — `fill` makes the centre
    // part of the same layer, and a layer carries one opacity. Keeping them
    // separate is what produced a visible seam.
    expect(cardFrameVars({ frame: framed({ fillOpacity: 0.25 }) })!["--card-frame-fill-opacity"])
      .toBe("0.25");
  });
});
