import { describe, expect, it } from "vitest";
import type { DecodedImage } from "@/lib/shared/image-upload";
import {
  MAX_MODULE_TEXTURE_BYTES,
  getModuleTexture,
  getModuleTextureImage,
  moduleTextureCssVars,
  removeModuleTextureImage,
  saveModuleTextureSettings,
  setModuleTextureImage,
} from "./module-texture";
import type { ModuleTextureRepository } from "./ports";
import type { ModuleTexture, ModuleTextureSettings } from "./types";

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
        hasImage: Boolean(image),
        updatedAt: "2026-08-25 11:00:00",
      });
    },
    setSettings(moduleSlug: string, settings: ModuleTextureSettings): void {
      rows.set(moduleSlug, { ...this.getTexture(moduleSlug), ...settings });
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

describe("moduleTextureCssVars", () => {
  it("returns undefined with no picture, so the shell emits no layer", () => {
    expect(moduleTextureCssVars(getModuleTexture(makeRepo(), SLUG))).toBeUndefined();
  });

  it("builds a slug-scoped URL with the updatedAt cache-buster", () => {
    const repo = makeRepo({ hasImage: true, updatedAt: "2026-08-25 12:00:00" });

    const vars = moduleTextureCssVars(getModuleTexture(repo, SLUG));

    expect(vars?.["--module-texture-image"]).toContain("/api/modules/music-library/texture");
    expect(vars?.["--module-texture-image"]).toContain("2026-08-25%2012%3A00%3A00");
  });

  it("makes size and repeat disagree between the two modes", () => {
    const cover = moduleTextureCssVars(
      getModuleTexture(makeRepo({ hasImage: true, mode: "cover" }), SLUG),
    );
    const tile = moduleTextureCssVars(
      getModuleTexture(makeRepo({ hasImage: true, mode: "tile" }), SLUG),
    );

    expect(cover).toMatchObject({
      "--module-texture-size": "cover",
      "--module-texture-repeat": "no-repeat",
    });
    expect(tile).toMatchObject({
      "--module-texture-size": "auto",
      "--module-texture-repeat": "repeat",
    });
  });

  it("passes opacity and blur through as CSS-ready strings", () => {
    const vars = moduleTextureCssVars(
      getModuleTexture(makeRepo({ hasImage: true, opacity: 0.25, blur: 6 }), SLUG),
    );

    expect(vars?.["--module-texture-opacity"]).toBe("0.25");
    expect(vars?.["--module-texture-blur"]).toBe("6px");
  });
});
