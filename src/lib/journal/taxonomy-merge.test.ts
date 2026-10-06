import { describe, expect, it } from "vitest";
import { mergeTaxonomy, planTaxonomyMerge } from "./taxonomy-merge";
import type { JournalRepository } from "./ports";
import type {
  JournalCategory,
  JournalPrefillFieldValue,
  JournalPrefillTemplate,
  JournalTag,
  JournalTaxonomyCount,
  SavedJournalFilter,
} from "./types";

// The port methods a merge reaches. Named explicitly so the fake's own shape
// stays typechecked — see ics-import.test.ts for the same reasoning.
type MergeRepo = Pick<
  JournalRepository,
  | "listCategories"
  | "listTags"
  | "countEntriesByCategory"
  | "countEntriesByTag"
  | "mergeCategories"
  | "mergeTags"
  | "countDistinctEntriesWithCategories"
  | "countDistinctEntriesWithTags"
  | "listFilters"
  | "saveFilter"
  | "listPrefillTemplates"
  | "savePrefillTemplate"
  | "upsertCategory"
  | "upsertTag"
  | "getCategoryIcon"
  | "getTagIcon"
  | "setCategoryIcon"
  | "setTagIcon"
>;

interface FakeState {
  /** name -> entry ids carrying it. Models the join table, including its
   *  UNIQUE (entry_id, name): the ids are a Set, so a duplicate can't exist. */
  pairs: Map<string, Set<number>>;
  managed: Map<string, { description: string; iconMimeType?: string }>;
  icons: Map<string, { data: Buffer; mimeType: string }>;
  filters: SavedJournalFilter[];
  templates: JournalPrefillTemplate[];
}

