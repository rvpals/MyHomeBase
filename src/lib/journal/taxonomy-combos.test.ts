import { describe, expect, it } from "vitest";
import {
  applyTaxonomyCombo,
  deleteTaxonomyCombo,
  describeTaxonomyCombo,
  getTaxonomyCombo,
  getTaxonomyComboByName,
  listTaxonomyCombos,
  saveTaxonomyCombo,
  searchTaxonomyCombos,
} from "./taxonomy-combos";
import { parseStoredComboNames, saveTaxonomyComboSchema } from "./schema";
import type { JournalRepository } from "./ports";
import type { TaxonomyComboWriteData } from "./schema";
import type { JournalTaxonomyCombo } from "./types";

// Hand-written in-memory fake covering only the combo slice of the port.
// Everything else throws, so a use-case that quietly reaches for an entry query
// fails loudly instead of passing on a stub — the same shape prefill.test.ts uses.
function fakeRepo() {
  let combos: JournalTaxonomyCombo[] = [];
  let nextId = 1;
  const now = "2026-01-01T00:00:00.000Z";

  const repo = {
    listTaxonomyCombos() {
      return [...combos].sort((a, b) => a.name.localeCompare(b.name));
    },
    getTaxonomyComboById(id: number) {
      return combos.find((combo) => combo.id === id);
    },
    getTaxonomyComboByName(name: string) {
      // NOCASE, matching idx_jrn_taxonomy_combos_name.
      return combos.find((combo) => combo.name.toLowerCase() === name.trim().toLowerCase());
    },
    saveTaxonomyCombo(input: TaxonomyComboWriteData) {
      if (input.id !== undefined) {
        const index = combos.findIndex((combo) => combo.id === input.id);
        if (index === -1) throw new Error(`Taxonomy combo ${input.id} no longer exists.`);
        const updated: JournalTaxonomyCombo = {
          ...combos[index],
          name: input.name,
          description: input.description,
          categories: input.categories,
          tags: input.tags,
          updatedAt: now,
        };
        combos[index] = updated;
        return updated;
      }
      const created: JournalTaxonomyCombo = {
        id: nextId++,
        name: input.name,
        description: input.description,
        categories: input.categories,
        tags: input.tags,
        createdAt: now,
        updatedAt: now,
      };
      combos.push(created);
      return created;
    },
    deleteTaxonomyCombo(id: number) {
      combos = combos.filter((combo) => combo.id !== id);
    },
  };

  return new Proxy(repo, {
    get(target, property, receiver) {
      if (property in target) return Reflect.get(target, property, receiver);
      return () => {
        throw new Error(`fakeRepo: ${String(property)} is not implemented for combo tests`);
      };
    },
  }) as unknown as JournalRepository;
}

