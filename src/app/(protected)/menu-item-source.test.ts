// The real catalogue, not a fake one.
//
// `menu-items.test.ts` covers the use-case logic against fixtures. This file covers
// the thing fixtures cannot: that the ids derived from the *actual* section files and
// `adminNav` are unique, and that every one of them resolves to a registered icon
// slot. Both failures are silent in production — a duplicate id makes a toolbar entry
// ambiguous, and a mismatched id simply never matches an uploaded icon — which is
// exactly why they are asserted here rather than left to a browser check.

import { describe, expect, it } from "vitest";
import { getIconSlot } from "@/lib/icons";
import { DEFAULT_MODULES } from "@/lib/modules/defaults";
import { ADMIN_TREE_MODULE } from "./admin-tree-module";
import { adminMenuItemId, buildMenuItemSeeds, moduleMenuItemId } from "./menu-item-source";

/** The shipped module list, in the shape the source takes. */
const MODULES = DEFAULT_MODULES.map((appModule) => ({
  slug: appModule.slug,
  shortName: appModule.shortName,
}));

const SEEDS = buildMenuItemSeeds(MODULES);

describe("buildMenuItemSeeds", () => {
  it("gives every destination a unique id", () => {
    const ids = SEEDS.map((seed) => seed.id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(duplicates).toEqual([]);
  });

  it("covers Home, every module's sections and every Administration screen", () => {
    expect(SEEDS.filter((seed) => seed.kind === "home")).toHaveLength(1);
    // Ten shipped modules, each contributing at least its `main` section.
    expect(new Set(SEEDS.filter((s) => s.kind === "module-section").map((s) => s.moduleSlug)).size)
      .toBe(DEFAULT_MODULES.length);
    expect(SEEDS.filter((seed) => seed.kind === "admin").length).toBeGreaterThan(0);
  });

  it("gives every item a title and a destination", () => {
    for (const seed of SEEDS) {
      expect(seed.defaultTitle, seed.id).toBeTruthy();
      expect(seed.href, seed.id).toMatch(/^\//);
    }
  });

  it("files Home under no module, so it is offered on its own", () => {
    const home = SEEDS.find((seed) => seed.kind === "home");
    expect(home?.moduleSlug).toBeUndefined();
  });

  it("keeps the three retired Administration ids addressable", () => {
    // Security, System Log and Message Queue stopped being nav nodes when they
    // folded into System Messages' tabs, so the derived loop no longer emits them.
    // They are re-emitted as aliases, because a menu item id is permanent once
    // shipped: a personal toolbar row saved against one still points at it, and
    // dropping the seed would lose the row and its uploaded icon with no error.
    const byId = new Map(SEEDS.map((seed) => [seed.id, seed]));

    for (const [id, tab] of [
      ["admin_section_security", "security"],
      ["admin_section_system_log", "system-log"],
      ["admin_section_messages", "messages"],
    ] as const) {
      const seed = byId.get(id);
      expect(seed, id).toBeDefined();
      // Each must land on the tab that replaced it, not on the screen's default.
      expect(seed?.href).toBe(`/admin/system-messages?tab=${tab}`);
    }
  });

  it("does not draw the retired ids as a second navigation entry", () => {
    // They are menu items only. `adminNav` has one node where it had three, so the
    // tree and the section panel must show System Messages alone — an alias that
    // leaked back into the nav would put four entries where the merge left one.
    const adminHrefs = ADMIN_TREE_MODULE.sections.map((section) => section.href);
    expect(adminHrefs).toContain("/admin/system-messages");
    expect(adminHrefs).not.toContain("/admin/security");
    expect(adminHrefs).not.toContain("/admin/system-log");
    expect(adminHrefs).not.toContain("/admin/messages");
  });

  it("resolves every id to a registered icon slot", () => {
    // The whole premise of the feature: a menu item's id IS its icon slot id. A
    // mismatch does not throw — it silently stops addressing the right artwork — so
    // this is the assertion that keeps the two systems one system.
    //
    // Home is the one exception and is excluded: it is not a section of anything, so
    // `sectionSlotId` never produced an id for it and no slot is registered under
    // `home`. Its glyph comes from `HOME_SECTION.icon`.
    for (const seed of SEEDS) {
      if (seed.kind === "home") continue;
      expect(getIconSlot(seed.id), `${seed.id} (${seed.defaultTitle})`).toBeDefined();
    }
  });
});

describe("moduleMenuItemId", () => {
  it("uses the icon namespace, not the module slug, where the two differ", () => {
    // The three renamed modules. Getting this wrong is invisible at runtime and
    // would point every one of their items at an unregistered slot.
    expect(moduleMenuItemId("investments", "main")).toBe("stock_section_main");
    expect(moduleMenuItemId("csv-analysis", "main")).toBe("csv_section_main");
    expect(moduleMenuItemId("picture-gallery", "albums")).toBe("gallery_section_albums");
  });

  it("uses the slug itself when there is no rename", () => {
    expect(moduleMenuItemId("journal", "locations")).toBe("journal_section_locations");
  });

  it("turns hyphens into underscores, as the slot ids are snake throughout", () => {
    expect(moduleMenuItemId("journal", "location-map")).toBe("journal_section_location_map");
    expect(moduleMenuItemId("expense", "meta-data")).toBe("expense_section_meta_data");
  });
});

describe("adminMenuItemId", () => {
  it("derives the registered id for an Administration screen", () => {
    expect(adminMenuItemId("security")).toBe("admin_section_security");
    expect(adminMenuItemId("display-settings-menu-items")).toBe(
      "admin_section_display_settings_menu_items",
    );
  });
});
