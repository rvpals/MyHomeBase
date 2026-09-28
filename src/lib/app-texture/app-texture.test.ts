import { describe, expect, it } from "vitest";
import type { DashboardTexture, DashboardTextureItem } from "@/lib/dashboard-texture";
import type { ModuleTexture } from "@/lib/module-texture";
import {
  homeDrawsOwnTexture,
  homeTexture,
  moduleTextureLibraryId,
  resolveAppTexture,
} from "./app-texture";

// No fake repository here, unlike the two texture modules' own tests: these are
// pure functions over already-read domain objects, so the "fixtures" are just
// the two domain types.

function appTexture(overrides: Partial<DashboardTexture> = {}): DashboardTexture {
  return {
    selectedId: 7,
    appWide: false,
    hasImage: true,
    opacity: 0.1,
    mode: "cover",
    blur: 0,
    updatedAt: "2026-09-27 10:00:00",
    ...overrides,
  };
}

function moduleTexture(overrides: Partial<ModuleTexture> = {}): ModuleTexture {
  return {
    moduleSlug: "music-library",
    source: "own",
    textureId: undefined,
    hasImage: true,
    opacity: 0.2,
    mode: "tile",
    blur: 12,
    updatedAt: "2026-09-27 11:00:00",
    ...overrides,
  };
}

function libraryTexture(overrides: Partial<DashboardTextureItem> = {}): DashboardTextureItem {
  return {
    id: 4,
    name: "Linen",
    hasImage: true,
    opacity: 0.3,
    mode: "tile",
    blur: 5,
    updatedAt: "2026-09-28 09:00:00",
    ...overrides,
  };
}

describe("resolveAppTexture", () => {
  it("draws nothing when the app texture is not app-wide and there is no module picture", () => {
    // The shipped default after migration 0116: a selected picture, scope off.
    // Every screen but home falls here, which is what makes the upgrade inert.
    const resolved = resolveAppTexture(appTexture({ appWide: false }));

    expect(resolved.source).toBe("none");
    expect(resolved.vars).toBeUndefined();
  });

  it("draws the app texture on a screen that belongs to no module once scope is on", () => {
    const resolved = resolveAppTexture(appTexture({ appWide: true }));

    expect(resolved.source).toBe("app");
    expect(resolved.vars).toEqual({
      "--app-texture-image": 'url("/api/dashboard/texture?v=2026-09-27%2010%3A00%3A00")',
      "--app-texture-opacity": "0.1",
      "--app-texture-size": "cover",
      "--app-texture-repeat": "no-repeat",
      "--app-texture-blur": "0px",
    });
  });

  it("lets a module's own picture win over an app-wide one", () => {
    // The guarantee the whole per-module override exists for: turning scope on
    // must not replace a background a module already had.
    const resolved = resolveAppTexture(appTexture({ appWide: true }), moduleTexture());

    expect(resolved.source).toBe("module");
    expect(resolved.vars?.["--app-texture-image"]).toBe(
      'url("/api/modules/music-library/texture?v=2026-09-27%2011%3A00%3A00")',
    );
    // The module's own knobs travel with it, not the app texture's.
    expect(resolved.vars?.["--app-texture-opacity"]).toBe("0.2");
    expect(resolved.vars?.["--app-texture-blur"]).toBe("12px");
  });

  it("draws a module's picture even when the app texture is off entirely", () => {
    // Today's Music Library behaviour, which must survive the change.
    const resolved = resolveAppTexture(
      appTexture({ appWide: false, hasImage: false }),
      moduleTexture(),
    );

    expect(resolved.source).toBe("module");
  });

  it("falls back to the app texture when the module has no picture of its own", () => {
    const resolved = resolveAppTexture(
      appTexture({ appWide: true }),
      moduleTexture({ source: "inherit", hasImage: false }),
    );

    expect(resolved.source).toBe("app");
  });

  it("draws nothing when scope is on but nothing is selected", () => {
    // The flag can outlive the picture — an admin ticks scope before choosing
    // one, or deletes the selected texture. Emitting a layer here would request
    // a 404 URL on every screen.
    const resolved = resolveAppTexture(
      appTexture({ appWide: true, hasImage: false, selectedId: undefined }),
    );

    expect(resolved.source).toBe("none");
    expect(resolved.vars).toBeUndefined();
  });

  it("emits tile mode as repeat at natural size", () => {
    const resolved = resolveAppTexture(appTexture({ appWide: true, mode: "tile" }));

    expect(resolved.vars?.["--app-texture-size"]).toBe("auto");
    expect(resolved.vars?.["--app-texture-repeat"]).toBe("repeat");
  });

  it("draws a library picture the module pointed at, with that picture's tuning", () => {
    const resolved = resolveAppTexture(
      appTexture({ appWide: true }),
      moduleTexture({ source: "library", textureId: 4, hasImage: false }),
      libraryTexture(),
    );

    expect(resolved.source).toBe("module");
    expect(resolved.vars?.["--app-texture-image"]).toBe(
      'url("/api/dashboard/texture?id=4&v=2026-09-28%2009%3A00%3A00")',
    );
    // The library row's knobs, not the app selection's and not the module's.
    expect(resolved.vars?.["--app-texture-opacity"]).toBe("0.3");
    expect(resolved.vars?.["--app-texture-blur"]).toBe("5px");
    expect(resolved.vars?.["--app-texture-size"]).toBe("auto");
  });

  it("falls back to the app texture when the pointed-at picture was deleted", () => {
    // 0117 stores no foreign key, so a dangling id is a state that really
    // happens. It must degrade, not emit a layer whose image 404s.
    const resolved = resolveAppTexture(
      appTexture({ appWide: true }),
      moduleTexture({ source: "library", textureId: 999, hasImage: false }),
      undefined,
    );

    expect(resolved.source).toBe("app");
  });

  it("draws nothing when the module chose none, even with an app-wide texture", () => {
    // The opt-out. This is the one mode that means *less* than what the app
    // would otherwise draw, so it has to outrank rule 4.
    const resolved = resolveAppTexture(
      appTexture({ appWide: true }),
      moduleTexture({ source: "none", hasImage: false }),
    );

    expect(resolved.source).toBe("none");
    expect(resolved.vars).toBeUndefined();
  });

  it("lets none win even over the module's own uploaded picture", () => {
    // The bytes stay in the row when a module switches to `none`, so the mode —
    // not the presence of an image — has to decide.
    const resolved = resolveAppTexture(
      appTexture({ appWide: true }),
      moduleTexture({ source: "none", hasImage: true }),
    );

    expect(resolved.source).toBe("none");
  });

  it("ignores a module's own bytes when it has switched to inherit", () => {
    // Removing a picture sets the mode back to inherit but leaves the bytes, so
    // a resolver keyed on `hasImage` alone would keep drawing the old picture.
    const resolved = resolveAppTexture(
      appTexture({ appWide: true }),
      moduleTexture({ source: "inherit", hasImage: true }),
    );

    expect(resolved.source).toBe("app");
  });

  it("escapes a slug and a timestamp into the image URL", () => {
    // `updatedAt` carries a space and colons; unescaped they would end the CSS
    // url() token and the layer would silently draw nothing.
    const resolved = resolveAppTexture(
      appTexture({ appWide: true }),
      moduleTexture({ moduleSlug: "a b", updatedAt: "2026-09-27 11:00:00" }),
    );

    expect(resolved.vars?.["--app-texture-image"]).toBe(
      'url("/api/modules/a%20b/texture?v=2026-09-27%2011%3A00%3A00")',
    );
  });
});

