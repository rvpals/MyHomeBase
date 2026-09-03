import { describe, expect, it } from "vitest";
import type { DecodedImage } from "@/lib/shared/image-upload";
import {
  getModuleBySlug,
  getModuleCarouselImage,
  listModules,
  removeModuleCarouselImage,
  resetModulesToDefaults,
  setModuleCarouselImage,
  setModuleIcon,
  updateModules,
} from "./modules";
import type { CarouselImageProcessor, ModuleRepository } from "./ports";
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
    listAllCarouselImages() {
      return [...images.entries()]
        .map(([slug, image]) => ({ slug, data: image.data, mimeType: image.mimeType }))
        .sort((a, b) => a.slug.localeCompare(b.slug));
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
    setIcon(slug, icon) {
      state = state.map((module) => (module.slug === slug ? { ...module, icon } : module));
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
      "games",
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

describe("setModuleIcon", () => {
  it("changes just the glyph, leaving the other fields alone", () => {
    const repo = fakeRepo(sample);
    setModuleIcon(repo, "real-estate-investment", "wallet");
    const module = getModuleBySlug(repo, "real-estate-investment");
    expect(module?.icon).toBe("wallet");
    // The point of a separate write: nothing else on the row moves.
    expect(module?.shortName).toBe("Real Estate");
    expect(module?.sequence).toBe(1);
    expect(module?.isVisible).toBe(true);
  });

  it("sets the icon on a hidden module too", () => {
    // The picker is reachable for any row on the admin screen, visible or not.
    const repo = fakeRepo(sample);
    setModuleIcon(repo, "hidden-module", "music");
    expect(repo.getModuleBySlug("hidden-module")?.icon).toBe("music");
  });

  it("rejects a name no glyph set can draw, rather than storing it", () => {
    const repo = fakeRepo(sample);
    expect(() => setModuleIcon(repo, "real-estate-investment", "spaceship")).toThrow();
    expect(repo.getModuleBySlug("real-estate-investment")?.icon).toBe("building");
  });

  it("rejects an unknown slug rather than silently updating nothing", () => {
    const repo = fakeRepo(sample);
    expect(() => setModuleIcon(repo, "no-such-module", "wallet")).toThrow(/no-such-module/);
  });
});

describe("the carousel image", () => {
  /** A base64 payload of a given decoded byte length. */
  function payload(bytes: number): string {
    return Buffer.alloc(bytes, 1).toString("base64");
  }

  it("stores an upload and flips hasCarouselImage", async () => {
    const repo = fakeRepo(sample);
    expect(getModuleBySlug(repo, "real-estate-investment")?.hasCarouselImage).toBe(false);

    await setModuleCarouselImage(repo, "real-estate-investment", {
      mimeType: "image/png",
      base64Data: payload(1_024),
    });

    expect(getModuleBySlug(repo, "real-estate-investment")?.hasCarouselImage).toBe(true);
    const stored = getModuleCarouselImage(repo, "real-estate-investment");
    expect(stored?.mimeType).toBe("image/png");
    expect(stored?.data).toHaveLength(1_024);
  });

  it("removing it clears the flag and the bytes", async () => {
    const repo = fakeRepo(sample);
    await setModuleCarouselImage(repo, "real-estate-investment", {
      mimeType: "image/png",
      base64Data: payload(64),
    });

    removeModuleCarouselImage(repo, "real-estate-investment");

    expect(getModuleBySlug(repo, "real-estate-investment")?.hasCarouselImage).toBe(false);
    expect(getModuleCarouselImage(repo, "real-estate-investment")).toBeUndefined();
  });

  it("never puts image bytes on the listed modules", async () => {
    const repo = fakeRepo(sample);
    await setModuleCarouselImage(repo, "real-estate-investment", {
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

  it("rejects an image over the cap, and accepts one just under it", async () => {
    const repo = fakeRepo(sample);

    await expect(
      setModuleCarouselImage(repo, "real-estate-investment", {
        mimeType: "image/png",
        base64Data: payload(MAX_CAROUSEL_IMAGE_BYTES + 1),
      }),
    ).rejects.toThrow(/too large/i);

    await expect(
      setModuleCarouselImage(repo, "real-estate-investment", {
        mimeType: "image/png",
        base64Data: payload(MAX_CAROUSEL_IMAGE_BYTES),
      }),
    ).resolves.not.toThrow();
  });

  it("resizes through the processor when one is supplied, and stores WebP", async () => {
    const repo = fakeRepo(sample);
    // Stands in for sharp: reports a huge source and returns short bytes.
    const processor: CarouselImageProcessor = {
      probe: async () => ({ width: 3000, height: 2000 }),
      encodeWebp: async () => Buffer.from("tiny-webp-bytes"),
    };

    await setModuleCarouselImage(
      repo,
      "real-estate-investment",
      { mimeType: "image/png", base64Data: payload(1_000_000) },
      processor,
    );

    const stored = getModuleCarouselImage(repo, "real-estate-investment");
    expect(stored?.mimeType).toBe("image/webp");
    expect(stored?.data).toHaveLength("tiny-webp-bytes".length);
  });

  it("still enforces the cap on the incoming file, not the resized result", async () => {
    const repo = fakeRepo(sample);
    const processor: CarouselImageProcessor = {
      probe: async () => ({ width: 3000, height: 3000 }),
      encodeWebp: async () => Buffer.from("small"),
    };

    // Otherwise shrinking afterwards would let an arbitrarily huge body through.
    await expect(
      setModuleCarouselImage(
        repo,
        "real-estate-investment",
        { mimeType: "image/png", base64Data: payload(MAX_CAROUSEL_IMAGE_BYTES + 1) },
        processor,
      ),
    ).rejects.toThrow(/too large/i);
    expect(getModuleBySlug(repo, "real-estate-investment")?.hasCarouselImage).toBe(false);
  });

  it("refuses SVG — these bytes are served from our own origin", async () => {
    const repo = fakeRepo(sample);

    await expect(
      setModuleCarouselImage(repo, "real-estate-investment", {
        // @ts-expect-error — the point of the test is that the enum rejects it.
        mimeType: "image/svg+xml",
        base64Data: payload(32),
      }),
    ).rejects.toThrow();

    expect(getModuleBySlug(repo, "real-estate-investment")?.hasCarouselImage).toBe(false);
  });

  it("rejects an unknown slug rather than silently updating nothing", async () => {
    const repo = fakeRepo(sample);

    await expect(
      setModuleCarouselImage(repo, "no-such-module", {
        mimeType: "image/png",
        base64Data: payload(32),
      }),
    ).rejects.toThrow(/no-such-module/);
    expect(() => removeModuleCarouselImage(repo, "no-such-module")).toThrow(/no-such-module/);
  });
});
