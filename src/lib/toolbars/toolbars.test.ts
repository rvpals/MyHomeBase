import { describe, expect, it } from "vitest";
import type { MenuItem } from "@/lib/menu-items";
import type { ToolbarItemWrite, ToolbarRepository, ToolbarWrite } from "./ports";
import {
  addToolbarItem,
  createToolbar,
  deleteToolbar,
  occupiedEdges,
  reorderToolbarItems,
  resolveToolbar,
  resolveToolbarsFor,
  updateToolbar,
} from "./toolbars";
import type { ToolbarItem, ToolbarWithItems } from "./types";

function menuItem(id: string, title: string, href: string): MenuItem {
  return {
    id,
    kind: "module-section",
    title,
    defaultTitle: title,
    isOverridden: false,
    moduleSlug: "journal",
    moduleName: "Journal",
    href,
  };
}

const MENU_ITEMS: MenuItem[] = [
  menuItem("journal_section_main", "Home screen", "/modules/journal"),
  menuItem("journal_section_locations", "Location Manager", "/modules/journal/locations"),
];

const KNOWN_IDS = MENU_ITEMS.map((item) => item.id);

function toolbar(overrides: Partial<ToolbarWithItems> = {}): ToolbarWithItems {
  return {
    id: 1,
    name: "Favourites",
    edge: "left",
    fullModeOnly: false,
    isVisible: true,
    sortOrder: 0,
    items: [],
    ...overrides,
  };
}

function item(overrides: Partial<ToolbarItem> & { id: number }): ToolbarItem {
  return {
    toolbarId: 1,
    kind: "menu-item",
    sortOrder: overrides.id,
    ...overrides,
  } as ToolbarItem;
}

/** An in-memory repository, so the use-cases are tested without SQLite. */
function fakeRepo(seed: ToolbarWithItems[] = []): ToolbarRepository {
  const bars = new Map(seed.map((bar) => [bar.id, structuredClone(bar)]));
  let nextToolbarId = Math.max(0, ...seed.map((bar) => bar.id)) + 1;
  let nextItemId = 100;

  return {
    listToolbars: () => [...bars.values()],
    getToolbar: (id) => bars.get(id),
    createToolbar: (write: ToolbarWrite) => {
      const created: ToolbarWithItems = { id: nextToolbarId++, sortOrder: 0, items: [], ...write };
      bars.set(created.id, created);
      return created;
    },
    updateToolbar: (id, write) => {
      const existing = bars.get(id);
      if (existing) bars.set(id, { ...existing, ...write });
    },
    deleteToolbar: (id) => void bars.delete(id),
    addItem: (toolbarId, write: ToolbarItemWrite) => {
      const bar = bars.get(toolbarId)!;
      const created: ToolbarItem = {
        id: nextItemId++,
        toolbarId,
        sortOrder: bar.items.length,
        ...write,
      };
      bar.items.push(created);
      return created;
    },
    updateItem: () => undefined,
    removeItem: () => undefined,
    setItemOrder: (toolbarId, itemIds) => {
      const bar = bars.get(toolbarId)!;
      bar.items = itemIds.map((id, index) => ({
        ...bar.items.find((candidate) => candidate.id === id)!,
        sortOrder: index,
      }));
    },
  };
}

const VISIBLE = { isCompact: false, hiddenIds: [] as number[] };