describe("homeDrawsOwnTexture", () => {
  it("is true when a picture is selected and scope is off", () => {
    // 0063's original behaviour: the home dashboard draws it, nothing else does.
    expect(homeDrawsOwnTexture(appTexture({ appWide: false }))).toBe(true);
  });

  it("is false when scope is on, because the layout already drew it", () => {
    // The guard against two identical fixed layers stacking on the home screen —
    // which would double the opacity the admin tuned.
    expect(homeDrawsOwnTexture(appTexture({ appWide: true }))).toBe(false);
  });

  it("is false when nothing is selected", () => {
    expect(homeDrawsOwnTexture(appTexture({ hasImage: false }))).toBe(false);
  });
});

describe("homeTexture", () => {
  it("gives the home dashboard the selection's vars when scope is off", () => {
    const resolved = homeTexture(appTexture({ appWide: false }));

    expect(resolved.source).toBe("app");
    expect(resolved.vars?.["--app-texture-image"]).toBe(
      'url("/api/dashboard/texture?v=2026-09-27%2010%3A00%3A00")',
    );
  });

  it("gives the home dashboard nothing when the layout already drew it", () => {
    // Without this the home screen would stack a second identical fixed layer
    // inside the layout's, compositing the picture twice and doubling the
    // opacity the admin tuned.
    const resolved = homeTexture(appTexture({ appWide: true }));

    expect(resolved.source).toBe("none");
    expect(resolved.vars).toBeUndefined();
  });

  it("gives the home dashboard nothing when no picture is selected", () => {
    expect(homeTexture(appTexture({ hasImage: false })).vars).toBeUndefined();
  });
});

describe("moduleTextureLibraryId", () => {
  it("names the id only when the module points at the library", () => {
    expect(moduleTextureLibraryId(moduleTexture({ source: "library", textureId: 4 }))).toBe(4);
  });

  it("is undefined for every other source, so no lookup happens", () => {
    expect(moduleTextureLibraryId(moduleTexture({ source: "own" }))).toBeUndefined();
    expect(moduleTextureLibraryId(moduleTexture({ source: "none" }))).toBeUndefined();
    expect(moduleTextureLibraryId(moduleTexture({ source: "inherit" }))).toBeUndefined();
  });

  it("is undefined on a screen that belongs to no module", () => {
    expect(moduleTextureLibraryId(undefined)).toBeUndefined();
  });
});
