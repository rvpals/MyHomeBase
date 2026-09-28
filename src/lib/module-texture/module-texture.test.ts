import { describe, expect, it } from "vitest";
import type { DecodedImage } from "@/lib/shared/image-upload";
import {
  MAX_MODULE_TEXTURE_BYTES,
  getModuleTexture,
  getModuleTextureImage,
  listModulesWithTexture,
  removeModuleTextureImage,
  setModuleTextureChoice,
  saveModuleTextureSettings,
  setModuleTextureImage,
} from "./module-texture";
import type { ModuleTextureRepository } from "./ports";
import type { ModuleTexture, ModuleTextureSettings, ModuleTextureSource } from "./types";

const SLUG = "music-library";

// An in-memory stand-in keyed by slug, so these tests exercise the use-cases
// rather than SQLite. A missing key returns the defaults, mirroring the real
// repository's unseeded-row fallback.
function makeRepo(initial?: Partial<ModuleTexture>): ModuleTextureRepository & {
  rows: Map<string, ModuleTexture>;
  images: Map<string, DecodedImage>;
} {
  const rows = new Map<string, ModuleTexture>();
  const images = new Map<string, DecodedImage>();
  if (initial) {
    rows.set(SLUG, {
      moduleSlug: SLUG,
      source: "inherit",
      textureId: undefined,
      hasImage: false,
      opacity: 0.1,
      mode: "cover",
      blur: 0,
      updatedAt: "2026-08-25 10:00:00",
      ...initial,
    });
  }

  return {
    rows,
    images,
    getTexture(moduleSlug: string): ModuleTexture {
      return (
        rows.get(moduleSlug) ?? {
          moduleSlug,
          source: "inherit",
          textureId: undefined,
          hasImage: false,
          opacity: 0.1,
          mode: "cover",
          blur: 0,
          updatedAt: "",
        }
      );
    },
    getTextureImage(moduleSlug: string): DecodedImage | undefined {
      return images.get(moduleSlug);
    },
    setImage(moduleSlug: string, image: DecodedImage | undefined): void {
      if (image) images.set(moduleSlug, image);
      else images.delete(moduleSlug);
      const current = this.getTexture(moduleSlug);
      rows.set(moduleSlug, {
        ...current,
        // The mode moves with the bytes, as the real repository does (0117) —
        // otherwise an upload lands in an 'inherit' row and is never drawn.
        source: image ? "own" : "inherit",
        textureId: undefined,
        hasImage: Boolean(image),
        updatedAt: "2026-08-25 11:00:00",
      });
    },
    setSettings(moduleSlug: string, settings: ModuleTextureSettings): void {
      rows.set(moduleSlug, { ...this.getTexture(moduleSlug), ...settings });
    },
    listSlugsWithImage(): string[] {
      // Keyed on the mode, not on bytes — see the port. A module overrides when
      // it does not inherit, which includes 'none' and 'library'.
      return [...rows.values()]
        .filter((row) => row.source !== "inherit")
        .map((row) => row.moduleSlug)
        .sort();
    },
    setChoice(moduleSlug: string, source: ModuleTextureSource, textureId?: number): void {
      rows.set(moduleSlug, {
        ...this.getTexture(moduleSlug),
        source,
        textureId: source === "library" ? textureId : undefined,
      });
    },
  };
}

// A base64 upload, which is the shape that actually crosses the boundary --
// `decodeImageUpload` takes { mimeType, base64Data }, not raw bytes.
const PNG = {
  mimeType: "image/png",
  base64Data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64"),
} as const;

describe("getModuleTexture", () => {
  it("returns the display defaults for a module with no row", () => {
    const texture = getModuleTexture(makeRepo(), SLUG);

    expect(texture).toEqual({
      moduleSlug: SLUG,
      hasImage: false,
      opacity: 0.1,
      mode: "cover",
      blur: 0,
      updatedAt: "",
    });
  });

  it("normalises the slug so a mixed-case route param finds the same row", () => {
    const repo = makeRepo({ hasImage: true, blur: 12 });

    expect(getModuleTexture(repo, "Music-Library").blur).toBe(12);
  });

  it("rejects a slug that could not name a module", () => {
    expect(() => getModuleTexture(makeRepo(), "../secrets")).toThrow();
    expect(() => getModuleTexture(makeRepo(), "")).toThrow();
  });
});

describe("setModuleTextureImage", () => {
  it("stores the picture and flips hasImage", () => {
    const repo = makeRepo();

    setModuleTextureImage(repo, SLUG, PNG);

    expect(getModuleTexture(repo, SLUG).hasImage).toBe(true);
    expect(getModuleTextureImage(repo, SLUG)?.mimeType).toBe("image/png");
  });

  it("rejects a file over the cap", () => {
    const repo = makeRepo();
    const tooBig = Buffer.alloc(MAX_MODULE_TEXTURE_BYTES + 1).toString("base64");

    expect(() =>
      setModuleTextureImage(repo, SLUG, { mimeType: "image/png", base64Data: tooBig }),
    ).toThrow();
    expect(getModuleTexture(repo, SLUG).hasImage).toBe(false);
  });

  it("rejects a type that is not an image we serve", () => {
    const repo = makeRepo();

    expect(() =>
      setModuleTextureImage(repo, SLUG, {
        mimeType: "application/pdf" as never,
        base64Data: PNG.base64Data,
      }),
    ).toThrow();
  });

  it("keeps each module's picture separate", () => {
    const repo = makeRepo();

    setModuleTextureImage(repo, SLUG, PNG);

    expect(getModuleTexture(repo, "expense-tracker").hasImage).toBe(false);
  });
});

