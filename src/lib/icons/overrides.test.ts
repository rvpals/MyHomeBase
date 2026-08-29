import { describe, expect, it } from "vitest";
import {
  clearOverride,
  getOverrideImage,
  getOverrideMap,
  listOverrides,
  saveOverride,
} from "./overrides";
import type { IconOverridesRepository, IconOverrideWrite } from "./ports";
import type { IconOverride, IconOverrideImage } from "./types";

const SLOT = "homescreen_card_daily_quote";
const SET = "solar-bold-duotone";

/** In-memory double. The use-cases depend on the port, so no database is needed. */
function fakeRepo(seed: IconOverrideWrite[] = []) {
  const rows = new Map<string, IconOverrideWrite>();
  for (const row of seed) rows.set(`${row.slotId}::${row.setId}`, row);

  const repo: IconOverridesRepository & { rows: Map<string, IconOverrideWrite> } = {
    rows,
    listForSet(setId: string): IconOverride[] {
      // Mirrors the real repository, which leaves the BLOB behind on this read.
      return [...rows.values()]
        .filter((row) => row.setId === setId)
        .map((row) => {
          const rest = { ...row };
          delete rest.imageData;
          return rest;
        });
    },
    getImage(slotId: string, setId: string): IconOverrideImage | undefined {
      const row = rows.get(`${slotId}::${setId}`);
      if (!row?.imageData || !row.imageMimeType) return undefined;
      return { data: row.imageData, mimeType: row.imageMimeType };
    },
    listAllImages() {
      return [...rows.values()]
        .filter((row) => row.imageData && row.imageMimeType)
        .map((row) => ({
          slotId: row.slotId,
          setId: row.setId,
          data: row.imageData!,
          mimeType: row.imageMimeType!,
        }));
    },
    upsert(override: IconOverrideWrite) {
      rows.set(`${override.slotId}::${override.setId}`, override);
    },
    remove(slotId: string, setId: string) {
      rows.delete(`${slotId}::${setId}`);
    },
  };
  return repo;
}

const SVG = `<svg viewBox="0 0 24 24"><path d="M4 4h8v8z"/></svg>`;
// A 1x1 PNG.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

/** A fresh repo, for the one test that only needs somewhere to write. */
function repo0() {
  return fakeRepo();
}