function combo(overrides: Partial<JournalTaxonomyCombo> = {}): JournalTaxonomyCombo {
  return {
    id: 1,
    name: "Gym",
    description: "",
    categories: ["HEALTH"],
    tags: ["gym", "weights"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("applyTaxonomyCombo", () => {
  it("returns the combo's two lists", () => {
    expect(applyTaxonomyCombo(combo())).toEqual({
      categories: ["HEALTH"],
      tags: ["gym", "weights"],
    });
  });

  it("clears a field the combo names nothing for", () => {
    // The contract that makes a combo usable on an already-tagged entry: an empty
    // list is a real value, not "leave this one alone". Migration 0177.
    expect(applyTaxonomyCombo(combo({ tags: [] }))).toEqual({
      categories: ["HEALTH"],
      tags: [],
    });
  });

  it("copies the arrays rather than aliasing the stored combo", () => {
    const source = combo();
    const applied = applyTaxonomyCombo(source);
    applied.categories.push("WORK");
    expect(source.categories).toEqual(["HEALTH"]);
  });
});

describe("describeTaxonomyCombo", () => {
  it("names both lists", () => {
    expect(describeTaxonomyCombo(combo())).toBe("Categories: HEALTH · Tags: gym, weights");
  });

  it("omits an empty list rather than printing an empty label", () => {
    expect(describeTaxonomyCombo(combo({ categories: [] }))).toBe("Tags: gym, weights");
  });

  it("says what an empty combo does instead of returning nothing", () => {
    expect(describeTaxonomyCombo(combo({ categories: [], tags: [] }))).toBe(
      "Clears both categories and tags.",
    );
  });
});

describe("searchTaxonomyCombos", () => {
  const combos = [
    combo({ id: 1, name: "Workout", description: "After the gym.", categories: [], tags: ["GYM"] }),
    combo({ id: 2, name: "Family day", description: "", categories: ["FAMILY"], tags: ["kids"] }),
  ];

  it("returns everything for a blank query", () => {
    expect(searchTaxonomyCombos(combos, "   ")).toHaveLength(2);
  });

  it("matches a member name, not just the combo's own name", () => {
    // The reason this isn't a plain name filter: the reader is hunting a set of
    // tags and may remember a member rather than the name they gave the set.
    const found = searchTaxonomyCombos(combos, "gym");
    expect(found.map((item) => item.name)).toEqual(["Workout"]);
  });

  it("matches the description, case-insensitively", () => {
    expect(searchTaxonomyCombos(combos, "AFTER").map((item) => item.id)).toEqual([1]);
  });

  it("returns nothing when nothing matches", () => {
    expect(searchTaxonomyCombos(combos, "golf")).toEqual([]);
  });
});

describe("saveTaxonomyCombo", () => {
  it("creates a combo and reads it back by name, case-insensitively", () => {
    const repo = fakeRepo();
    const saved = saveTaxonomyCombo(repo, {
      name: "Gym",
      description: "Weights day.",
      categories: ["HEALTH"],
      tags: ["gym"],
    });
    expect(saved.id).toBe(1);
    expect(getTaxonomyComboByName(repo, "  gym  ")?.id).toBe(1);
    expect(listTaxonomyCombos(repo)).toHaveLength(1);
  });

  it("updates in place when an id is passed", () => {
    const repo = fakeRepo();
    const created = saveTaxonomyCombo(repo, { name: "Gym", categories: [], tags: ["gym"] });
    const updated = saveTaxonomyCombo(repo, {
      id: created.id,
      name: "Gym",
      categories: ["HEALTH"],
      tags: ["gym", "weights"],
    });
    expect(updated.id).toBe(created.id);
    expect(updated.categories).toEqual(["HEALTH"]);
    expect(listTaxonomyCombos(repo)).toHaveLength(1);
  });

  it("refuses a name another combo already holds, with a sentence", () => {
    const repo = fakeRepo();
    saveTaxonomyCombo(repo, { name: "Gym", categories: [], tags: [] });
    expect(() => saveTaxonomyCombo(repo, { name: "gym", categories: [], tags: [] })).toThrow(
      /already exists/,
    );
  });

  it("lets a combo keep its own name on an edit", () => {
    const repo = fakeRepo();
    const created = saveTaxonomyCombo(repo, { name: "Gym", categories: [], tags: [] });
    expect(() =>
      saveTaxonomyCombo(repo, { id: created.id, name: "Gym", categories: ["HEALTH"], tags: [] }),
    ).not.toThrow();
  });

  it("refuses an edit of a combo that has since been deleted", () => {
    const repo = fakeRepo();
    expect(() => saveTaxonomyCombo(repo, { id: 99, name: "Gym", categories: [], tags: [] })).toThrow(
      /no longer exists/,
    );
  });

  it("refuses a blank name", () => {
    const repo = fakeRepo();
    expect(() => saveTaxonomyCombo(repo, { name: "   ", categories: [], tags: [] })).toThrow();
  });

  it("accepts a combo that names nothing — it clears both fields", () => {
    const repo = fakeRepo();
    const saved = saveTaxonomyCombo(repo, { name: "Untagged", categories: [], tags: [] });
    expect(applyTaxonomyCombo(saved)).toEqual({ categories: [], tags: [] });
  });

  it("de-duplicates names case-insensitively, keeping the first spelling", () => {
    const repo = fakeRepo();
    const saved = saveTaxonomyCombo(repo, {
      name: "Gym",
      categories: ["HEALTH", "health", "Health"],
      tags: ["gym", "GYM"],
    });
    expect(saved.categories).toEqual(["HEALTH"]);
    expect(saved.tags).toEqual(["gym"]);
  });
});

describe("deleteTaxonomyCombo", () => {
  it("removes the combo", () => {
    const repo = fakeRepo();
    const created = saveTaxonomyCombo(repo, { name: "Gym", categories: [], tags: [] });
    deleteTaxonomyCombo(repo, created.id);
    expect(getTaxonomyCombo(repo, created.id)).toBeUndefined();
  });

  it("refuses a non-positive id rather than issuing the DELETE", () => {
    const repo = fakeRepo();
    expect(() => deleteTaxonomyCombo(repo, 0)).toThrow(/positive integer/);
  });
});

describe("saveTaxonomyComboSchema", () => {
  it("trims the name and defaults the rest", () => {
    const parsed = saveTaxonomyComboSchema.parse({ name: "  Gym  " });
    expect(parsed).toEqual({ name: "Gym", description: "", categories: [], tags: [] });
  });

  it("rejects a blank member name", () => {
    expect(saveTaxonomyComboSchema.safeParse({ name: "Gym", tags: ["  "] }).success).toBe(false);
  });
});

describe("parseStoredComboNames", () => {
  it("reads a stored array", () => {
    expect(parseStoredComboNames('["HEALTH","gym"]')).toEqual(["HEALTH", "gym"]);
  });

  it("comes back empty rather than throwing on rotted JSON", () => {
    // The forgiving contract: one bad row must not 500 the Meta Data screen.
    expect(parseStoredComboNames("not json")).toEqual([]);
    expect(parseStoredComboNames('{"categories":[]}')).toEqual([]);
  });

  it("drops non-string and blank members individually", () => {
    expect(parseStoredComboNames('["HEALTH",3,null,"  ","gym"]')).toEqual(["HEALTH", "gym"]);
  });

  it("de-duplicates on read as well as on write", () => {
    expect(parseStoredComboNames('["gym","GYM"]')).toEqual(["gym"]);
  });
});
