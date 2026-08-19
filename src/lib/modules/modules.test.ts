import { describe, expect, it } from "vitest";
import type { DecodedImage } from "@/lib/shared/image-upload";
import {
  getModuleBySlug,
  getModuleCarouselImage,
  listModules,
  removeModuleCarouselImage,
  resetModulesToDefaults,
  setModuleCarouselImage,
  updateModules,
} from "./modules";
import type { ModuleRepository } from "./ports";
import { MAX_CAROUSEL_IMAGE_BYTES } from "./schema";
import type { Module } from "./types";

// Hand-written fake — no mocking framework, reusable across tests.
function fakeRepo(seed: Module[]): ModuleRepository {
  let state = [...seed];
  let nextId = state.reduce((max, module) => Math.max(max, module.id), 0) + 1;
  // Images live beside the rows, as they do in the real table — but `Module`
  // only ever carries the boolean, which is the whole point of the design.
  const images = new Map<string, DecodedImage>();
  return {
    getCarouselImage(slug) {
      return images.get(slug);
    },
    setCarouselImage(slug, image) {
      if (image) images.set(slug, image);
      else images.delete(slug);
      state = state.map((module) =>
        module.slug === slug ? { ...module, hasCarouselImage: Boolean(image) } : module,
      );
    },
    listModules({ includeHidden = false } = {}) {
      return state
        .filter((module) => includeHidden || module.isVisible)
        .sort((a, b) => a.sequence - b.sequence);
    },
    getModuleBySlug(slug) {
      return state.find((module) => module.slug === slug);
    },
    updateAll(updates) {
      state = state.map((module) => {
        const index = updates.findIndex((update) => update.slug === module.slug);
        if (index === -1) return module;
        const update = updates[index];
        return {
          ...module,
          shortName: update.shortName,
          longName: update.longName,
          description: update.description,
          isVisible: update.isVisible,
          sequence: index + 1,
        };
      });
    },
    resetToDefaults(defaults) {
      // Upsert by slug — preserves ids for modules that remain, matching the
      // real repository (so module_settings rows aren't orphaned by a reset).
      const bySlug = new Map(state.map((module) => [module.slug, module]));
      state = defaults.map((item, index) => {
        const existing = bySlug.get(item.slug);
        return {
          ...item,
          id: existing?.id ?? nextId++,
          sequence: index + 1,
          // A reset rewrites the editable fields; it doesn't wipe uploaded
          // artwork, matching the real repository's upsert (which never touches
          // the image columns).
          hasCarouselImage: existing?.hasCarouselImage ?? false,
        };
      });
    },
  };
}

const sample: Module[] = [
  {
    id: 1,
    slug: "real-estate-investment",
    shortName: "Real Estate",
    longName: "Real Estate Investment",
    sequence: 1,
    isVisible: true,
    icon: "building",
    hasCarouselImage: false,
  },
  {
    id: 2,
    slug: "hidden-module",
    shortName: "Hidden",
    longName: "Hidden Module",
    sequence: 2,
    isVisible: false,
    icon: "folder",
    hasCarouselImage: false,
  },
];

describe("listModules", () => {
  it("returns only visible modules, ordered by sequence, by default", () => {
    const result = listModules(fakeRepo(sample));
    expect(result.map((module) => module.slug)).toEqual(["real-estate-investment"]);
  });

  it("includes hidden modules when includeHidden is true", () => {
    const result = listModules(fakeRepo(sample), { includeHidden: true });
    expect(result).toHaveLength(2);
  });
});

describe("getModuleBySlug", () => {
  it("returns the module for a known slug", () => {
    expect(getModuleBySlug(fakeRepo(sample), "real-estate-investment")?.longName).toBe(
      "Real Estate Investment",
    );
  });

  it("returns undefined for an unknown slug", () => {
    expect(getModuleBySlug(fakeRepo(sample), "does-not-exist")).toBeUndefined();
  });
});

describe("updateModules", () => {
  it("updates fields and reassigns sequence from array order", () => {
    const repo = fakeRepo(sample);
    const result = updateModules(repo, [
      { slug: "hidden-module", shortName: "H2", longName: "Hidden Module Two", isVisible: true },
      { slug: "real-estate-investment", shortName: "RE", longName: "Real Estate Investment", isVisible: true },
    ]);
    expect(result.map((module) => module.slug)).toEqual(["hidden-module", "real-estate-investment"]);
    expect(result[0].shortName).toBe("H2");
    expect(result[0].isVisible).toBe(true);
  });

  it("rejects an update with an empty long name", () => {
    const repo = fakeRepo(sample);
    expect(() =>
      updateModules(repo, [
        { slug: "real-estate-investment", shortName: "RE", longName: "", isVisible: true },
      ]),
    ).toThrow();
  });
});

