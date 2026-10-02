import { describe, expect, it } from "vitest";
import {
  clearMenuItemOverride,
  listMenuItemModules,
  listMenuItems,
  listMenuItemsForModule,
  overriddenTitles,
  resolveMenuItem,
  setMenuItemOverride,
} from "./menu-items";
import type { MenuItemOverrideRepository, MenuItemSeed, MenuItemSource } from "./ports";
import type { MenuItemOverride } from "./types";

const SEEDS: MenuItemSeed[] = [
  {
    id: "home",
    kind: "home",
    defaultTitle: "Home",
    defaultHint: "The dashboard you land on.",
    moduleName: "Home",
    href: "/?home=1",
    icon: "home",
  },
  {
    id: "journal_section_main",
    kind: "module-section",
    defaultTitle: "Home screen",
    defaultHint: "Today in history, recent entries, and quick actions.",
    moduleSlug: "journal",
    moduleName: "Journal",
    href: "/modules/journal",
    icon: "grid",
  },
  {
    id: "journal_section_locations",
    kind: "module-section",
    defaultTitle: "Location Manager",
    defaultHint: "Saved places you can pick from when writing an entry.",
    moduleSlug: "journal",
    moduleName: "Journal",
    href: "/modules/journal/locations",
    group: "Locations",
    icon: "pin",
  },
  {
    id: "tree_section_security",
    kind: "admin",
    defaultTitle: "Security",
    defaultHint: "Sign-in history and failed login attempts.",
    moduleSlug: "admin",
    moduleName: "Administration",
    href: "/admin/security",
    icon: "shield",
  },
];

function fakeSource(seeds: MenuItemSeed[] = SEEDS): MenuItemSource {
  return { listSeeds: () => seeds };
}

function fakeRepo(seed: MenuItemOverride[] = []): MenuItemOverrideRepository {
  const rows = new Map(seed.map((row) => [row.menuItemId, row]));
  return {
    listAll: () => [...rows.values()],
    get: (id) => rows.get(id),
    upsert: (override) => void rows.set(override.menuItemId, override),
    remove: (id) => void rows.delete(id),
  };
}

const AT = () => new Date("2026-10-01T12:00:00.000Z");