describe("removeModuleTextureImage", () => {
  it("clears the picture but leaves the knobs", () => {
    const repo = makeRepo({ hasImage: true, opacity: 0.4, blur: 8 });
    repo.images.set(SLUG, { data: Buffer.from(PNG.base64Data, "base64"), mimeType: "image/png" });

    removeModuleTextureImage(repo, SLUG);

    const texture = getModuleTexture(repo, SLUG);
    expect(texture.hasImage).toBe(false);
    expect(texture.opacity).toBe(0.4);
    expect(texture.blur).toBe(8);
    expect(getModuleTextureImage(repo, SLUG)).toBeUndefined();
  });
});

describe("saveModuleTextureSettings", () => {
  it("saves values inside the bounds", () => {
    const repo = makeRepo();

    saveModuleTextureSettings(repo, SLUG, { opacity: 0.35, mode: "tile", blur: 20 });

    expect(getModuleTexture(repo, SLUG)).toMatchObject({
      opacity: 0.35,
      mode: "tile",
      blur: 20,
    });
  });

  it.each([
    ["opacity above 1", { opacity: 1.5, mode: "cover", blur: 0 }],
    ["negative opacity", { opacity: -0.1, mode: "cover", blur: 0 }],
    ["blur above the cap", { opacity: 0.1, mode: "cover", blur: 41 }],
    ["fractional blur", { opacity: 0.1, mode: "cover", blur: 2.5 }],
    ["a mode the UI never offers", { opacity: 0.1, mode: "stretch", blur: 0 }],
  ])("rejects %s", (_label, input) => {
    expect(() =>
      saveModuleTextureSettings(makeRepo(), SLUG, input as unknown as ModuleTextureSettings),
    ).toThrow();
  });
});

describe("listModulesWithTexture", () => {
  it("is empty when no module has uploaded a picture", () => {
    expect(listModulesWithTexture(makeRepo())).toEqual([]);
  });

  it("names a module that has one", () => {
    const repo = makeRepo();
    setModuleTextureImage(repo, SLUG, PNG);

    expect(listModulesWithTexture(repo)).toEqual([SLUG]);
  });

  it("omits a module whose picture was removed but whose knobs remain", () => {
    // A row with no image means "no texture", not "a module to warn about" —
    // the admin screen would otherwise claim a module overrides when it doesn't.
    const repo = makeRepo();
    setModuleTextureImage(repo, SLUG, PNG);
    removeModuleTextureImage(repo, SLUG);

    expect(listModulesWithTexture(repo)).toEqual([]);
  });
});

describe("setModuleTextureChoice", () => {
  it("points a module at a library picture", () => {
    const repo = makeRepo();

    setModuleTextureChoice(repo, SLUG, { source: "library", textureId: 4 });

    expect(getModuleTexture(repo, SLUG)).toMatchObject({ source: "library", textureId: 4 });
  });

  it("refuses a library choice with no picture named", () => {
    expect(() => setModuleTextureChoice(makeRepo(), SLUG, { source: "library" })).toThrow(
      /which library picture/i,
    );
  });

  it("refuses an id alongside a choice that cannot use one", () => {
    expect(() =>
      setModuleTextureChoice(makeRepo(), SLUG, { source: "none", textureId: 4 }),
    ).toThrow(/only applies when picking from the library/i);
  });

  it("drops a stale id when switching away from the library", () => {
    // Otherwise the id outlives the choice and resurfaces if the module is
    // later set back to 'library'.
    const repo = makeRepo();
    setModuleTextureChoice(repo, SLUG, { source: "library", textureId: 4 });

    setModuleTextureChoice(repo, SLUG, { source: "inherit" });

    expect(getModuleTexture(repo, SLUG).textureId).toBeUndefined();
  });

  it("keeps an uploaded picture when the module switches to a library one", () => {
    // Switching back to 'own' must not require a re-upload.
    const repo = makeRepo();
    setModuleTextureImage(repo, SLUG, PNG);

    setModuleTextureChoice(repo, SLUG, { source: "library", textureId: 4 });

    expect(getModuleTexture(repo, SLUG)).toMatchObject({ source: "library", hasImage: true });
  });

  it("rejects a malformed slug before it reaches storage", () => {
    expect(() => setModuleTextureChoice(makeRepo(), "Not A Slug!", { source: "inherit" })).toThrow();
  });
});