describe("resetModulesToDefaults", () => {
  it("restores the seeded module list", () => {
    const repo = fakeRepo([]);
    const result = resetModulesToDefaults(repo);
    expect(result.map((module) => module.slug)).toEqual([
      "stock-etfs",
      "journal",
      "csv-analysis",
      "expense",
      "attendance",
      "music-library",
    ]);
  });

  it("preserves the id of a module that remains in the defaults", () => {
    const repo = fakeRepo([
      {
        id: 42,
        slug: "stock-etfs",
        shortName: "Stocks & ETFs",
        longName: "Stock & ETFs etc",
        sequence: 1,
        isVisible: true,
        icon: "chart",
        hasCarouselImage: false,
      },
    ]);
    const result = resetModulesToDefaults(repo);
    expect(result.find((module) => module.slug === "stock-etfs")?.id).toBe(42);
  });
});

describe("the carousel image", () => {
  /** A base64 payload of a given decoded byte length. */
  function payload(bytes: number): string {
    return Buffer.alloc(bytes, 1).toString("base64");
  }

  it("stores an upload and flips hasCarouselImage", () => {
    const repo = fakeRepo(sample);
    expect(getModuleBySlug(repo, "real-estate-investment")?.hasCarouselImage).toBe(false);

    setModuleCarouselImage(repo, "real-estate-investment", {
      mimeType: "image/png",
      base64Data: payload(1_024),
    });

    expect(getModuleBySlug(repo, "real-estate-investment")?.hasCarouselImage).toBe(true);
    const stored = getModuleCarouselImage(repo, "real-estate-investment");
    expect(stored?.mimeType).toBe("image/png");
    expect(stored?.data).toHaveLength(1_024);
  });

  it("removing it clears the flag and the bytes", () => {
    const repo = fakeRepo(sample);
    setModuleCarouselImage(repo, "real-estate-investment", {
      mimeType: "image/png",
      base64Data: payload(64),
    });

    removeModuleCarouselImage(repo, "real-estate-investment");

    expect(getModuleBySlug(repo, "real-estate-investment")?.hasCarouselImage).toBe(false);
    expect(getModuleCarouselImage(repo, "real-estate-investment")).toBeUndefined();
  });

  it("never puts image bytes on the listed modules", () => {
    const repo = fakeRepo(sample);
    setModuleCarouselImage(repo, "real-estate-investment", {
      mimeType: "image/png",
      base64Data: payload(4_096),
    });

    // The whole design rests on this: a list read carries a boolean, never a
    // Buffer. `sys_modules` is read on every authenticated page.
    const listed = listModules(repo, { includeHidden: true });
    for (const listedModule of listed) {
      expect(Object.values(listedModule).some((value) => Buffer.isBuffer(value))).toBe(false);
    }
    expect(listed.find((m) => m.slug === "real-estate-investment")?.hasCarouselImage).toBe(true);
  });

  it("rejects an image over the cap, and accepts one just under it", () => {
    const repo = fakeRepo(sample);

    expect(() =>
      setModuleCarouselImage(repo, "real-estate-investment", {
        mimeType: "image/png",
        base64Data: payload(MAX_CAROUSEL_IMAGE_BYTES + 1),
      }),
    ).toThrow(/too large/i);

    expect(() =>
      setModuleCarouselImage(repo, "real-estate-investment", {
        mimeType: "image/png",
        base64Data: payload(MAX_CAROUSEL_IMAGE_BYTES),
      }),
    ).not.toThrow();
  });

  it("refuses SVG — these bytes are served from our own origin", () => {
    const repo = fakeRepo(sample);

    expect(() =>
      setModuleCarouselImage(repo, "real-estate-investment", {
        // @ts-expect-error — the point of the test is that the enum rejects it.
        mimeType: "image/svg+xml",
        base64Data: payload(32),
      }),
    ).toThrow();

    expect(getModuleBySlug(repo, "real-estate-investment")?.hasCarouselImage).toBe(false);
  });

  it("rejects an unknown slug rather than silently updating nothing", () => {
    const repo = fakeRepo(sample);

    expect(() =>
      setModuleCarouselImage(repo, "no-such-module", {
        mimeType: "image/png",
        base64Data: payload(32),
      }),
    ).toThrow(/no-such-module/);
    expect(() => removeModuleCarouselImage(repo, "no-such-module")).toThrow(/no-such-module/);
  });
});
