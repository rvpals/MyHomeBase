import { describe, expect, it } from "vitest";
import { filterTree, groupHitsByModule } from "./filter";
import type { SectionSource } from "./ports";
import { buildNavigationTree, type NavigationModuleInput } from "./tree";
import type { TreeSection } from "./types";

const MODULES: NavigationModuleInput[] = [
  { slug: "journal", shortName: "Journal", icon: "journal" },
  { slug: "investments", shortName: "Investments", icon: "chart" },
  { slug: "expense", shortName: "Expense", icon: "wallet" },
];

const SECTIONS: SectionSource = {
  sectionsFor: (slug) =>
    (
      ({
        journal: [
          { id: "calendar", label: "Calendar", href: "/modules/journal/calendar" },
          { id: "import", label: "CSV Import", href: "/modules/journal/import" },
        ],
        investments: [
          { id: "import", label: "CSV Import", href: "/modules/investments/import" },
          { id: "chart", label: "Chart & Analysis", href: "/modules/investments/chart" },
        ],
        expense: [
          { id: "import", label: "Import Transaction", href: "/modules/expense/import" },
        ],
      }) as Record<string, TreeSection[]>
    )[slug] ?? [],
};

const tree = buildNavigationTree(MODULES, SECTIONS);

describe("filterTree", () => {
  it("matches across every module, not just the current one", () => {
    const hits = filterTree(tree, "import");

    // Three modules have an importing section; all three come back.
    expect(hits.map((h) => h.module.slug)).toEqual(
      expect.arrayContaining(["journal", "investments", "expense"]),
    );
    expect(hits).toHaveLength(3);
  });

  it("ranks a prefix match above a mid-label match", () => {
    // "Import Transaction" starts with the query; "CSV Import" merely contains it.
    const hits = filterTree(tree, "import");
    expect(hits[0].section.label).toBe("Import Transaction");
    expect(hits[0].matchIndex).toBe(0);
  });

  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(filterTree(tree, "  CALENDAR  ")).toHaveLength(1);
    expect(filterTree(tree, "calendar")[0].section.id).toBe("calendar");
  });

  it("returns every section of a module whose name matches", () => {
    const hits = filterTree(tree, "investments");

    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.module.slug === "investments")).toBe(true);
    // -1 marks a module-name match, so the component highlights nothing in the label.
    expect(hits.every((h) => h.matchIndex === -1)).toBe(true);
  });

  it("ranks label matches above module-name matches", () => {
    // "Journal" matches the module name, so both its sections are hits — but
    // Investments has a section *labelled* "Journal Export", which is the
    // stronger signal and has to come first.
    const withExport = buildNavigationTree(MODULES, {
      sectionsFor: (slug) =>
        slug === "investments"
          ? [{ id: "export", label: "Journal Export", href: "/modules/investments/export" }]
          : SECTIONS.sectionsFor(slug),
    });

    const hits = filterTree(withExport, "journal");

    expect(hits[0].section.label).toBe("Journal Export");
    expect(hits[0].matchIndex).toBe(0);
    // The Journal module's own sections follow, matched by module name only.
    expect(hits.slice(1).every((h) => h.matchIndex === -1)).toBe(true);
  });

  it("returns nothing for an empty or whitespace query", () => {
    // Not "everything" — the caller treats empty as "no filter", and returning
    // the whole tree would make no-results indistinguishable from unfiltered.
    expect(filterTree(tree, "")).toEqual([]);
    expect(filterTree(tree, "   ")).toEqual([]);
  });

  it("returns nothing when no label or module matches", () => {
    expect(filterTree(tree, "zzzznope")).toEqual([]);
  });
});

describe("groupHitsByModule", () => {
  it("regroups hits under their module in tree order, not ranking order", () => {
    const grouped = groupHitsByModule(tree, filterTree(tree, "import"));

    // Expense ranked first, but the headings keep the tree's own order.
    expect(grouped.map((g) => g.module.slug)).toEqual(["journal", "investments", "expense"]);
    expect(grouped.every((g) => g.sections.length === 1)).toBe(true);
  });

  it("drops modules with no hits entirely", () => {
    const grouped = groupHitsByModule(tree, filterTree(tree, "calendar"));

    expect(grouped).toHaveLength(1);
    expect(grouped[0].module.slug).toBe("journal");
  });

  it("returns nothing for an empty hit list", () => {
    expect(groupHitsByModule(tree, [])).toEqual([]);
  });
});
