import { describe, expect, it } from "vitest";
import type { UserPreference } from "@/lib/user-preferences";
import {
  JOURNAL_HOME_WIDGETS_KEY,
  JOURNAL_HOME_WIDGET_IDS,
  defaultJournalHomeWidgets,
  getJournalHomeWidgets,
  journalHomeWidgetsToValue,
  moveJournalHomeWidget,
  reorderJournalHomeWidget,
  resolveJournalHomeWidgets,
  saveJournalHomeWidgets,
  toggleJournalHomeWidget,
  visibleJournalHomeWidgets,
} from "./home-widgets";

function fakeRepo(initial: UserPreference[] = []) {
  const rows = [...initial];
  return {
    rows,
    listByUserId: (userId: number) => rows.filter((row) => row.userId === userId),
    setValue(userId: number, key: string, value: string) {
      const existing = rows.find((row) => row.userId === userId && row.key === key);
      if (existing) existing.value = value;
      else rows.push({ id: rows.length + 1, userId, key, value });
    },
    deleteForUser: () => undefined,
  };
}

describe("resolveJournalHomeWidgets", () => {
  it("defaults to everything visible in catalogue order", () => {
    expect(resolveJournalHomeWidgets(undefined)).toEqual(defaultJournalHomeWidgets());
    expect(resolveJournalHomeWidgets("  ")).toEqual(defaultJournalHomeWidgets());
  });

  it("reads order and the hidden prefix", () => {
    const resolved = resolveJournalHomeWidgets("recentEntries,-topWords,counters");
    expect(resolved.slice(0, 3)).toEqual([
      { id: "recentEntries", visible: true },
      { id: "topWords", visible: false },
      { id: "counters", visible: true },
    ]);
    expect(resolved).toHaveLength(JOURNAL_HOME_WIDGET_IDS.length);
  });

  it("drops unknown and duplicate ids, and falls back when nothing is left", () => {
    expect(resolveJournalHomeWidgets("bogus,counters,counters")[0]).toEqual({
      id: "counters",
      visible: true,
    });
    expect(resolveJournalHomeWidgets("bogus")).toEqual(defaultJournalHomeWidgets());
  });

  it("inserts a card missing from the stored value before its catalogue successor", () => {
    const resolved = resolveJournalHomeWidgets("recentEntries,counters");
    const ids = resolved.map((widget) => widget.id);
    expect(ids.indexOf("topTaxonomy")).toBeLessThan(ids.indexOf("recentEntries"));
    expect(resolved.find((widget) => widget.id === "topTaxonomy")?.visible).toBe(true);
  });
});

describe("Pinned & Recently Edited", () => {
  it("replaced the separate Pinned Entries card, and sits above Recent entries", () => {
    const ids = JOURNAL_HOME_WIDGET_IDS as readonly string[];
    expect(ids).toContain("pinnedAndRecentlyEdited");
    expect(ids).not.toContain("pinnedEntries");
    expect(ids.indexOf("pinnedAndRecentlyEdited")).toBeLessThan(ids.indexOf("recentEntries"));
  });

  it("drops the retired pinnedEntries id and shows the combined card instead", () => {
    // A layout saved while Pinned Entries was its own card. The retired id is dropped
    // and `pinnedAndRecentlyEdited` is inserted at its catalogue position, visible —
    // which is why combining the two shipped without a migration, exactly as the
    // topTaxonomy merge did.
    const resolved = resolveJournalHomeWidgets(
      "counters,topTaxonomy,topWords,countByYears,pinnedEntries,recentEntries",
    );
    const ids = resolved.map((widget) => widget.id) as string[];

    expect(ids).not.toContain("pinnedEntries");
    expect(resolved.find((widget) => widget.id === "pinnedAndRecentlyEdited")).toEqual({
      id: "pinnedAndRecentlyEdited",
      visible: true,
    });
    expect(resolved).toHaveLength(JOURNAL_HOME_WIDGET_IDS.length);
  });

  it("lands in place rather than appended, for a layout saved before it shipped", () => {
    // The stored value a reader who reordered their cards would read back. The
    // combined card must arrive immediately above Recent entries, not at the bottom.
    const resolved = resolveJournalHomeWidgets(
      "counters,topTags,topCategories,topWords,countByYears,recentEntries",
    );

    expect(resolved).toHaveLength(JOURNAL_HOME_WIDGET_IDS.length);

    const ids = resolved.map((widget) => widget.id);
    expect(ids.indexOf("pinnedAndRecentlyEdited")).toBe(ids.indexOf("recentEntries") - 1);
  });

  it("shows the combined card even to someone who had hidden Pinned Entries", () => {
    // The same deliberate consequence the topTaxonomy merge has: hiding a retired id
    // cannot carry over, because the card it referred to no longer exists. Pinned up
    // to now meant "pinned only", so inheriting that switch would hide a card that is
    // half new anyway.
    const resolved = resolveJournalHomeWidgets("counters,-pinnedEntries,recentEntries");

    expect(resolved.find((widget) => widget.id === "pinnedAndRecentlyEdited")?.visible).toBe(
      true,
    );
  });
});

