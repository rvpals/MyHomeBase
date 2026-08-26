import { describe, expect, it } from "vitest";
import type { DecodedImage } from "@/lib/shared/image-upload";
import {
  MAX_DASHBOARD_TEXTURE_BYTES,
  dashboardTextureCssVars,
  getDashboardTexture,
  getDashboardTextureImage,
  removeDashboardTextureImage,
  saveDashboardTextureSettings,
  setDashboardTextureImage,
} from "./dashboard-texture";
import type { DashboardTextureRepository } from "./ports";
import type { DashboardTexture, DashboardTextureSettings } from "./types";

// An in-memory stand-in for the table's single row, so these tests exercise the
// use-cases rather than SQLite.
function makeRepo(initial?: Partial<DashboardTexture>): DashboardTextureRepository & {
  state: DashboardTexture;
  image?: DecodedImage;
} {
  const repo = {
    state: {
      hasImage: false,
      opacity: 0.1,
      mode: "cover",
      blur: 0,
      updatedAt: "2026-08-23 10:00:00",
      ...initial,
    } as DashboardTexture,
    image: undefined as DecodedImage | undefined,

    getTexture(): DashboardTexture {
      return repo.state;
    },
    getTextureImage(): DecodedImage | undefined {
      return repo.image;
    },
    setImage(image: DecodedImage | undefined): void {
      repo.image = image;
      repo.state = { ...repo.state, hasImage: Boolean(image), updatedAt: "2026-08-23 11:00:00" };
    },
    setSettings(settings: DashboardTextureSettings): void {
      repo.state = { ...repo.state, ...settings };
    },
  };
  return repo;
}

/** A 1x1 PNG — the smallest thing that is genuinely an upload. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

describe("getDashboardTexture", () => {
  it("reports no picture on a fresh install", () => {
    expect(getDashboardTexture(makeRepo())).toMatchObject({ hasImage: false, opacity: 0.1 });
  });
});

describe("setDashboardTextureImage", () => {
  it("stores an upload and flips hasImage", () => {
    const repo = makeRepo();
    setDashboardTextureImage(repo, { mimeType: "image/png", base64Data: PNG_BASE64 });

    expect(getDashboardTexture(repo).hasImage).toBe(true);
    expect(getDashboardTextureImage(repo)?.mimeType).toBe("image/png");
  });

  it("bumps updatedAt so the cache-buster changes", () => {
    const repo = makeRepo();
    const before = getDashboardTexture(repo).updatedAt;
    setDashboardTextureImage(repo, { mimeType: "image/png", base64Data: PNG_BASE64 });

    expect(getDashboardTexture(repo).updatedAt).not.toBe(before);
  });

  it("refuses a type that isn't an allowed image", () => {
    const repo = makeRepo();
    expect(() =>
      // SVG is excluded on purpose: these bytes are served from our own origin.
      setDashboardTextureImage(repo, {
        mimeType: "image/svg+xml" as never,
        base64Data: PNG_BASE64,
      }),
    ).toThrow();
    expect(getDashboardTexture(repo).hasImage).toBe(false);
  });

  it("refuses a file over the size cap", () => {
    const repo = makeRepo();
    const tooBig = Buffer.alloc(MAX_DASHBOARD_TEXTURE_BYTES + 1).toString("base64");

    expect(() =>
      setDashboardTextureImage(repo, { mimeType: "image/png", base64Data: tooBig }),
    ).toThrow(/too large/i);
    expect(getDashboardTexture(repo).hasImage).toBe(false);
  });
});

describe("removeDashboardTextureImage", () => {
  it("clears the picture and the flag", () => {
    const repo = makeRepo();
    setDashboardTextureImage(repo, { mimeType: "image/png", base64Data: PNG_BASE64 });
    removeDashboardTextureImage(repo);

    expect(getDashboardTexture(repo).hasImage).toBe(false);
    expect(getDashboardTextureImage(repo)).toBeUndefined();
  });
});

describe("saveDashboardTextureSettings", () => {
  it("stores valid knobs without touching the picture", () => {
    const repo = makeRepo();
    setDashboardTextureImage(repo, { mimeType: "image/png", base64Data: PNG_BASE64 });
    saveDashboardTextureSettings(repo, { opacity: 0.4, mode: "tile", blur: 12 });

    expect(getDashboardTexture(repo)).toMatchObject({ opacity: 0.4, mode: "tile", blur: 12 });
    expect(getDashboardTextureImage(repo)).toBeDefined();
  });

  it.each([
    ["opacity above 1", { opacity: 1.5, mode: "cover", blur: 0 }],
    ["negative opacity", { opacity: -0.1, mode: "cover", blur: 0 }],
    ["an unknown mode", { opacity: 0.2, mode: "stretch", blur: 0 }],
    ["blur beyond the cap", { opacity: 0.2, mode: "cover", blur: 41 }],
    ["fractional blur", { opacity: 0.2, mode: "cover", blur: 2.5 }],
  ])("rejects %s", (_label, settings) => {
    const repo = makeRepo();
    expect(() =>
      saveDashboardTextureSettings(repo, settings as unknown as DashboardTextureSettings),
    ).toThrow();
    // The stored row is untouched by a rejected save.
    expect(getDashboardTexture(repo)).toMatchObject({ opacity: 0.1, mode: "cover", blur: 0 });
  });
});

describe("dashboardTextureCssVars", () => {
  it("returns nothing when no picture is uploaded, so the layer is skipped", () => {
    expect(dashboardTextureCssVars(makeRepo().state)).toBeUndefined();
  });

  it("builds cover-mode properties with a cache-busted url", () => {
    const vars = dashboardTextureCssVars({
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
