import { describe, expect, it } from "vitest";
import type { DecodedImage } from "@/lib/shared/image-upload";
import {
  MAX_DASHBOARD_TEXTURES,
  MAX_DASHBOARD_TEXTURE_BYTES,
  addDashboardTexture,
  dashboardTextureCssVars,
  deleteDashboardTexture,
  getDashboardTexture,
  getDashboardTextureImage,
  listDashboardTextures,
  renameDashboardTexture,
  replaceDashboardTextureImage,
  saveDashboardTextureSettings,
  selectDashboardTexture,
} from "./dashboard-texture";
import type { DashboardTextureRepository } from "./ports";
import type { DashboardTextureItem, DashboardTextureSettings } from "./types";

/**
 * An in-memory stand-in for the library table plus the selection pointer, so
 * these tests exercise the use-cases rather than SQLite.
 *
 * It mirrors the two behaviours the real repository guarantees and the
 * use-cases rely on: a delete clears a selection pointing at the deleted row,
 * and every write bumps `updatedAt`.
 */
function makeRepo(): DashboardTextureRepository & {
  items: DashboardTextureItem[];
  images: Map<number, DecodedImage>;
  selectedId?: number;
} {
  let nextId = 1;
  let clock = 0;
  const stamp = () => `2026-09-26 10:00:0${clock++}`;

  const repo = {
    items: [] as DashboardTextureItem[],
    images: new Map<number, DecodedImage>(),
    selectedId: undefined as number | undefined,

    find(id: number) {
      return repo.items.find((item) => item.id === id);
    },

    getTexture() {
      const selected = repo.selectedId ? repo.find(repo.selectedId) : undefined;
      if (!selected) {
        return {
          selectedId: undefined,
          hasImage: false,
          opacity: 0.1,
          mode: "cover" as const,
          blur: 0,
          updatedAt: "",
        };
      }
      return {
        selectedId: selected.id,
        hasImage: selected.hasImage,
        opacity: selected.opacity,
        mode: selected.mode,
        blur: selected.blur,
        updatedAt: selected.updatedAt,
      };
    },
    listTextures() {
      return repo.items;
    },
    getTextureImage(id?: number) {
      const target = id ?? repo.selectedId;
      return target === undefined ? undefined : repo.images.get(target);
    },
    addTexture(name: string, image: DecodedImage) {
      const id = nextId++;
      repo.items.push({
        id,
        name,
        hasImage: true,
        opacity: 0.1,
        mode: "cover",
        blur: 0,
        updatedAt: stamp(),
      });
      repo.images.set(id, image);
      return id;
    },
    replaceTextureImage(id: number, image: DecodedImage) {
      const item = repo.find(id);
      if (!item) return false;
      repo.images.set(id, image);
      item.updatedAt = stamp();
      return true;
    },
    renameTexture(id: number, name: string) {
      const item = repo.find(id);
      if (!item) return false;
      item.name = name;
      return true;
    },
    deleteTexture(id: number) {
      const index = repo.items.findIndex((item) => item.id === id);
      if (index === -1) return false;
      repo.items.splice(index, 1);
      repo.images.delete(id);
      // The real repository does this in the same transaction as the delete.
      if (repo.selectedId === id) repo.selectedId = undefined;
      return true;
    },
    selectTexture(id: number | undefined) {
      if (id !== undefined && !repo.find(id)) return false;
      repo.selectedId = id;
      return true;
    },
    setSettings(id: number, settings: DashboardTextureSettings) {
      const item = repo.find(id);
      if (!item) return false;
      Object.assign(item, settings, { updatedAt: stamp() });
      return true;
    },
  };

  return repo;
}

