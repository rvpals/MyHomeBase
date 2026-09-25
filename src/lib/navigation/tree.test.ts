import { describe, expect, it } from "vitest";
import type { SectionSource } from "./ports";
import {
  buildNavigationTree,
  findActiveModule,
  findActiveSection,
  flattenTree,
  type NavigationModuleInput,
} from "./tree";
import type { TreeSection } from "./types";

const MODULES: NavigationModuleInput[] = [
  { slug: "journal", shortName: "Journal", icon: "journal", description: "A journal." },
  { slug: "expense", shortName: "Expense", icon: "wallet" },
];

function sectionSource(map: Record<string, TreeSection[]>): SectionSource {
  return { sectionsFor: (slug) => map[slug] ?? [] };
}

const SECTIONS = sectionSource({
  journal: [
    { id: "entries", label: "Entries", href: "/modules/journal/entries" },
    { id: "locations", label: "Locations", href: "/modules/journal/locations", group: "Locations" },
    {
      id: "location-map",
      label: "Location Map",
      href: "/modules/journal/locations/map",
      group: "Locations",
    },
  ],
  expense: [{ id: "main", label: "Main", href: "/modules/expense/main" }],
});

describe("buildNavigationTree", () => {
  it("puts Home at the top and every module under it", () => {
    const tree = buildNavigationTree(MODULES, SECTIONS);

    expect(tree.home.href).toBe("/home");
    expect(tree.modules.map((m) => m.slug)).toEqual(["journal", "expense"]);
    expect(tree.modules[0].sections).toHaveLength(3);
    expect(tree.modules[0].href).toBe("/modules/journal");
  });

  it("keeps a module with no sections as an empty heading", () => {
    // A module registered before its shell exists. Hiding it would make a
    // half-built module invisible rather than obviously unfinished.
    const tree = buildNavigationTree(
      [{ slug: "brand-new", shortName: "Brand New", icon: "star" }],
      SECTIONS,
    );

    expect(tree.modules).toHaveLength(1);
    expect(tree.modules[0].sections).toEqual([]);
  });

  it("does not filter by access — it renders exactly the modules it is given", () => {
    // The caller passes the already-filtered list. A second access rule here
    // would be a place for the two to disagree.
    const tree = buildNavigationTree([], SECTIONS);
    expect(tree.modules).toEqual([]);
    expect(tree.home).toBeDefined();
  });
});

describe("findActiveModule", () => {
  const tree = buildNavigationTree(MODULES, SECTIONS);

  it("matches a module root exactly", () => {
    expect(findActiveModule(tree, "/modules/journal")?.slug).toBe("journal");
  });

  it("matches a path inside the module, so a record keeps its module expanded", () => {
    expect(findActiveModule(tree, "/modules/journal/entries/42")?.slug).toBe("journal");
  });

  it("returns undefined for Home and for anything outside a module", () => {
    expect(findActiveModule(tree, "/home")).toBeUndefined();
    expect(findActiveModule(tree, "/account")).toBeUndefined();
  });

  it("does not match a module whose slug is only a prefix of the path segment", () => {
    // `/modules/journalling` is a different module, not a child of `journal`.
    expect(findActiveModule(tree, "/modules/journalling")).toBeUndefined();
  });
});

describe("findActiveSection", () => {
  const tree = buildNavigationTree(MODULES, SECTIONS);

  it("finds the section a path sits on", () => {
    expect(findActiveSection(tree, "/modules/journal/entries")?.section.id).toBe("entries");
  });

  it("prefers the longest matching href when one slug prefixes another", () => {
    // The bug this guards: `/locations/map` also starts with `/locations`.
    const hit = findActiveSection(tree, "/modules/journal/locations/map");
    expect(hit?.section.id).toBe("location-map");
  });

  it("returns undefined when no section matches", () => {
    expect(findActiveSection(tree, "/account")).toBeUndefined();
  });
});

describe("flattenTree", () => {
  it("pairs every section with its owning module", () => {
    const flat = flattenTree(buildNavigationTree(MODULES, SECTIONS));

    expect(flat).toHaveLength(4);
    expect(flat.every((entry) => entry.module.slug && entry.section.href)).toBe(true);
    expect(flat.at(-1)?.module.slug).toBe("expense");
  });
});