function taxonomyRow(
  name: string,
  description = "",
  iconMimeType?: string,
): JournalCategory & JournalTag {
  return {
    name,
    description,
    iconMimeType,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/**
 * An in-memory repository whose `mergeCategories` reproduces the real one's
 * contract — crucially the de-duplication: an entry carrying two merged names
 * ends up carrying the target once, rather than raising a unique-constraint
 * error. That behaviour is the whole reason the merge is one repository method,
 * so the fake has to model it or the tests prove nothing.
 */
function fakeRepo(initial: Partial<FakeState> = {}): {
  repo: JournalRepository;
  state: FakeState;
} {
  const state: FakeState = {
    pairs: initial.pairs ?? new Map(),
    managed: initial.managed ?? new Map(),
    icons: initial.icons ?? new Map(),
    filters: initial.filters ?? [],
    templates: initial.templates ?? [],
  };

  const normalize = (name: string) => name.trim().toLowerCase();

  const listManaged = () =>
    [...state.managed.entries()]
      .map(([name, row]) => taxonomyRow(name, row.description, row.iconMimeType))
      .sort((a, b) => a.name.localeCompare(b.name));

  const counts = (): JournalTaxonomyCount[] =>
    [...state.pairs.entries()]
      .map(([name, ids]) => ({ name, entryCount: ids.size }))
      .sort((a, b) => a.name.localeCompare(b.name));

  function merge(sources: string[], target: string): number {
    // Exact-name comparison, like the real repository: "Work" and "WORK" are
    // two distinct rows, and the typed target is the one that survives.
    const resolved = target;
    const doomed = sources.filter((source) => source !== resolved);
    if (!state.managed.has(resolved)) state.managed.set(resolved, { description: "" });

    const targetIds = state.pairs.get(resolved) ?? new Set<number>();
    for (const source of doomed) {
      for (const id of state.pairs.get(source) ?? []) targetIds.add(id);
      state.pairs.delete(source);
      state.managed.delete(source);
    }
    if (targetIds.size > 0) state.pairs.set(resolved, targetIds);
    return targetIds.size;
  }

  // DISTINCT across the named lists, like the real query — an entry carrying
  // two of them counts once. Modelling this correctly is what lets the
  // double-count test below mean anything.
  const countDistinct = (names: string[]) => {
    const ids = new Set<number>();
    for (const name of names) {
      for (const [stored, storedIds] of state.pairs) {
        if (normalize(stored) !== normalize(name)) continue;
        for (const id of storedIds) ids.add(id);
      }
    }
    return ids.size;
  };

  const repo: MergeRepo = {
    countDistinctEntriesWithCategories: countDistinct,
    countDistinctEntriesWithTags: countDistinct,
    listCategories: listManaged,
    listTags: listManaged,
    countEntriesByCategory: counts,
    countEntriesByTag: counts,
    mergeCategories: merge,
    mergeTags: merge,
    listFilters: () => state.filters.map((saved) => ({ ...saved })),
    saveFilter: (input) => {
      const existing = state.filters.find((saved) => saved.name === input.name);
      if (existing) existing.filter = input.filter;
      return existing ?? { id: 1, name: input.name, filter: input.filter, createdAt: "", updatedAt: "" };
    },
    listPrefillTemplates: () => state.templates.map((template) => ({ ...template })),
    savePrefillTemplate: (input) => {
      const existing = state.templates.find((template) => template.id === input.id);
      if (existing) existing.fields = input.fields as JournalPrefillFieldValue[];
      return existing ?? state.templates[0];
    },
    upsertCategory: (input) => {
      state.managed.set(input.name, { description: input.description });
      return taxonomyRow(input.name, input.description);
    },
    upsertTag: (input) => {
      state.managed.set(input.name, { description: input.description });
      return taxonomyRow(input.name, input.description);
    },
    getCategoryIcon: (name) => state.icons.get(name),
    getTagIcon: (name) => state.icons.get(name),
    setCategoryIcon: (name, icon) => {
      if (icon) state.icons.set(name, icon);
      else state.icons.delete(name);
    },
    setTagIcon: (name, icon) => {
      if (icon) state.icons.set(name, icon);
      else state.icons.delete(name);
    },
  };

  return { repo: repo as JournalRepository, state };
}

/** A filter naming categories through the `hasAny` operator. */
function filterOn(name: string, values: string[]): SavedJournalFilter {
  return {
    id: 1,
    name,
    filter: {
      join: "AND",
      groups: [{ join: "AND", conditions: [{ field: "category", operator: "hasAny", values }] }],
    },
    createdAt: "",
    updatedAt: "",
  };
}

function template(id: number, name: string, value: string): JournalPrefillTemplate {
  return {
    id,
    name,
    description: "",
    isEnabled: true,
    fields: [{ field: "categories", mode: "literal", value }],
    createdAt: "",
    updatedAt: "",
  };
}

describe("mergeTaxonomy — entries", () => {
  it("re-points every entry onto the target and drops the source rows", () => {
    const { repo, state } = fakeRepo({
      managed: new Map([
        ["Trips", { description: "" }],
        ["Vacation", { description: "" }],
      ]),
      pairs: new Map([
        ["Trips", new Set([1, 2])],
        ["Vacation", new Set([3])],
      ]),
    });

    const result = mergeTaxonomy(repo, "category", {
      sources: ["Trips", "Vacation"],
      target: "Travel",
    });

    expect(result.entryCount).toBe(3);
    expect(result.mergedCount).toBe(2);
    expect([...state.pairs.get("Travel")!].sort()).toEqual([1, 2, 3]);
    expect(state.pairs.has("Trips")).toBe(false);
    expect(state.managed.has("Vacation")).toBe(false);
    expect(state.managed.has("Travel")).toBe(true);
  });

  it("counts an entry carrying two merged names once, rather than failing", () => {
    // The case that makes this one repository method: with
    // UNIQUE (entry_id, category_name), a naive UPDATE would raise a constraint
    // error here. Entry 1 carries both sources.
    const { repo, state } = fakeRepo({
      managed: new Map([
        ["Trips", { description: "" }],
        ["Vacation", { description: "" }],
      ]),
      pairs: new Map([
        ["Trips", new Set([1, 2])],
        ["Vacation", new Set([1, 3])],
      ]),
    });

    const result = mergeTaxonomy(repo, "category", {
      sources: ["Trips", "Vacation"],
      target: "Travel",
    });

    expect(result.entryCount).toBe(3);
    expect([...state.pairs.get("Travel")!].sort()).toEqual([1, 2, 3]);
  });

  it("keeps the target when it is itself one of the selected names", () => {
    const { repo, state } = fakeRepo({
      managed: new Map([
        ["Travel", { description: "" }],
        ["Trips", { description: "" }],
      ]),
      pairs: new Map([
        ["Travel", new Set([1])],
        ["Trips", new Set([2])],
      ]),
    });

    const result = mergeTaxonomy(repo, "category", {
      sources: ["Travel", "Trips"],
      target: "Travel",
    });

    expect(result.mergedCount).toBe(1);
    expect(state.managed.has("Travel")).toBe(true);
    expect([...state.pairs.get("Travel")!].sort()).toEqual([1, 2]);
  });

  it("keeps the name exactly as typed, even when it differs only in case", () => {
    const { repo, state } = fakeRepo({
      managed: new Map([
        ["Travel", { description: "" }],
        ["Trips", { description: "" }],
      ]),
      pairs: new Map([
        ["Travel", new Set([1])],
        ["Trips", new Set([2])],
      ]),
    });

    mergeTaxonomy(repo, "category", { sources: ["Travel", "Trips"], target: "travel" });

    // The reader named the survivor, so "travel" is what is left — the merge
    // does not substitute the pre-existing "Travel" spelling for it.
    expect([...state.managed.keys()]).toEqual(["travel"]);
    expect([...state.pairs.get("travel")!].sort()).toEqual([1, 2]);
  });

  it('merges "Work" and "WORK" without leaving either behind', () => {
    // The reported bug. These are two distinct rows (SQLite TEXT primary keys
    // are case-sensitive) that normalize alike, so deciding what to delete by
    // comparing normalized names excluded *both* as "the target": the merge
    // removed nothing and "WORK" stayed, still carrying its entries.
    const { repo, state } = fakeRepo({
      managed: new Map([
        ["Work", { description: "" }],
        ["WORK", { description: "" }],
      ]),
      pairs: new Map([
        ["Work", new Set([1, 4])],
        ["WORK", new Set([2, 3, 4])],
      ]),
    });

    const result = mergeTaxonomy(repo, "category", {
      sources: ["Work", "WORK"],
      target: "Work",
    });

    expect([...state.managed.keys()]).toEqual(["Work"]);
    // Entry 4 carried both and must end up with one pairing, not two.
    expect([...state.pairs.get("Work")!].sort()).toEqual([1, 2, 3, 4]);
    expect(result.entryCount).toBe(4);
  });

  it('merges "Work" and "WORK" into a wholly new name', () => {
    const { repo, state } = fakeRepo({
      managed: new Map([
        ["Work", { description: "" }],
        ["WORK", { description: "" }],
      ]),
      pairs: new Map([
        ["Work", new Set([1])],
        ["WORK", new Set([2])],
      ]),
    });

    mergeTaxonomy(repo, "category", { sources: ["Work", "WORK"], target: "Work Stuff" });

    expect([...state.managed.keys()]).toEqual(["Work Stuff"]);
    expect([...state.pairs.get("Work Stuff")!].sort()).toEqual([1, 2]);
  });

  it("renames a single name onto a new one", () => {
    const { repo, state } = fakeRepo({
      managed: new Map([["Trps", { description: "" }]]),
      pairs: new Map([["Trps", new Set([1, 2])]]),
    });

    const result = mergeTaxonomy(repo, "category", { sources: ["Trps"], target: "Trips" });

    expect(result.entryCount).toBe(2);
    expect(state.managed.has("Trps")).toBe(false);
    expect(state.managed.has("Trips")).toBe(true);
  });

  it("rejects a blank or whitespace-only target", () => {
    const { repo } = fakeRepo({ managed: new Map([["Trips", { description: "" }]]) });

    expect(() => mergeTaxonomy(repo, "category", { sources: ["Trips"], target: "   " })).toThrow();
    expect(() => mergeTaxonomy(repo, "category", { sources: ["Trips"], target: "" })).toThrow();
  });

  it("rejects an empty source list", () => {
    const { repo } = fakeRepo();
    expect(() => mergeTaxonomy(repo, "category", { sources: [], target: "Travel" })).toThrow();
  });
});

describe("mergeTaxonomy — icons and descriptions", () => {
  it("leaves an existing target's icon and description alone", () => {
    const { repo, state } = fakeRepo({
      managed: new Map([
        ["Travel", { description: "Going places", iconMimeType: "image/svg+xml" }],
        ["Trips", { description: "Short ones", iconMimeType: "image/png" }],
      ]),
      icons: new Map([
        ["Travel", { data: Buffer.from("kept"), mimeType: "image/svg+xml" }],
        ["Trips", { data: Buffer.from("discarded"), mimeType: "image/png" }],
      ]),
      pairs: new Map([["Trips", new Set([1])]]),
    });

    mergeTaxonomy(repo, "category", { sources: ["Trips"], target: "Travel" });

    expect(state.icons.get("Travel")!.data.toString()).toBe("kept");
    expect(state.managed.get("Travel")!.description).toBe("Going places");
  });

  it("gives a brand-new target the icon when exactly one source has one", () => {
    const { repo, state } = fakeRepo({
      managed: new Map([
        ["Trips", { description: "", iconMimeType: "image/png" }],
        ["Vacation", { description: "" }],
      ]),
      icons: new Map([["Trips", { data: Buffer.from("inherited"), mimeType: "image/png" }]]),
      pairs: new Map([["Trips", new Set([1])]]),
    });

    mergeTaxonomy(repo, "category", { sources: ["Trips", "Vacation"], target: "Travel" });

    expect(state.icons.get("Travel")!.data.toString()).toBe("inherited");
  });

  it("leaves a brand-new target iconless when two sources disagree", () => {
    // Picking one of two icons would be arbitrary; starting clean is honest.
    const { repo, state } = fakeRepo({
      managed: new Map([
        ["Trips", { description: "", iconMimeType: "image/png" }],
        ["Vacation", { description: "", iconMimeType: "image/svg+xml" }],
      ]),
      icons: new Map([
        ["Trips", { data: Buffer.from("a"), mimeType: "image/png" }],
        ["Vacation", { data: Buffer.from("b"), mimeType: "image/svg+xml" }],
      ]),
      pairs: new Map([["Trips", new Set([1])]]),
    });

    mergeTaxonomy(repo, "category", { sources: ["Trips", "Vacation"], target: "Travel" });

    expect(state.icons.has("Travel")).toBe(false);
  });
});

describe("mergeTaxonomy — saved filters", () => {
  it("rewrites a filter naming a merged category", () => {
    const { repo, state } = fakeRepo({
      managed: new Map([["Trips", { description: "" }]]),
      pairs: new Map([["Trips", new Set([1])]]),
      filters: [filterOn("Holidays", ["Trips", "Food"])],
    });

    const result = mergeTaxonomy(repo, "category", { sources: ["Trips"], target: "Travel" });

    expect(result.rewrittenFilters).toBe(1);
    expect(state.filters[0].filter.groups[0].conditions[0].values).toEqual(["Travel", "Food"]);
  });

  it("collapses the duplicate when a filter names two merged categories", () => {
    const { repo, state } = fakeRepo({
      managed: new Map([
        ["Trips", { description: "" }],
        ["Vacation", { description: "" }],
      ]),
      pairs: new Map([["Trips", new Set([1])]]),
      filters: [filterOn("Holidays", ["Trips", "Vacation"])],
    });

    mergeTaxonomy(repo, "category", { sources: ["Trips", "Vacation"], target: "Travel" });

    expect(state.filters[0].filter.groups[0].conditions[0].values).toEqual(["Travel"]);
  });

  it("leaves a filter naming none of the merged categories untouched", () => {
    const { repo, state } = fakeRepo({
      managed: new Map([["Trips", { description: "" }]]),
      pairs: new Map([["Trips", new Set([1])]]),
      filters: [filterOn("Meals", ["Food"])],
    });

    const result = mergeTaxonomy(repo, "category", { sources: ["Trips"], target: "Travel" });

    expect(result.rewrittenFilters).toBe(0);
    expect(state.filters[0].filter.groups[0].conditions[0].values).toEqual(["Food"]);
  });

  it("does not rewrite a tag filter when merging categories", () => {
    const { repo, state } = fakeRepo({
      managed: new Map([["Trips", { description: "" }]]),
      pairs: new Map([["Trips", new Set([1])]]),
      filters: [
        {
          id: 1,
          name: "Tagged",
          filter: {
            join: "AND",
            groups: [
              { join: "AND", conditions: [{ field: "tag", operator: "hasAny", values: ["Trips"] }] },
            ],
          },
          createdAt: "",
          updatedAt: "",
        },
      ],
    });

    const result = mergeTaxonomy(repo, "category", { sources: ["Trips"], target: "Travel" });

    expect(result.rewrittenFilters).toBe(0);
    expect(state.filters[0].filter.groups[0].conditions[0].values).toEqual(["Trips"]);
  });
});

describe("mergeTaxonomy — prefill templates", () => {
  it("rewrites a template's comma-separated categories", () => {
    const { repo, state } = fakeRepo({
      managed: new Map([["Trips", { description: "" }]]),
      pairs: new Map([["Trips", new Set([1])]]),
      templates: [template(1, "Holiday", "Trips, Food")],
    });

    const result = mergeTaxonomy(repo, "category", { sources: ["Trips"], target: "Travel" });

    expect(result.rewrittenTemplates).toBe(1);
    expect(state.templates[0].fields[0].value).toBe("Travel, Food");
  });

  it("collapses a duplicate the merge creates in a template", () => {
    const { repo, state } = fakeRepo({
      managed: new Map([
        ["Trips", { description: "" }],
        ["Vacation", { description: "" }],
      ]),
      pairs: new Map([["Trips", new Set([1])]]),
      templates: [template(1, "Holiday", "Trips, Vacation, Food")],
    });

    mergeTaxonomy(repo, "category", { sources: ["Trips", "Vacation"], target: "Travel" });

    expect(state.templates[0].fields[0].value).toBe("Travel, Food");
  });

  it("leaves an unrelated template alone", () => {
    const { repo, state } = fakeRepo({
      managed: new Map([["Trips", { description: "" }]]),
      pairs: new Map([["Trips", new Set([1])]]),
      templates: [template(1, "Meals", "Food")],
    });

    const result = mergeTaxonomy(repo, "category", { sources: ["Trips"], target: "Travel" });

    expect(result.rewrittenTemplates).toBe(0);
    expect(state.templates[0].fields[0].value).toBe("Food");
  });
});

describe("planTaxonomyMerge", () => {
  it("reports the collision, the entry count and what else would change", () => {
    const { repo } = fakeRepo({
      managed: new Map([
        ["Travel", { description: "" }],
        ["Trips", { description: "" }],
      ]),
      pairs: new Map([
        ["Travel", new Set([1])],
        ["Trips", new Set([2, 3])],
      ]),
      filters: [filterOn("Holidays", ["Trips"])],
      templates: [template(1, "Holiday", "Trips")],
    });

    const plan = planTaxonomyMerge(repo, "category", {
      sources: ["Trips"],
      target: "Travel",
    });

    expect(plan.targetExists).toBe(true);
    expect(plan.sources).toEqual(["Trips"]);
    expect(plan.entryCount).toBe(3);
    expect(plan.affectedFilters).toEqual(["Holidays"]);
    expect(plan.affectedTemplates).toEqual(["Holiday"]);
  });

  it("counts an entry carrying two sources once, not twice", () => {
    // The regression this guards: an earlier version summed the per-name counts,
    // so this reported 4 (2 + 2) where the real answer is 3. The number goes
    // straight into the confirm the reader decides on, so it must be exact.
    const { repo } = fakeRepo({
      managed: new Map([
        ["Trips", { description: "" }],
        ["Vacation", { description: "" }],
      ]),
      pairs: new Map([
        ["Trips", new Set([1, 2])],
        ["Vacation", new Set([1, 3])],
      ]),
    });

    const plan = planTaxonomyMerge(repo, "category", {
      sources: ["Trips", "Vacation"],
      target: "Travel",
    });

    expect(plan.entryCount).toBe(3);
  });

  it("reports a brand-new target as not existing", () => {
    const { repo } = fakeRepo({
      managed: new Map([["Trips", { description: "" }]]),
      pairs: new Map([["Trips", new Set([1])]]),
    });

    const plan = planTaxonomyMerge(repo, "category", { sources: ["Trips"], target: "Travel" });

    expect(plan.targetExists).toBe(false);
    expect(plan.entryCount).toBe(1);
  });

  it("drops the target from its own source list", () => {
    const { repo } = fakeRepo({
      managed: new Map([
        ["Travel", { description: "" }],
        ["Trips", { description: "" }],
      ]),
      pairs: new Map(),
    });

    const plan = planTaxonomyMerge(repo, "category", {
      sources: ["Travel", "Trips"],
      target: "Travel",
    });

    expect(plan.sources).toEqual(["Trips"]);
  });

  it("names the single source an icon would be inherited from", () => {
    const { repo } = fakeRepo({
      managed: new Map([
        ["Trips", { description: "", iconMimeType: "image/png" }],
        ["Vacation", { description: "" }],
      ]),
      pairs: new Map(),
    });

    const plan = planTaxonomyMerge(repo, "category", {
      sources: ["Trips", "Vacation"],
      target: "Travel",
    });

    expect(plan.inheritedIconFrom).toBe("Trips");
  });

  it("writes nothing", () => {
    const { repo, state } = fakeRepo({
      managed: new Map([["Trips", { description: "" }]]),
      pairs: new Map([["Trips", new Set([1])]]),
      filters: [filterOn("Holidays", ["Trips"])],
    });

    planTaxonomyMerge(repo, "category", { sources: ["Trips"], target: "Travel" });

    expect(state.managed.has("Trips")).toBe(true);
    expect(state.managed.has("Travel")).toBe(false);
    expect(state.filters[0].filter.groups[0].conditions[0].values).toEqual(["Trips"]);
  });
});
