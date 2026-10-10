import { describe, expect, it } from "vitest";
import type { DashboardTextureItem } from "@/lib/dashboard-texture";
import {
  DEFAULT_NAV_TEXTURE_OPACITY,
  navTextureVars,
  NO_NAV_TEXTURE,
  resolveNavTexture,
  resolveNavTextureOpacity,
} from "./nav-texture";

// No fake repository, the same as `app-texture.test.ts`: these are pure
// functions over already-read data, so the fixtures are the domain type itself.

function picture(overrides: Partial<DashboardTextureItem> = {}): DashboardTextureItem {
  return {
    id: 4,
    name: "Linen",
    hasImage: true,
    opacity: 0.1,
    mode: "cover",
    blur: 0,
    updatedAt: "2026-10-09 12:00:00",
    ...overrides,
  };
}

describe("resolveNavTextureOpacity", () => {
  it("returns the stored value when it is a number in range", () => {
    expect(resolveNavTextureOpacity("0.4")).toBe(0.4);
    expect(resolveNavTextureOpacity("0")).toBe(0);
    expect(resolveNavTextureOpacity("1")).toBe(1);
  });

  it("falls back to the default when the row is absent or blank", () => {
    expect(resolveNavTextureOpacity(undefined)).toBe(DEFAULT_NAV_TEXTURE_OPACITY);
    expect(resolveNavTextureOpacity("")).toBe(DEFAULT_NAV_TEXTURE_OPACITY);
    expect(resolveNavTextureOpacity("   ")).toBe(DEFAULT_NAV_TEXTURE_OPACITY);
  });

  it("falls back to the default rather than NaN on an unparseable value", () => {
    // The settings table is free-form text with no CHECK, so this is the only
    // guard between a hand-edited row and an invalid opacity in the CSS.
    expect(resolveNavTextureOpacity("quiet")).toBe(DEFAULT_NAV_TEXTURE_OPACITY);
  });

  it("clamps a value outside 0..1 instead of passing it through", () => {
    expect(resolveNavTextureOpacity("40")).toBe(1);
    expect(resolveNavTextureOpacity("-3")).toBe(0);
  });
});

describe("resolveNavTexture", () => {
  it("resolves a chosen picture to a cache-busted url and the nav's own opacity", () => {
    const resolved = resolveNavTexture({ id: "4", opacity: "0.3" }, [picture()]);

    expect(resolved).toEqual({
      image: 'url("/api/dashboard/texture?id=4&v=2026-10-09%2012%3A00%3A00")',
      // The navigation's 0.3, NOT the library row's 0.1 — the divergence
      // migration 0130 documents for a toolbar applies here for the same reason.
      opacity: 0.3,
    });
  });

  it("uses the default opacity when only a picture has been chosen", () => {
    const resolved = resolveNavTexture({ id: "4" }, [picture()]);
    expect(resolved?.opacity).toBe(DEFAULT_NAV_TEXTURE_OPACITY);
  });

  it("resolves to undefined when no picture is chosen", () => {
    expect(resolveNavTexture({}, [picture()])).toBeUndefined();
    expect(resolveNavTexture({ id: "" }, [picture()])).toBeUndefined();
    expect(resolveNavTexture({ id: "  " }, [picture()])).toBeUndefined();
  });

  it('treats the "0" sentinel as no texture', () => {
    // How "none" is stored, since `settingUpdateSchema` rejects a blank value.
    // Library ids start at 1, so this shadows no real picture.
    expect(resolveNavTexture({ id: NO_NAV_TEXTURE }, [picture()])).toBeUndefined();
    expect(resolveNavTexture({ id: "-1" }, [picture()])).toBeUndefined();
  });

  it("resolves to undefined on an unparseable id", () => {
    expect(resolveNavTexture({ id: "linen" }, [picture()])).toBeUndefined();
    expect(resolveNavTexture({ id: "4.5" }, [picture()])).toBeUndefined();
  });

  it("falls through to no texture when the picture has been deleted", () => {
    // The stale-pointer case: there is no foreign key, so an admin deleting a
    // library picture leaves this pointer behind. Resolving it to undefined is
    // what stops a 404ing layer from rendering as a visibly broken column.
    expect(resolveNavTexture({ id: "99" }, [picture()])).toBeUndefined();
    expect(resolveNavTexture({ id: "4" }, [])).toBeUndefined();
  });

  it("falls through when the row carries no image bytes", () => {
    expect(resolveNavTexture({ id: "4" }, [picture({ hasImage: false })])).toBeUndefined();
  });
});

describe("navTextureVars", () => {
  it("names the two custom properties the stylesheet reads", () => {
    expect(navTextureVars({ image: 'url("/x")', opacity: 0.25 })).toEqual({
      "--nav-texture-image": 'url("/x")',
      "--nav-texture-opacity": "0.25",
    });
  });
});