describe("listMenuItems", () => {
  it("returns every seed in source order, with registry defaults when nothing is overridden", () => {
    const items = listMenuItems(fakeSource(), fakeRepo());

    expect(items.map((item) => item.id)).toEqual([
      "home",
      "journal_section_main",
      "journal_section_locations",
      "tree_section_security",
    ]);
    expect(items[2].title).toBe("Location Manager");
    expect(items[2].isOverridden).toBe(false);
  });

  it("applies an override to the title and flags the item", () => {
    const repo = fakeRepo([
      { menuItemId: "journal_section_locations", title: "My Places", updatedAt: "2026-10-01" },
    ]);

    const item = listMenuItems(fakeSource(), repo).find(
      (candidate) => candidate.id === "journal_section_locations",
    );

    expect(item?.title).toBe("My Places");
    expect(item?.isOverridden).toBe(true);
    // The default survives alongside it, so the admin screen can offer a revert.
    expect(item?.defaultTitle).toBe("Location Manager");
    // An untouched hint still reads from the registry.
    expect(item?.hint).toBe("Saved places you can pick from when writing an entry.");
  });

  it("ignores an override whose menu item no longer exists", () => {
    const repo = fakeRepo([
      { menuItemId: "journal_section_retired", title: "Ghost", updatedAt: "2026-10-01" },
    ]);

    const items = listMenuItems(fakeSource(), repo);

    expect(items).toHaveLength(SEEDS.length);
    expect(items.some((item) => item.title === "Ghost")).toBe(false);
  });

  it("treats a blank override title as no override, so no item is ever nameless", () => {
    const repo = fakeRepo([
      { menuItemId: "journal_section_locations", title: "   ", updatedAt: "2026-10-01" },
    ]);

    const item = listMenuItems(fakeSource(), repo).find(
      (candidate) => candidate.id === "journal_section_locations",
    );

    expect(item?.title).toBe("Location Manager");
    expect(item?.isOverridden).toBe(false);
  });

  it("lets a hint be cleared to nothing, unlike a title", () => {
    const repo = fakeRepo([
      { menuItemId: "journal_section_locations", hint: "", updatedAt: "2026-10-01" },
    ]);

    const item = listMenuItems(fakeSource(), repo).find(
      (candidate) => candidate.id === "journal_section_locations",
    );

    expect(item?.hint).toBeUndefined();
    expect(item?.isOverridden).toBe(true);
  });

  it("drops a duplicate id, keeping the first", () => {
    const withDuplicate: MenuItemSeed[] = [
      ...SEEDS,
      { ...SEEDS[1], defaultTitle: "Impostor" },
    ];

    const items = listMenuItems(fakeSource(withDuplicate), fakeRepo());

    expect(items).toHaveLength(SEEDS.length);
    expect(items[1].title).toBe("Home screen");
  });

  it("has no duplicate ids in a catalogue, which is what makes an id addressable", () => {
    const ids = listMenuItems(fakeSource(), fakeRepo()).map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("resolveMenuItem", () => {
  it("finds one item by id", () => {
    const item = resolveMenuItem(fakeSource(), fakeRepo(), "tree_section_security");
    expect(item?.title).toBe("Security");
  });

  it("returns undefined for an id nothing declares, rather than throwing", () => {
    // The common caller is a stored toolbar row pointing at a removed section.
    expect(resolveMenuItem(fakeSource(), fakeRepo(), "nope_section_gone")).toBeUndefined();
  });
});

describe("listMenuItemsForModule", () => {
  it("returns only that module's items", () => {
    const items = listMenuItemsForModule(fakeSource(), fakeRepo(), "journal");
    expect(items.map((item) => item.id)).toEqual([
      "journal_section_main",
      "journal_section_locations",
    ]);
  });

  it("returns nothing for a module with no items, rather than throwing", () => {
    expect(listMenuItemsForModule(fakeSource(), fakeRepo(), "unbuilt")).toEqual([]);
  });

  it("does not include Home, which belongs to no module", () => {
    const everyModuleItem = listMenuItemModules(fakeSource(), fakeRepo()).flatMap((group) =>
      listMenuItemsForModule(fakeSource(), fakeRepo(), group.slug),
    );
    expect(everyModuleItem.some((item) => item.id === "home")).toBe(false);
  });
});

describe("listMenuItemModules", () => {
  it("groups items by owning module, in navigation order, with counts", () => {
    expect(listMenuItemModules(fakeSource(), fakeRepo())).toEqual([
      { slug: "journal", name: "Journal", count: 2 },
      { slug: "admin", name: "Administration", count: 1 },
    ]);
  });
});

describe("overriddenTitles", () => {
  it("is empty when nothing has been renamed", () => {
    expect(overriddenTitles(fakeSource(), fakeRepo())).toEqual({});
  });

  it("maps id to title for renamed items only", () => {
    const repo = fakeRepo([
      { menuItemId: "journal_section_locations", title: "My Places", updatedAt: "2026-10-01" },
      // A hint-only override is not a rename, so it must not appear here.
      { menuItemId: "tree_section_security", hint: "Who signed in.", updatedAt: "2026-10-01" },
    ]);

    expect(overriddenTitles(fakeSource(), repo)).toEqual({
      journal_section_locations: "My Places",
    });
  });
});

describe("setMenuItemOverride", () => {
  it("stores a new title and returns the resolved item", () => {
    const repo = fakeRepo();

    const item = setMenuItemOverride(
      fakeSource(),
      repo,
      { menuItemId: "journal_section_locations", title: "My Places" },
      AT,
    );

    expect(item.title).toBe("My Places");
    expect(item.isOverridden).toBe(true);
    expect(repo.get("journal_section_locations")).toEqual({
      menuItemId: "journal_section_locations",
      title: "My Places",
      hint: undefined,
      updatedAt: "2026-10-01T12:00:00.000Z",
    });
  });

  it("rejects an id that names no menu item, so no orphan row is written", () => {
    const repo = fakeRepo();

    expect(() =>
      setMenuItemOverride(fakeSource(), repo, { menuItemId: "not_a_real_item", title: "X" }, AT),
    ).toThrow(/no menu item/i);
    expect(repo.listAll()).toEqual([]);
  });

  it("rejects a title longer than the cap", () => {
    expect(() =>
      setMenuItemOverride(
        fakeSource(),
        fakeRepo(),
        { menuItemId: "journal_section_locations", title: "x".repeat(61) },
        AT,
      ),
    ).toThrow();
  });

  it("rejects a malformed id before it reaches the registry", () => {
    expect(() =>
      setMenuItemOverride(fakeSource(), fakeRepo(), { menuItemId: "Not-Snake-Case", title: "X" }, AT),
    ).toThrow();
  });

  it("removes the row when the values match the defaults, so 'overridden' stays honest", () => {
    const repo = fakeRepo([
      { menuItemId: "journal_section_locations", title: "My Places", updatedAt: "2026-09-01" },
    ]);

    const item = setMenuItemOverride(
      fakeSource(),
      repo,
      {
        menuItemId: "journal_section_locations",
        title: "Location Manager",
        hint: "Saved places you can pick from when writing an entry.",
      },
      AT,
    );

    expect(item.isOverridden).toBe(false);
    expect(repo.get("journal_section_locations")).toBeUndefined();
  });

  it("treats a cleared title as a reset rather than storing a blank one", () => {
    const repo = fakeRepo([
      { menuItemId: "journal_section_locations", title: "My Places", updatedAt: "2026-09-01" },
    ]);

    const item = setMenuItemOverride(
      fakeSource(),
      repo,
      { menuItemId: "journal_section_locations", title: "" },
      AT,
    );

    expect(item.title).toBe("Location Manager");
    expect(repo.get("journal_section_locations")).toBeUndefined();
  });
});

describe("clearMenuItemOverride", () => {
  it("restores the registry's title and hint", () => {
    const repo = fakeRepo([
      { menuItemId: "journal_section_locations", title: "My Places", updatedAt: "2026-09-01" },
    ]);

    const item = clearMenuItemOverride(fakeSource(), repo, "journal_section_locations");

    expect(item.title).toBe("Location Manager");
    expect(item.isOverridden).toBe(false);
    expect(repo.get("journal_section_locations")).toBeUndefined();
  });

  it("is idempotent when there is nothing to clear", () => {
    const repo = fakeRepo();
    expect(() => clearMenuItemOverride(fakeSource(), repo, "journal_section_main")).not.toThrow();
  });

  it("rejects an id that names no menu item", () => {
    expect(() => clearMenuItemOverride(fakeSource(), fakeRepo(), "not_a_real_item")).toThrow(
      /no menu item/i,
    );
  });
});