describe("resolveToolbar", () => {
  it("resolves a menu item row to its destination and current title", () => {
    const resolved = resolveToolbar(
      toolbar({ items: [item({ id: 1, menuItemId: "journal_section_locations" })] }),
      MENU_ITEMS,
      VISIBLE,
    );

    expect(resolved?.items).toEqual([
      {
        id: 1,
        kind: "menu-item",
        label: "Location Manager",
        href: "/modules/journal/locations",
        icon: undefined,
        menuItemId: "journal_section_locations",
      },
    ]);
  });

  it("prefers the row's own label over the menu item's title", () => {
    const resolved = resolveToolbar(
      toolbar({ items: [item({ id: 1, menuItemId: "journal_section_main", label: "Jump" })] }),
      MENU_ITEMS,
      VISIBLE,
    );

    expect(resolved?.items[0].label).toBe("Jump");
  });

  it("picks up an administrator's rename when the row has no label of its own", () => {
    const renamed = [{ ...MENU_ITEMS[1], title: "My Places", isOverridden: true }];

    const resolved = resolveToolbar(
      toolbar({ items: [item({ id: 1, menuItemId: "journal_section_locations" })] }),
      renamed,
      VISIBLE,
    );

    expect(resolved?.items[0].label).toBe("My Places");
  });

  it("drops a row whose menu item no longer exists, rather than rendering a dead link", () => {
    const resolved = resolveToolbar(
      toolbar({
        items: [
          item({ id: 1, menuItemId: "journal_section_main" }),
          item({ id: 2, menuItemId: "journal_section_deleted" }),
        ],
      }),
      MENU_ITEMS,
      VISIBLE,
    );

    expect(resolved?.items.map((row) => row.id)).toEqual([1]);
  });

  it("is undefined when the administrator has hidden the toolbar", () => {
    expect(
      resolveToolbar(
        toolbar({ isVisible: false, items: [item({ id: 1, menuItemId: "journal_section_main" })] }),
        MENU_ITEMS,
        VISIBLE,
      ),
    ).toBeUndefined();
  });

  it("is undefined when this reader has hidden it, though others still see it", () => {
    const bar = toolbar({ items: [item({ id: 1, menuItemId: "journal_section_main" })] });

    expect(resolveToolbar(bar, MENU_ITEMS, { isCompact: false, hiddenIds: [1] })).toBeUndefined();
    expect(resolveToolbar(bar, MENU_ITEMS, VISIBLE)).toBeDefined();
  });

  it("is undefined on a compact layout when it is marked full-mode only", () => {
    const bar = toolbar({
      fullModeOnly: true,
      items: [item({ id: 1, menuItemId: "journal_section_main" })],
    });

    expect(resolveToolbar(bar, MENU_ITEMS, { isCompact: true, hiddenIds: [] })).toBeUndefined();
    expect(resolveToolbar(bar, MENU_ITEMS, VISIBLE)).toBeDefined();
  });

  it("is undefined when nothing actionable is left, so no empty stripe is drawn", () => {
    const resolved = resolveToolbar(
      toolbar({
        items: [
          item({ id: 2, kind: "separator", menuItemId: undefined }),
          // The only real destination is stale, so the bar has nothing to offer.
          item({ id: 3, menuItemId: "journal_section_deleted" }),
        ],
      }),
      MENU_ITEMS,
      VISIBLE,
    );

    expect(resolved).toBeUndefined();
  });

  it("keeps separators and spacers that sit between real items", () => {
    const resolved = resolveToolbar(
      toolbar({
        items: [
          item({ id: 2, menuItemId: "journal_section_main" }),
          item({ id: 3, kind: "separator", menuItemId: undefined }),
          item({ id: 4, menuItemId: "journal_section_locations" }),
          item({ id: 5, kind: "spacer", menuItemId: undefined }),
          item({ id: 6, menuItemId: "journal_section_main" }),
        ],
      }),
      MENU_ITEMS,
      VISIBLE,
    );

    expect(resolved?.items.map((row) => row.kind)).toEqual([
      "menu-item",
      "separator",
      "menu-item",
      "spacer",
      "menu-item",
    ]);
  });

  it("trims ornament stranded at either end, both kinds", () => {
    const resolved = resolveToolbar(
      toolbar({
        items: [
          item({ id: 1, kind: "separator", menuItemId: undefined }),
          item({ id: 2, menuItemId: "journal_section_main" }),
          item({ id: 3, kind: "spacer", menuItemId: undefined }),
        ],
      }),
      MENU_ITEMS,
      VISIBLE,
    );

    expect(resolved?.items.map((row) => row.kind)).toEqual(["menu-item"]);
  });

  it("collapses a run of separators left behind by a deleted item", () => {
    const resolved = resolveToolbar(
      toolbar({
        items: [
          item({ id: 1, menuItemId: "journal_section_main" }),
          item({ id: 2, kind: "separator", menuItemId: undefined }),
          item({ id: 3, kind: "separator", menuItemId: undefined }),
          item({ id: 4, menuItemId: "journal_section_locations" }),
        ],
      }),
      MENU_ITEMS,
      VISIBLE,
    );

    expect(resolved?.items.map((row) => row.kind)).toEqual([
      "menu-item",
      "separator",
      "menu-item",
    ]);
  });

  it("collapses a run of spacers the same way", () => {
    const resolved = resolveToolbar(
      toolbar({
        items: [
          item({ id: 1, menuItemId: "journal_section_main" }),
          item({ id: 2, kind: "spacer", menuItemId: undefined }),
          item({ id: 3, kind: "spacer", menuItemId: undefined }),
          item({ id: 4, menuItemId: "journal_section_locations" }),
        ],
      }),
      MENU_ITEMS,
      VISIBLE,
    );

    expect(resolved?.items.map((row) => row.kind)).toEqual([
      "menu-item",
      "spacer",
      "menu-item",
    ]);
  });

  it("does NOT merge a separator next to a spacer — that pairing is deliberate", () => {
    // "Divide here, then push the rest to the far end" is a real arrangement, and
    // collapsing the pair would silently change a layout an admin built.
    const resolved = resolveToolbar(
      toolbar({
        items: [
          item({ id: 1, menuItemId: "journal_section_main" }),
          item({ id: 2, kind: "separator", menuItemId: undefined }),
          item({ id: 3, kind: "spacer", menuItemId: undefined }),
          item({ id: 4, menuItemId: "journal_section_locations" }),
        ],
      }),
      MENU_ITEMS,
      VISIBLE,
    );

    expect(resolved?.items.map((row) => row.kind)).toEqual([
      "menu-item",
      "separator",
      "spacer",
      "menu-item",
    ]);
  });

  it("is undefined when only ornament is left", () => {
    const resolved = resolveToolbar(
      toolbar({
        items: [
          item({ id: 2, kind: "separator", menuItemId: undefined }),
          item({ id: 3, kind: "spacer", menuItemId: undefined }),
        ],
      }),
      MENU_ITEMS,
      VISIBLE,
    );

    expect(resolved).toBeUndefined();
  });
});