describe("Top Tags & Categories", () => {
  it("replaced the two separate cards", () => {
    const ids = JOURNAL_HOME_WIDGET_IDS as readonly string[];
    expect(ids).toContain("topTaxonomy");
    expect(ids).not.toContain("topTags");
    expect(ids).not.toContain("topCategories");
  });

  it("drops the retired ids and shows the combined card instead", () => {
    // A layout saved while Top Tags and Top Categories were separate cards. The two
    // retired ids are dropped and `topTaxonomy` is inserted at its catalogue position,
    // visible — which is why combining them shipped without a migration.
    const resolved = resolveJournalHomeWidgets(
      "counters,topTags,topCategories,topWords,countByYears,recentEntries",
    );
    const ids = resolved.map((widget) => widget.id) as string[];

    expect(ids).not.toContain("topTags");
    expect(ids).not.toContain("topCategories");
    expect(resolved.find((widget) => widget.id === "topTaxonomy")).toEqual({
      id: "topTaxonomy",
      visible: true,
    });
    expect(resolved).toHaveLength(JOURNAL_HOME_WIDGET_IDS.length);
  });

  it("shows the combined card even to someone who had hidden one of the two", () => {
    // A deliberate consequence worth pinning down: hiding `topCategories` cannot carry
    // over, because the card it referred to no longer exists. The combined card
    // arrives visible rather than inheriting either old switch.
    const resolved = resolveJournalHomeWidgets("counters,topTags,-topCategories,recentEntries");

    expect(resolved.find((widget) => widget.id === "topTaxonomy")?.visible).toBe(true);
  });
});

describe("move and toggle", () => {
  it("moves one place and does not wrap", () => {
    const widgets = defaultJournalHomeWidgets();
    expect(moveJournalHomeWidget(widgets, "topTaxonomy", "up")[0].id).toBe("topTaxonomy");
    expect(moveJournalHomeWidget(widgets, "counters", "up")).toBe(widgets);
    const last = JOURNAL_HOME_WIDGET_IDS[JOURNAL_HOME_WIDGET_IDS.length - 1];
    expect(moveJournalHomeWidget(widgets, last, "down")).toBe(widgets);
  });

  it("reorders a card onto another's position", () => {
    const widgets = defaultJournalHomeWidgets();
    const ids = (list: typeof widgets) => list.map((widget) => widget.id);

    expect(ids(reorderJournalHomeWidget(widgets, "recentEntries", "counters"))[0]).toBe(
      "recentEntries",
    );
    expect(ids(reorderJournalHomeWidget(widgets, "counters", "topTaxonomy"))).toEqual([
      "topTaxonomy",
      "counters",
      ...ids(widgets).slice(2),
    ]);
    expect(reorderJournalHomeWidget(widgets, "counters", "counters")).toBe(widgets);
    expect(reorderJournalHomeWidget(widgets, "counters", "nope" as never)).toBe(widgets);
  });

  it("toggles visibility without mutating", () => {
    const widgets = defaultJournalHomeWidgets();
    const next = toggleJournalHomeWidget(widgets, "topWords");
    expect(next.find((widget) => widget.id === "topWords")?.visible).toBe(false);
    expect(widgets.every((widget) => widget.visible)).toBe(true);
    expect(visibleJournalHomeWidgets(next)).not.toContain("topWords");
  });
});

describe("storage", () => {
  it("round-trips through the stored value", () => {
    const widgets = toggleJournalHomeWidget(
      moveJournalHomeWidget(defaultJournalHomeWidgets(), "recentEntries", "up"),
      "counters",
    );
    expect(resolveJournalHomeWidgets(journalHomeWidgetsToValue(widgets))).toEqual(widgets);
  });

  it("rejects a partial or duplicated list", () => {
    expect(() => journalHomeWidgetsToValue(defaultJournalHomeWidgets().slice(1))).toThrow();
    const duplicated = defaultJournalHomeWidgets();
    duplicated[1] = duplicated[0];
    expect(() => journalHomeWidgetsToValue(duplicated)).toThrow();
  });

  it("saves and reads per user", () => {
    const repo = fakeRepo();
    const mine = toggleJournalHomeWidget(defaultJournalHomeWidgets(), "topTaxonomy");
    saveJournalHomeWidgets(repo, 1, mine);

    expect(repo.rows[0].key).toBe(JOURNAL_HOME_WIDGETS_KEY);
    expect(getJournalHomeWidgets(repo, 1)).toEqual(mine);
    expect(getJournalHomeWidgets(repo, 2)).toEqual(defaultJournalHomeWidgets());
  });
});