/** A 1x1 PNG — the smallest thing that is genuinely an upload. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

const PNG = { mimeType: "image/png", base64Data: PNG_BASE64 } as const;

describe("getDashboardTexture", () => {
  it("reports no picture on a fresh install", () => {
    expect(getDashboardTexture(makeRepo())).toMatchObject({
      hasImage: false,
      selectedId: undefined,
      opacity: 0.1,
    });
  });

  it("reports no picture while the library has one but nothing is selected", () => {
    const repo = makeRepo();
    addDashboardTexture(repo, "Linen", PNG);

    // Adding does not select: uploading a picture shouldn't silently replace
    // the dashboard's background.
    expect(getDashboardTexture(repo).hasImage).toBe(false);
  });

  it("reports the selected picture's own knobs", () => {
    const repo = makeRepo();
    const linen = addDashboardTexture(repo, "Linen", PNG);
    const slate = addDashboardTexture(repo, "Slate", PNG);
    saveDashboardTextureSettings(repo, linen, { opacity: 0.4, mode: "tile", blur: 2 });
    saveDashboardTextureSettings(repo, slate, { opacity: 0.05, mode: "cover", blur: 20 });

    selectDashboardTexture(repo, linen);
    expect(getDashboardTexture(repo)).toMatchObject({
      selectedId: linen,
      opacity: 0.4,
      mode: "tile",
      blur: 2,
    });

    // Switching restores the other picture's tuning rather than carrying the
    // first one's across — the whole point of per-picture knobs (migration 0113).
    selectDashboardTexture(repo, slate);
    expect(getDashboardTexture(repo)).toMatchObject({
      selectedId: slate,
      opacity: 0.05,
      mode: "cover",
      blur: 20,
    });
  });
});

describe("addDashboardTexture", () => {
  it("appends a named picture and returns its id", () => {
    const repo = makeRepo();
    const id = addDashboardTexture(repo, "Linen", PNG);

    expect(listDashboardTextures(repo)).toHaveLength(1);
    expect(listDashboardTextures(repo)[0]).toMatchObject({ id, name: "Linen", hasImage: true });
    expect(getDashboardTextureImage(repo, id)?.mimeType).toBe("image/png");
  });

  it("trims the name", () => {
    const repo = makeRepo();
    addDashboardTexture(repo, "  Linen  ", PNG);

    expect(listDashboardTextures(repo)[0].name).toBe("Linen");
  });

  it("refuses a blank name", () => {
    const repo = makeRepo();
    expect(() => addDashboardTexture(repo, "   ", PNG)).toThrow(/name/i);
    expect(listDashboardTextures(repo)).toHaveLength(0);
  });

  it("refuses a name beyond the caption's length", () => {
    const repo = makeRepo();
    expect(() => addDashboardTexture(repo, "x".repeat(41), PNG)).toThrow(/40/);
    expect(listDashboardTextures(repo)).toHaveLength(0);
  });

  it("refuses a type that isn't an allowed image", () => {
    const repo = makeRepo();
    expect(() =>
      // SVG is excluded on purpose: these bytes are served from our own origin.
      addDashboardTexture(repo, "Linen", {
        mimeType: "image/svg+xml" as never,
        base64Data: PNG_BASE64,
      }),
    ).toThrow();
    expect(listDashboardTextures(repo)).toHaveLength(0);
  });

  it("refuses a file over the size cap", () => {
    const repo = makeRepo();
    const tooBig = Buffer.alloc(MAX_DASHBOARD_TEXTURE_BYTES + 1).toString("base64");

    expect(() =>
      addDashboardTexture(repo, "Linen", { mimeType: "image/png", base64Data: tooBig }),
    ).toThrow(/too large/i);
    expect(listDashboardTextures(repo)).toHaveLength(0);
  });

  it("refuses to go past the library cap, and says so", () => {
    const repo = makeRepo();
    for (let index = 0; index < MAX_DASHBOARD_TEXTURES; index++) {
      addDashboardTexture(repo, `Texture ${index + 1}`, PNG);
    }

    expect(() => addDashboardTexture(repo, "One too many", PNG)).toThrow(
      new RegExp(String(MAX_DASHBOARD_TEXTURES)),
    );
    expect(listDashboardTextures(repo)).toHaveLength(MAX_DASHBOARD_TEXTURES);
  });

  it("takes an upload again once a picture is deleted", () => {
    const repo = makeRepo();
    for (let index = 0; index < MAX_DASHBOARD_TEXTURES; index++) {
      addDashboardTexture(repo, `Texture ${index + 1}`, PNG);
    }
    deleteDashboardTexture(repo, listDashboardTextures(repo)[0].id);

    expect(() => addDashboardTexture(repo, "Replacement", PNG)).not.toThrow();
    expect(listDashboardTextures(repo)).toHaveLength(MAX_DASHBOARD_TEXTURES);
  });
});

describe("replaceDashboardTextureImage", () => {
  it("swaps the bytes but keeps the name, the knobs and the selection", () => {
    const repo = makeRepo();
    const id = addDashboardTexture(repo, "Linen", PNG);
    saveDashboardTextureSettings(repo, id, { opacity: 0.4, mode: "tile", blur: 2 });
    selectDashboardTexture(repo, id);

    replaceDashboardTextureImage(repo, id, { mimeType: "image/webp", base64Data: PNG_BASE64 });

    expect(getDashboardTextureImage(repo, id)?.mimeType).toBe("image/webp");
    expect(listDashboardTextures(repo)[0]).toMatchObject({
      name: "Linen",
      opacity: 0.4,
      mode: "tile",
      blur: 2,
    });
    expect(getDashboardTexture(repo).selectedId).toBe(id);
  });

  it("bumps updatedAt so the cache-buster changes", () => {
    const repo = makeRepo();
    const id = addDashboardTexture(repo, "Linen", PNG);
    const before = listDashboardTextures(repo)[0].updatedAt;

    replaceDashboardTextureImage(repo, id, PNG);

    expect(listDashboardTextures(repo)[0].updatedAt).not.toBe(before);
  });

  it("refuses an unknown id", () => {
    const repo = makeRepo();
    expect(() => replaceDashboardTextureImage(repo, 404, PNG)).toThrow(/no longer exists/i);
  });

  it("refuses an oversized replacement, leaving the original in place", () => {
    const repo = makeRepo();
    const id = addDashboardTexture(repo, "Linen", PNG);
    const tooBig = Buffer.alloc(MAX_DASHBOARD_TEXTURE_BYTES + 1).toString("base64");

    expect(() =>
      replaceDashboardTextureImage(repo, id, { mimeType: "image/png", base64Data: tooBig }),
    ).toThrow(/too large/i);
    expect(getDashboardTextureImage(repo, id)?.mimeType).toBe("image/png");
  });
});

describe("renameDashboardTexture", () => {
  it("renames without touching the picture", () => {
    const repo = makeRepo();
    const id = addDashboardTexture(repo, "Linen", PNG);

    renameDashboardTexture(repo, id, "  Grey linen  ");

    expect(listDashboardTextures(repo)[0].name).toBe("Grey linen");
    expect(getDashboardTextureImage(repo, id)).toBeDefined();
  });

  it("refuses a blank name", () => {
    const repo = makeRepo();
    const id = addDashboardTexture(repo, "Linen", PNG);

    expect(() => renameDashboardTexture(repo, id, "  ")).toThrow(/name/i);
    expect(listDashboardTextures(repo)[0].name).toBe("Linen");
  });

  it("refuses an unknown id", () => {
    const repo = makeRepo();
    expect(() => renameDashboardTexture(repo, 404, "Linen")).toThrow(/no longer exists/i);
  });
});

describe("deleteDashboardTexture", () => {
  it("removes the picture and frees a space", () => {
    const repo = makeRepo();
    const id = addDashboardTexture(repo, "Linen", PNG);

    deleteDashboardTexture(repo, id);

    expect(listDashboardTextures(repo)).toHaveLength(0);
    expect(getDashboardTextureImage(repo, id)).toBeUndefined();
  });

  it("falls back to no texture when the selected picture is deleted", () => {
    const repo = makeRepo();
    const linen = addDashboardTexture(repo, "Linen", PNG);
    addDashboardTexture(repo, "Slate", PNG);
    selectDashboardTexture(repo, linen);

    deleteDashboardTexture(repo, linen);

    // Deliberately NOT promoting the remaining picture: swapping in one the
    // admin didn't choose is a worse surprise than showing none.
    expect(getDashboardTexture(repo)).toMatchObject({ hasImage: false, selectedId: undefined });
    expect(listDashboardTextures(repo)).toHaveLength(1);
  });

  it("leaves the selection alone when a different picture is deleted", () => {
    const repo = makeRepo();
    const linen = addDashboardTexture(repo, "Linen", PNG);
    const slate = addDashboardTexture(repo, "Slate", PNG);
    selectDashboardTexture(repo, linen);

    deleteDashboardTexture(repo, slate);

    expect(getDashboardTexture(repo).selectedId).toBe(linen);
  });

  it("refuses an unknown id", () => {
    const repo = makeRepo();
    expect(() => deleteDashboardTexture(repo, 404)).toThrow(/no longer exists/i);
  });
});

describe("selectDashboardTexture", () => {
  it("points the dashboard at a picture", () => {
    const repo = makeRepo();
    const id = addDashboardTexture(repo, "Linen", PNG);

    selectDashboardTexture(repo, id);

    expect(getDashboardTexture(repo)).toMatchObject({ selectedId: id, hasImage: true });
  });

  it("clears the selection when given nothing", () => {
    const repo = makeRepo();
    selectDashboardTexture(repo, addDashboardTexture(repo, "Linen", PNG));

    selectDashboardTexture(repo, undefined);

    expect(getDashboardTexture(repo).hasImage).toBe(false);
    // Clearing the selection is not a delete — the picture stays in the library.
    expect(listDashboardTextures(repo)).toHaveLength(1);
  });

  it("refuses an unknown id, leaving the current selection alone", () => {
    const repo = makeRepo();
    const id = addDashboardTexture(repo, "Linen", PNG);
    selectDashboardTexture(repo, id);

    expect(() => selectDashboardTexture(repo, 404)).toThrow(/no longer exists/i);
    expect(getDashboardTexture(repo).selectedId).toBe(id);
  });
});

describe("getDashboardTextureImage", () => {
  it("serves the selected picture's bytes with no id", () => {
    const repo = makeRepo();
    addDashboardTexture(repo, "Linen", PNG);
    const slate = addDashboardTexture(repo, "Slate", {
      mimeType: "image/webp",
      base64Data: PNG_BASE64,
    });
    selectDashboardTexture(repo, slate);

    expect(getDashboardTextureImage(repo)?.mimeType).toBe("image/webp");
  });

  it("serves nothing when no picture is selected", () => {
    const repo = makeRepo();
    addDashboardTexture(repo, "Linen", PNG);

    expect(getDashboardTextureImage(repo)).toBeUndefined();
  });
});

describe("saveDashboardTextureSettings", () => {
  it("stores valid knobs on one picture without touching the others", () => {
    const repo = makeRepo();
    const linen = addDashboardTexture(repo, "Linen", PNG);
    const slate = addDashboardTexture(repo, "Slate", PNG);

    saveDashboardTextureSettings(repo, linen, { opacity: 0.4, mode: "tile", blur: 12 });

    expect(listDashboardTextures(repo)[0]).toMatchObject({
      opacity: 0.4,
      mode: "tile",
      blur: 12,
    });
    expect(listDashboardTextures(repo)[1]).toMatchObject({
      id: slate,
      opacity: 0.1,
      mode: "cover",
      blur: 0,
    });
    expect(getDashboardTextureImage(repo, linen)).toBeDefined();
  });

  it.each([
    ["opacity above 1", { opacity: 1.5, mode: "cover", blur: 0 }],
    ["negative opacity", { opacity: -0.1, mode: "cover", blur: 0 }],
    ["an unknown mode", { opacity: 0.2, mode: "stretch", blur: 0 }],
    ["blur beyond the cap", { opacity: 0.2, mode: "cover", blur: 41 }],
    ["fractional blur", { opacity: 0.2, mode: "cover", blur: 2.5 }],
  ])("rejects %s", (_label, settings) => {
    const repo = makeRepo();
    const id = addDashboardTexture(repo, "Linen", PNG);

    expect(() =>
      saveDashboardTextureSettings(repo, id, settings as unknown as DashboardTextureSettings),
    ).toThrow();
    // The stored row is untouched by a rejected save.
    expect(listDashboardTextures(repo)[0]).toMatchObject({
      opacity: 0.1,
      mode: "cover",
      blur: 0,
    });
  });

  it("refuses an unknown id", () => {
    const repo = makeRepo();
    expect(() =>
      saveDashboardTextureSettings(repo, 404, { opacity: 0.2, mode: "cover", blur: 0 }),
    ).toThrow(/no longer exists/i);
  });
});

describe("dashboardTextureCssVars", () => {
  it("returns nothing when no picture is selected, so the layer is skipped", () => {
    expect(dashboardTextureCssVars(makeRepo().getTexture())).toBeUndefined();
  });

  it("builds cover-mode properties with a cache-busted url", () => {
    const vars = dashboardTextureCssVars({
      selectedId: 3,
      hasImage: true,
      opacity: 0.25,
      mode: "cover",
      blur: 8,
      updatedAt: "2026-08-23 11:00:00",
    });

    expect(vars).toEqual({
      "--dashboard-texture-image":
        'url("/api/dashboard/texture?v=2026-08-23%2011%3A00%3A00")',
      "--dashboard-texture-opacity": "0.25",
      "--dashboard-texture-size": "cover",
      "--dashboard-texture-repeat": "no-repeat",
      "--dashboard-texture-blur": "8px",
    });
  });

  it("tiles at natural size in tile mode", () => {
    const vars = dashboardTextureCssVars({
      selectedId: 1,
      hasImage: true,
      opacity: 0.1,
      mode: "tile",
      blur: 0,
      updatedAt: "x",
    });

    expect(vars).toMatchObject({
      "--dashboard-texture-size": "auto",
      "--dashboard-texture-repeat": "repeat",
    });
  });
});