describe("resolveToolbarsFor", () => {
  it("returns only the bars this reader should see", () => {
    const bars = [
      toolbar({ id: 1, items: [item({ id: 1, menuItemId: "journal_section_main" })] }),
      toolbar({ id: 2, isVisible: false, items: [item({ id: 2, menuItemId: "journal_section_main" })] }),
      toolbar({ id: 3, items: [item({ id: 3, menuItemId: "journal_section_main" })] }),
    ];

    const resolved = resolveToolbarsFor(bars, MENU_ITEMS, { isCompact: false, hiddenIds: [3] });

    expect(resolved.map((bar) => bar.id)).toEqual([1]);
  });
});

describe("occupiedEdges", () => {
  it("reports each occupied edge once, so the shell reserves it once", () => {
    const bars = [
      toolbar({ id: 1, edge: "left", items: [item({ id: 1, menuItemId: "journal_section_main" })] }),
      toolbar({ id: 2, edge: "left", items: [item({ id: 2, menuItemId: "journal_section_main" })] }),
      toolbar({ id: 3, edge: "top", items: [item({ id: 3, menuItemId: "journal_section_main" })] }),
    ];
    const resolved = resolveToolbarsFor(bars, MENU_ITEMS, VISIBLE);

    expect(occupiedEdges(resolved).sort()).toEqual(["left", "top"]);
  });
});

describe("createToolbar", () => {
  it("creates one from valid input", () => {
    const repo = fakeRepo();

    const created = createToolbar(repo, {
      name: "Favourites",
      edge: "left",
      fullModeOnly: false,
      isVisible: true,
      backgroundColor: "#2f6f4f",
    });

    expect(created.name).toBe("Favourites");
    expect(created.backgroundColor).toBe("#2f6f4f");
  });

  it("rejects a nameless toolbar", () => {
    expect(() =>
      createToolbar(fakeRepo(), {
        name: "   ",
        edge: "left",
        fullModeOnly: false,
        isVisible: true,
      }),
    ).toThrow();
  });

  it("rejects an edge that is not one of the four", () => {
    expect(() =>
      createToolbar(fakeRepo(), {
        name: "Nope",
        edge: "diagonal" as never,
        fullModeOnly: false,
        isVisible: true,
      }),
    ).toThrow();
  });

  it("rejects a colour that is not a hex or rgb()/hsl() value", () => {
    // The value is interpolated into an inline style, so `url(...)` must not pass.
    expect(() =>
      createToolbar(fakeRepo(), {
        name: "Sneaky",
        edge: "top",
        fullModeOnly: false,
        isVisible: true,
        backgroundColor: "url(https://example.com/x.png)",
      }),
    ).toThrow();
  });

  it("treats a blank colour as no colour, which means inherit the theme", () => {
    const created = createToolbar(fakeRepo(), {
      name: "Plain",
      edge: "top",
      fullModeOnly: false,
      isVisible: true,
      backgroundColor: "",
    });

    expect(created.backgroundColor).toBeUndefined();
  });
});

describe("updateToolbar", () => {
  it("rejects an id that does not exist", () => {
    expect(() =>
      updateToolbar(fakeRepo(), 99, {
        name: "Ghost",
        edge: "top",
        fullModeOnly: false,
        isVisible: true,
      }),
    ).toThrow(/no toolbar/i);
  });
});

describe("deleteToolbar", () => {
  it("rejects an id that does not exist", () => {
    expect(() => deleteToolbar(fakeRepo(), 99)).toThrow(/no toolbar/i);
  });
});