describe("saveOverride", () => {
  it("sanitizes and stores an SVG upload with its drawing size", async () => {
    const repo = fakeRepo();
    const saved = await saveOverride(repo, { slotId: SLOT, setId: SET, kind: "svg", source: SVG });

    expect(saved.svgBody).toContain(`d="M4 4h8v8z"`);
    expect(saved.svgWidth).toBe(24);
    expect(saved.svgHeight).toBe(24);
    expect(repo.rows.size).toBe(1);
  });

  it("strips script from an SVG upload before it reaches storage", async () => {
    const repo = fakeRepo();
    const saved = await saveOverride(repo, {
      slotId: SLOT,
      setId: SET,
      kind: "svg",
      source: `<svg viewBox="0 0 24 24"><script>alert(1)</script><path d="M0 0h1v1z"/></svg>`,
    });

    expect(saved.svgBody).not.toContain("alert");
    expect(repo.rows.get(`${SLOT}::${SET}`)?.svgBody).not.toContain("script");
  });

  it("decodes and stores a raster upload", async () => {
    const repo = fakeRepo();
    const saved = await saveOverride(repo, {
      slotId: SLOT,
      setId: SET,
      kind: "raster",
      mimeType: "image/png",
      base64Data: PNG_BASE64,
    });

    expect(saved.imageMimeType).toBe("image/png");
    expect(saved.svgBody).toBeUndefined();
    expect(repo.rows.get(`${SLOT}::${SET}`)?.imageData?.length).toBeGreaterThan(0);
  });

  it("replaces an SVG override with a raster one, clearing the old body", async () => {
    // The table CHECK-constrains "exactly one payload", so the second write must null
    // out the first one's columns rather than leaving a row carrying both.
    const repo = fakeRepo();
    await saveOverride(repo, { slotId: SLOT, setId: SET, kind: "svg", source: SVG });
    await saveOverride(repo, {
      slotId: SLOT,
      setId: SET,
      kind: "raster",
      mimeType: "image/png",
      base64Data: PNG_BASE64,
    });

    const row = repo.rows.get(`${SLOT}::${SET}`);
    expect(repo.rows.size).toBe(1);
    expect(row?.svgBody).toBeUndefined();
    expect(row?.imageMimeType).toBe("image/png");
  });

  it("keeps overrides for two sets apart", async () => {
    const repo = fakeRepo();
    await saveOverride(repo, { slotId: SLOT, setId: "lucide", kind: "svg", source: SVG });
    await saveOverride(repo, { slotId: SLOT, setId: "tabler", kind: "svg", source: SVG });

    expect(repo.rows.size).toBe(2);
    expect(getOverrideMap(repo, "lucide")[SLOT]).toBeDefined();
    expect(getOverrideMap(repo, "mingcute")[SLOT]).toBeUndefined();
  });

  describe("when a processor is supplied", () => {
    const okProcessor = {
      async decode() {
        // 8x8 opaque white: a flattened solid backdrop with nothing in it.
        const d = Buffer.alloc(8 * 8 * 4);
        for (let i = 0; i < d.length; i += 4) {
          d[i] = 255;
          d[i + 1] = 255;
          d[i + 2] = 255;
          d[i + 3] = 255;
        }
        return { data: d, width: 8, height: 8 };
      },
      async encodePng() {
        return Buffer.from("processed-png-bytes");
      },
    };

    it("stores the processed PNG rather than the uploaded bytes", async () => {
      const repo = fakeRepo();
      const saved = await saveOverride(
        repo,
        { slotId: SLOT, setId: SET, kind: "raster", mimeType: "image/png", base64Data: PNG_BASE64 },
        new Date(),
        okProcessor,
      );

      expect(saved.imageMimeType).toBe("image/png");
      expect(repo.rows.get(`${SLOT}::${SET}`)?.imageData?.toString()).toBe("processed-png-bytes");
    });

    it("keeps the original bytes when one image is unreadable", async () => {
      // A decoder that chokes on an odd-but-valid file must not cost the reader their
      // upload — the bytes already passed the allowlist and the size cap.
      const repo = fakeRepo();
      const badImage = {
        async decode(): Promise<never> {
          throw new Error("unsupported image format");
        },
        async encodePng() {
          return Buffer.alloc(0);
        },
      };

      const saved = await saveOverride(
        repo,
        { slotId: SLOT, setId: SET, kind: "raster", mimeType: "image/png", base64Data: PNG_BASE64 },
        new Date(),
        badImage,
      );

      expect(saved.imageMimeType).toBe("image/png");
      expect(repo.rows.get(`${SLOT}::${SET}`)?.imageData?.length).toBeGreaterThan(0);
    });

    it("fails loudly when image processing is unavailable on this server", async () => {
      // A native module that won't load is an INSTALL problem. Storing the raw upload
      // would appear to work while silently producing the muddy icon the pipeline exists
      // to prevent — and nothing would ever say why.
      const repo = fakeRepo();
      const unavailable = {
        async decode(): Promise<never> {
          throw new Error("Image processing is unavailable on this server — sharp failed to load.");
        },
        async encodePng() {
          return Buffer.alloc(0);
        },
      };

      await expect(
        saveOverride(
          repo,
          {
            slotId: SLOT,
            setId: SET,
            kind: "raster",
            mimeType: "image/png",
            base64Data: PNG_BASE64,
          },
          new Date(),
          unavailable,
        ),
      ).rejects.toThrow(/unavailable on this server/);
      expect(repo.rows.size).toBe(0);
    });

    it("does not run the processor for an SVG upload", async () => {
      let touched = false;
      const spy = {
        async decode(): Promise<never> {
          touched = true;
          throw new Error("should not be called");
        },
        async encodePng() {
          return Buffer.alloc(0);
        },
      };

      await saveOverride(
        repo0(),
        { slotId: SLOT, setId: SET, kind: "svg", source: SVG },
        new Date(),
        spy,
      );
      expect(touched).toBe(false);
    });
  });

  it("refuses an unknown slot id", async () => {
    const repo = fakeRepo();
    await expect(
      saveOverride(repo, { slotId: "not_a_real_slot", setId: SET, kind: "svg", source: SVG }),
    ).rejects.toThrow(/Unknown icon position/);
    expect(repo.rows.size).toBe(0);
  });

  it("refuses a disallowed image type", async () => {
    const repo = fakeRepo();
    await expect(
      saveOverride(repo, {
        slotId: SLOT,
        setId: SET,
        kind: "raster",
        // @ts-expect-error — proving the runtime schema rejects it, not just the types.
        mimeType: "image/svg+xml",
        base64Data: PNG_BASE64,
      }),
    ).rejects.toThrow();
  });

  it("refuses an SVG with nothing drawable in it", async () => {
    const repo = fakeRepo();
    await expect(
      saveOverride(repo, {
        slotId: SLOT,
        setId: SET,
        kind: "svg",
        source: `<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>`,
      }),
    ).rejects.toThrow(/no drawable shapes/i);
  });
});

