// Repository-level tests, against a real in-memory SQLite built from the
// module's own migration.
//
// These exist because the hand-written fake in household.test.ts cannot catch
// this class of bug: the fake stores whole `Recipe` objects, so every field is
// present on a list row there. The real `listRecipes` projects the long text
// away on purpose, and THAT difference is what let the editor be wired to a
// grid row and silently show three empty boxes.
import path from "node:path";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteHouseholdRepository } from "./repository";
import type { Recipe } from "./types";

// Every migration that shapes this module's tables, in order. A new one has to
// be added here or the schema under test drifts from the real one — which would
// make these tests pass against a table the app does not actually have.
const MIGRATIONS = [
  "0118_create_household_recipes.sql",
  "0120_add_category_to_recipes.sql",
];

function newRepo(): SqliteHouseholdRepository {
  const db = new Database(":memory:");
  for (const migration of MIGRATIONS) {
    db.exec(readFileSync(path.join(process.cwd(), "migrations", migration), "utf8"));
  }
  return new SqliteHouseholdRepository(db);
}

const FULL = {
  name: "Roast chicken",
  description: "Sunday dinner",
  ingredients: "chicken\nsalt\nlemon",
  directions: "season\nroast\nrest",
  notes: "Rest it properly.",
  madeCount: 3,
  rating: 9,
  category: "Dinner",
  sourceUrl: "https://example.com/roast",
  tags: ["sunday", "easy"],
};

let repo: SqliteHouseholdRepository;
beforeEach(() => {
  repo = newRepo();
});

describe("listRecipes projection", () => {
  it("does NOT carry the long text — a list row cannot fill the editor", () => {
    repo.createRecipe(FULL);

    const [row] = repo.listRecipes({ search: "", category: "", tag: "" });

    // The guard this file exists for. A summary is not a Recipe, and anything
    // that opens the editor must fetch the whole record instead of reusing a
    // grid row. Reading these off a row yields `undefined`, which a `?? ""`
    // silently turns into a blank field over a recipe that has one — and,
    // because `updateRecipe` replaces every column, saving that form would
    // then write the blanks back.
    const asAny = row as unknown as Record<string, unknown>;
    expect(asAny.ingredients).toBeUndefined();
    expect(asAny.directions).toBeUndefined();
    expect(asAny.notes).toBeUndefined();

    // What a summary IS expected to carry, so the list can render.
    expect(row.name).toBe("Roast chicken");
    expect(row.description).toBe("Sunday dinner");
    expect(row.sourceUrl).toBe("https://example.com/roast");
    expect(row.rating).toBe(9);
    expect(row.madeCount).toBe(3);
    expect(row.tags).toEqual(["easy", "sunday"]);
  });
});

describe("getRecipeById", () => {
  it("returns every field the editor needs", () => {
    const created = repo.createRecipe(FULL);

    const recipe = repo.getRecipeById(created.id) as Recipe;

    expect(recipe.ingredients).toBe("chicken\nsalt\nlemon");
    expect(recipe.directions).toBe("season\nroast\nrest");
    expect(recipe.notes).toBe("Rest it properly.");
    expect(recipe.description).toBe("Sunday dinner");
    expect(recipe.sourceUrl).toBe("https://example.com/roast");
    expect(recipe.rating).toBe(9);
    expect(recipe.madeCount).toBe(3);
    expect(recipe.tags).toEqual(["easy", "sunday"]);
  });

  it("round-trips through an update without losing the blocks", () => {
    const created = repo.createRecipe(FULL);

    // What the editor does on save: read, change one field, write it all back.
    const loaded = repo.getRecipeById(created.id)!;
    repo.updateRecipe(created.id, {
      name: loaded.name,
      description: "Changed",
      ingredients: loaded.ingredients,
      directions: loaded.directions,
      notes: loaded.notes,
      madeCount: loaded.madeCount,
      rating: loaded.rating,
      category: loaded.category,
      sourceUrl: loaded.sourceUrl,
      tags: loaded.tags,
    });

    const after = repo.getRecipeById(created.id)!;
    expect(after.description).toBe("Changed");
    expect(after.category).toBe("Dinner");
    expect(after.ingredients).toBe("chicken\nsalt\nlemon");
    expect(after.directions).toBe("season\nroast\nrest");
    expect(after.notes).toBe("Rest it properly.");
  });

  it("returns undefined for an unknown id", () => {
    expect(repo.getRecipeById(999)).toBeUndefined();
  });
});

describe("findRecipeIdsByName", () => {
  it("matches case-insensitively, ordered by id", () => {
    const first = repo.createRecipe({ ...FULL, name: "roast chicken" });
    const second = repo.createRecipe({ ...FULL, name: "Roast Chicken" });

    expect(repo.findRecipeIdsByName("ROAST CHICKEN")).toEqual([first.id, second.id]);
  });

  it("returns an empty list when nothing matches", () => {
    repo.createRecipe(FULL);

    expect(repo.findRecipeIdsByName("Soup")).toEqual([]);
  });
});

describe("category, in real SQL", () => {
  // These are here rather than only in household.test.ts because the behaviour
  // under test IS the SQL: `COLLATE NOCASE` on the filter and the GROUP BY, and
  // `MIN(category)` picking one spelling. A hand-written fake can only imitate
  // those, so it would agree with a broken query.

  it("stores the category as typed", () => {
    const created = repo.createRecipe({ ...FULL, category: "Dessert" });

    expect(repo.getRecipeById(created.id)!.category).toBe("Dessert");
  });

  it("carries the category on a LIST row, unlike the long text", () => {
    repo.createRecipe({ ...FULL, category: "Dessert" });

    // The filter and the grid column both need it, so it belongs in the
    // projection — this is the counterpart to the test at the top of this file.
    const [row] = repo.listRecipes({ search: "", category: "", tag: "" });
    expect(row.category).toBe("Dessert");
  });

  it("filters case-insensitively", () => {
    repo.createRecipe({ ...FULL, name: "Pie", category: "Dessert" });
    repo.createRecipe({ ...FULL, name: "Stew", category: "Dinner" });

    const found = repo.listRecipes({ search: "", category: "dessert", tag: "" });
    expect(found.map((row) => row.name)).toEqual(["Pie"]);
  });

  it("folds spellings into one entry and excludes the uncategorised", () => {
    repo.createRecipe({ ...FULL, name: "One", category: "Dessert" });
    repo.createRecipe({ ...FULL, name: "Two", category: "dessert" });
    repo.createRecipe({ ...FULL, name: "Three", category: "" });

    expect(repo.listRecipeCategories()).toEqual([{ name: "Dessert", recipeCount: 2 }]);
  });

  it("leaves the category alone on a bulk edit that omits it", () => {
    const created = repo.createRecipe({ ...FULL, category: "Dinner" });

    repo.bulkUpdateRecipes({ ids: [created.id], rating: 4 });

    expect(repo.getRecipeById(created.id)!.category).toBe("Dinner");
  });

  it("clears the category when a bulk edit passes a blank", () => {
    const created = repo.createRecipe({ ...FULL, category: "Dinner" });

    repo.bulkUpdateRecipes({ ids: [created.id], category: "" });

    expect(repo.getRecipeById(created.id)!.category).toBe("");
    expect(repo.listRecipeCategories()).toEqual([]);
  });
});