describe("addToolbarItem", () => {
  it("appends a menu item row", () => {
    const repo = fakeRepo([toolbar()]);

    const added = addToolbarItem(
      repo,
      1,
      { kind: "menu-item", menuItemId: "journal_section_main" },
      KNOWN_IDS,
    );

    expect(added.menuItemId).toBe("journal_section_main");
  });

  it("rejects a menu item row pointing at nothing", () => {
    expect(() =>
      addToolbarItem(fakeRepo([toolbar()]), 1, { kind: "menu-item" }, KNOWN_IDS),
    ).toThrow();
  });

  it("rejects a menu item id the registry does not know", () => {
    expect(() =>
      addToolbarItem(
        fakeRepo([toolbar()]),
        1,
        { kind: "menu-item", menuItemId: "journal_section_invented" },
        KNOWN_IDS,
      ),
    ).toThrow(/no menu item/i);
  });

  it("rejects the removed `heading` kind outright", () => {
    // Migration 0127 withdrew it: a text label cannot fit a 44px bar of glyphs.
    // Asserted so a reintroduction has to be deliberate rather than accidental.
    expect(() =>
      addToolbarItem(
        fakeRepo([toolbar()]),
        1,
        { kind: "heading" as never, label: "My favourites" },
        KNOWN_IDS,
      ),
    ).toThrow();
  });

  it("rejects a separator carrying a label", () => {
    expect(() =>
      addToolbarItem(
        fakeRepo([toolbar()]),
        1,
        { kind: "separator", label: "why" },
        KNOWN_IDS,
      ),
    ).toThrow(/separator carries no label/i);
  });

  it("rejects a spacer carrying a label", () => {
    expect(() =>
      addToolbarItem(fakeRepo([toolbar()]), 1, { kind: "spacer", label: "why" }, KNOWN_IDS),
    ).toThrow(/spacer carries no label/i);
  });

  it("rejects ornament carrying a destination", () => {
    for (const kind of ["separator", "spacer"] as const) {
      expect(() =>
        addToolbarItem(
          fakeRepo([toolbar()]),
          1,
          { kind, menuItemId: "journal_section_main" },
          KNOWN_IDS,
        ),
        kind,
      ).toThrow();
    }
  });

  it("accepts a bare separator and a bare spacer", () => {
    const repo = fakeRepo([toolbar()]);

    expect(() => addToolbarItem(repo, 1, { kind: "separator" }, KNOWN_IDS)).not.toThrow();
    expect(() => addToolbarItem(repo, 1, { kind: "spacer" }, KNOWN_IDS)).not.toThrow();
  });

  it("accepts a shortcut with a nickname, which becomes its tooltip", () => {
    const repo = fakeRepo([toolbar()]);

    const added = addToolbarItem(
      repo,
      1,
      { kind: "menu-item", menuItemId: "journal_section_main", label: "Jump" },
      KNOWN_IDS,
    );

    expect(added.label).toBe("Jump");
  });

  it("rejects adding to a toolbar that does not exist", () => {
    expect(() =>
      addToolbarItem(
        fakeRepo(),
        99,
        { kind: "menu-item", menuItemId: "journal_section_main" },
        KNOWN_IDS,
      ),
    ).toThrow(/no toolbar/i);
  });
});

describe("reorderToolbarItems", () => {
  it("rewrites the order", () => {
    const repo = fakeRepo([
      toolbar({
        items: [
          item({ id: 1, menuItemId: "journal_section_main" }),
          item({ id: 2, menuItemId: "journal_section_locations" }),
        ],
      }),
    ]);

    reorderToolbarItems(repo, 1, [2, 1]);

    expect(repo.getToolbar(1)?.items.map((row) => row.id)).toEqual([2, 1]);
  });

  it("rejects a partial order, which would silently strand the omitted rows", () => {
    const repo = fakeRepo([
      toolbar({
        items: [
          item({ id: 1, menuItemId: "journal_section_main" }),
          item({ id: 2, menuItemId: "journal_section_locations" }),
        ],
      }),
    ]);

    expect(() => reorderToolbarItems(repo, 1, [1])).toThrow(/exactly/i);
  });

  it("rejects an id belonging to another toolbar", () => {
    const repo = fakeRepo([
      toolbar({ id: 1, items: [item({ id: 1, menuItemId: "journal_section_main" })] }),
      toolbar({ id: 2, items: [item({ id: 2, toolbarId: 2, menuItemId: "journal_section_main" })] }),
    ]);

    expect(() => reorderToolbarItems(repo, 1, [2])).toThrow(/exactly/i);
  });

  it("rejects a repeated id", () => {
    const repo = fakeRepo([
      toolbar({
        items: [
          item({ id: 1, menuItemId: "journal_section_main" }),
          item({ id: 2, menuItemId: "journal_section_locations" }),
        ],
      }),
    ]);

    expect(() => reorderToolbarItems(repo, 1, [1, 1])).toThrow(/repeats/i);
  });
});