describe("getOverrideMap", () => {
  it("keys overrides by slot id", async () => {
    const repo = fakeRepo();
    await saveOverride(repo, { slotId: SLOT, setId: SET, kind: "svg", source: SVG });
    expect(Object.keys(getOverrideMap(repo, SET))).toEqual([SLOT]);
  });

  it("hides a row whose slot has left the registry", async () => {
    // A slot id disappears when a feature is removed. The stale row must not become a
    // glyph that no screen can reach to delete.
    const repo = fakeRepo([
      { slotId: "retired_card_gone", setId: SET, svgBody: "<path/>", updatedAt: "2026-01-01" },
    ]);
    expect(getOverrideMap(repo, SET)).toEqual({});
    expect(listOverrides(repo, SET)).toEqual([]);
  });

  it("is empty for a set with no overrides", async () => {
    expect(getOverrideMap(fakeRepo(), SET)).toEqual({});
  });
});

describe("getOverrideImage", () => {
  it("returns raster bytes for a stored image", async () => {
    const repo = fakeRepo();
    await saveOverride(repo, {
      slotId: SLOT,
      setId: SET,
      kind: "raster",
      mimeType: "image/png",
      base64Data: PNG_BASE64,
    });
    expect(getOverrideImage(repo, SLOT, SET)?.mimeType).toBe("image/png");
  });

  it("returns nothing for an SVG override or an unknown slot", async () => {
    const repo = fakeRepo();
    await saveOverride(repo, { slotId: SLOT, setId: SET, kind: "svg", source: SVG });
    expect(getOverrideImage(repo, SLOT, SET)).toBeUndefined();
    expect(getOverrideImage(repo, "not_a_real_slot", SET)).toBeUndefined();
  });
});

describe("clearOverride", () => {
  it("removes the override so the slot falls back to its set glyph", async () => {
    const repo = fakeRepo();
    await saveOverride(repo, { slotId: SLOT, setId: SET, kind: "svg", source: SVG });
    clearOverride(repo, { slotId: SLOT, setId: SET });
    expect(repo.rows.size).toBe(0);
  });

  it("is a no-op when there is nothing to clear", async () => {
    const repo = fakeRepo();
    expect(() => clearOverride(repo, { slotId: SLOT, setId: SET })).not.toThrow();
  });
});
