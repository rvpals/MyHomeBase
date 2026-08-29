import { describe, expect, it } from "vitest";
import { MODULE_ICON_NAMES } from "@/lib/modules";
import {
  ICON_SLOTS,
  getIconSlot,
  groupedIconSlots,
  isIconSlotId,
  sectionSlotId,
  tabSlotId,
} from "./slots";

describe("ICON_SLOTS", () => {
  it("has no duplicate ids", () => {
    const ids = ICON_SLOTS.map((slot) => slot.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses the documented <area>_<kind>_<name> id shape", () => {
    // The ids are persisted, so a typo shipped once is a typo forever (renaming one
    // orphans a user's upload). Pinning the shape here is cheaper than a migration.
    for (const slot of ICON_SLOTS) {
      expect(slot.id, slot.id).toMatch(/^[a-z0-9]+(_[a-z0-9]+)+$/);
    }
  });

  it("gives every slot a label and a group for the admin list", () => {
    for (const slot of ICON_SLOTS) {
      expect(slot.label.length, slot.id).toBeGreaterThan(0);
      expect(slot.group.length, slot.id).toBeGreaterThan(0);
    }
  });

  it("describes where each icon actually is", () => {
    // `label` alone is ambiguous across groups — five modules have a dashboard section,
    // and two admin entries share the palette glyph — so the click path is what makes a
    // row identifiable. Long enough to be a real sentence, not a repeat of the label.
    for (const slot of ICON_SLOTS) {
      expect(slot.where.length, slot.id).toBeGreaterThan(10);
      expect(slot.where, slot.id).not.toBe(slot.label);
    }
  });

  it("names a default concept that exists in the slot's namespace", () => {
    // The whole safety property of slots rests on this: an un-overridden slot must
    // render exactly what the app showed before. A default naming a concept no glyph
    // table has would render blank.
    for (const slot of ICON_SLOTS) {
      if (slot.namespace === "module") {
        expect(MODULE_ICON_NAMES as readonly string[], slot.id).toContain(slot.defaultConcept);
      } else {
        expect(slot.defaultConcept.length, slot.id).toBeGreaterThan(0);
      }
    }
  });
});

describe("getIconSlot", () => {
  it("finds a registered slot", () => {
    expect(getIconSlot("homescreen_card_daily_quote")?.defaultConcept).toBe("quote");
  });

  it("returns undefined for an unknown id", () => {
    expect(getIconSlot("not_a_real_slot")).toBeUndefined();
  });
});

describe("isIconSlotId", () => {
  it("accepts a registered id and refuses anything else", () => {
    expect(isIconSlotId("homescreen_card_daily_quote")).toBe(true);
    expect(isIconSlotId("homescreen_card_nope")).toBe(false);
    expect(isIconSlotId("")).toBe(false);
  });
});

describe("groupedIconSlots", () => {
  it("buckets slots under their group, in registry order", () => {
    const groups = groupedIconSlots();
    expect(groups.length).toBeGreaterThan(0);
    expect(groups[0].group).toBe("Home screen");
    expect(groups.flatMap((entry) => entry.slots)).toHaveLength(ICON_SLOTS.length);
  });
});

describe("sectionSlotId", () => {
  it("derives the registered id from a namespace and section slug", () => {
    expect(sectionSlotId("expense", "main")).toBe("expense_section_main");
    expect(sectionSlotId("journal", "templates")).toBe("journal_section_templates");
  });

  it("converts kebab slugs to snake, since slot ids are snake throughout", () => {
    // Expense's slugs are the hyphenated ones, and admin's nav ids are all kebab.
    expect(sectionSlotId("expense", "meta-data")).toBe("expense_section_meta_data");
    expect(sectionSlotId("expense", "transaction-rules")).toBe(
      "expense_section_transaction_rules",
    );
    expect(sectionSlotId("admin", "configuration-modules")).toBe(
      "admin_section_configuration_modules",
    );
  });

  it("resolves to a real slot for every section the panel actually renders", () => {
    // The load-bearing test for the whole section-nav batch. `SectionPanel` derives slot
    // ids from data, so a renamed section slug does not throw — it silently stops matching
    // its override. Enumerating the real section lists here is what catches that.
    const sections: Record<string, string[]> = {
      stock: [
        "main", "positions", "transactions", "accounts", "watch-test",
        "charts", "import", "settings",
      ],
      journal: [
        "main", "entries", "calendar", "views", "report",
        "configuration", "templates", "metadata", "configuration-group",
      ],
      expense: [
        "main", "transactions", "meta-data", "charts",
        "import", "transaction-rules", "settings",
      ],
      attendance: ["main", "rosters", "classes", "actions", "report", "configuration"],
      csv: ["main", "configuration"],
      music: ["main", "magic", "player", "queue", "scan", "configuration"],
      admin: [
        "configuration", "configuration-modules", "configuration-application",
        // Under the Display Settings group, but the ids stayed `configuration-*` so
        // existing icon overrides kept matching.
        "display-settings",
        "configuration-themes", "configuration-icons", "configuration-texture",
        "display-settings-widgets",
        "user-management", "daily-quote", "daily-quote-add", "daily-quote-import",
        "security", "background-tasks", "sql-explorer", "about",
      ],
    };

    for (const [namespace, slugs] of Object.entries(sections)) {
      for (const slug of slugs) {
        const id = sectionSlotId(namespace, slug);
        expect(getIconSlot(id), `${namespace}/${slug} -> ${id}`).toBeDefined();
      }
    }
  });
});

describe("tabSlotId", () => {
  it("derives the registered id for every Music Library view tab", () => {
    // Same silent-failure risk as sections: the tab strip renders from
    // LIBRARY_VIEW_ICONS, so a renamed view slug stops matching its override quietly.
    const views = [
      "all-songs", "artists", "genres", "playlists",
      "most-played", "years", "folders", "folder-tree",
    ];
    for (const view of views) {
      const id = tabSlotId("music", view);
      expect(getIconSlot(id), `music/${view} -> ${id}`).toBeDefined();
    }
  });

  it("converts kebab view slugs to snake", () => {
    expect(tabSlotId("music", "all-songs")).toBe("music_tab_all_songs");
    expect(tabSlotId("music", "folder-tree")).toBe("music_tab_folder_tree");
  });
});

describe("wiring", () => {
  it("has every registered slot wired to a call site", () => {
    // The admin list marks an unwired slot "uploads won't show yet". That label must stay
    // truthful: if a slot is added ahead of its call site, this fails until it is wired or
    // the flag is dropped deliberately.
    const unwired = ICON_SLOTS.filter((slot) => !slot.wired).map((slot) => slot.id);
    expect(unwired).toEqual([]);
  });
});
