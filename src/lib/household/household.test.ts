import { describe, expect, it } from "vitest";
import type { DecodedImage } from "@/lib/shared/image-upload";
import {
  bulkUpdateRecipes,
  clearRecipeImage,
  createRecipe,
  deleteRecipe,
  deleteRecipes,
  getRecipe,
  getRecipeImage,
  incrementMadeCount,
  listRecipeCategories,
  listRecipeTags,
  listRecipes,
  setRecipeImage,
  toLines,
  updateRecipe,
} from "./household";
import type { HouseholdRepository } from "./ports";
import type { BulkUpdateRecipesData, RecipeQuery, RecipeWriteData } from "./schema";
import type { Recipe, RecipeCategoryCount, RecipeSummary, RecipeTagCount } from "./types";

/**
 * A hand-written in-memory repository, per ARCHITECTURE.md's "fakes over mocks".
 *
 * It reproduces the behaviours the use-cases actually depend on — the tag
 * cascade on delete, "an unknown id counts as zero changes", and the partial
 * semantics of a bulk edit — because those are the contract, not incidental
 * SQL details.
 */
export class FakeHouseholdRepository implements HouseholdRepository {
  private nextId = 1;
  readonly recipes = new Map<number, Recipe>();
  readonly images = new Map<number, DecodedImage>();

  listRecipes(query: RecipeQuery): RecipeSummary[] {
    return [...this.recipes.values()]
      .filter((recipe) => {
        const matchesSearch =
          !query.search ||
          [recipe.name, recipe.description, recipe.ingredients].some((field) =>
            field.toLowerCase().includes(query.search.toLowerCase()),
          );
        const matchesTag = !query.tag || recipe.tags.includes(query.tag);
        // Case-insensitive, matching the repository's `COLLATE NOCASE`.
        const matchesCategory =
          !query.category || recipe.category.toLowerCase() === query.category.toLowerCase();
        return matchesSearch && matchesCategory && matchesTag;
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  getRecipeById(id: number): Recipe | undefined {
    return this.recipes.get(id);
  }

  createRecipe(input: RecipeWriteData): Recipe {
    const id = this.nextId++;
    const recipe: Recipe = {
      id,
      ...input,
      hasPicture: false,
      createdAt: "2026-09-28 10:00:00",
      updatedAt: "2026-09-28 10:00:00",
    };
    this.recipes.set(id, recipe);
    return recipe;
  }

  updateRecipe(id: number, input: RecipeWriteData): Recipe | undefined {
    const existing = this.recipes.get(id);
    if (!existing) return undefined;
    const updated: Recipe = { ...existing, ...input };
    this.recipes.set(id, updated);
    return updated;
  }

  deleteRecipe(id: number): void {
    this.recipes.delete(id);
    this.images.delete(id);
  }

  deleteRecipes(ids: number[]): number {
    let removed = 0;
    for (const id of ids) if (this.recipes.delete(id)) removed += 1;
    return removed;
  }

  bulkUpdateRecipes(input: BulkUpdateRecipesData): number {
    let changed = 0;
    for (const id of input.ids) {
      const recipe = this.recipes.get(id);
      if (!recipe) continue;

      const next = { ...recipe };
      if (input.rating !== undefined) next.rating = input.rating;
      if (input.madeCount !== undefined) next.madeCount = input.madeCount;
      if (input.category !== undefined) next.category = input.category;
      if (input.sourceUrl !== undefined) next.sourceUrl = input.sourceUrl;

      if (input.tagEdit) {
        const { mode, tags } = input.tagEdit;
        if (mode === "add") next.tags = [...new Set([...next.tags, ...tags])].sort();
        if (mode === "remove") next.tags = next.tags.filter((tag) => !tags.includes(tag));
        if (mode === "replace") next.tags = [...tags];
      }

      this.recipes.set(id, next);
      changed += 1;
    }
    return changed;
  }

  incrementMadeCount(id: number): number | undefined {
    const recipe = this.recipes.get(id);
    if (!recipe) return undefined;
    const madeCount = recipe.madeCount + 1;
    this.recipes.set(id, { ...recipe, madeCount });
    return madeCount;
  }

  getRecipeImage(id: number): DecodedImage | undefined {
    return this.images.get(id);
  }

  setRecipeImage(id: number, image: DecodedImage): void {
    this.images.set(id, image);
    const recipe = this.recipes.get(id);
    if (recipe) this.recipes.set(id, { ...recipe, hasPicture: true });
  }

  clearRecipeImage(id: number): void {
    this.images.delete(id);
    const recipe = this.recipes.get(id);
    if (recipe) this.recipes.set(id, { ...recipe, hasPicture: false });
  }

  listRecipeTags(): RecipeTagCount[] {
    const counts = new Map<string, number>();
    for (const recipe of this.recipes.values()) {
      for (const tag of recipe.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, recipeCount]) => ({ name, recipeCount }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /** Folded case-insensitively and blank-excluded, as the SQL GROUP BY does. */
  listRecipeCategories(): RecipeCategoryCount[] {
    const counts = new Map<string, { name: string; recipeCount: number }>();
    for (const recipe of this.recipes.values()) {
      if (recipe.category === "") continue;
      const key = recipe.category.toLowerCase();
      const existing = counts.get(key);
      if (existing) {
        existing.recipeCount += 1;
        // MIN(category) in SQL — a deterministic spelling for the group.
        if (recipe.category < existing.name) existing.name = recipe.category;
      } else {
        counts.set(key, { name: recipe.category, recipeCount: 1 });
      }
    }
    return [...counts.values()].sort((left, right) =>
      left.name.toLowerCase().localeCompare(right.name.toLowerCase()),
    );
  }

  /** Case-insensitive and id-ordered, matching the SQL COLLATE NOCASE + ORDER BY. */
  findRecipeIdsByName(name: string): number[] {
    return [...this.recipes.values()]
      .filter((recipe) => recipe.name.toLowerCase() === name.toLowerCase())
      .map((recipe) => recipe.id)
      .sort((left, right) => left - right);
  }
}

/** The minimum a valid recipe needs; every other field has a default. */
function aRecipe(overrides: Partial<{ name: string; tags: string[] }> = {}) {
  return { name: "Roast chicken", ...overrides };
}

describe("createRecipe", () => {
  it("creates a recipe with the defaults every optional field carries", () => {
    const repo = new FakeHouseholdRepository();

    const recipe = createRecipe(repo, aRecipe());

    expect(recipe.id).toBe(1);
    expect(recipe.name).toBe("Roast chicken");
    // Blank, not null — the columns are NOT NULL DEFAULT ''.
    expect(recipe.description).toBe("");
    expect(recipe.notes).toBe("");
    expect(recipe.sourceUrl).toBe("");
    expect(recipe.madeCount).toBe(0);
    // Unrated is null, and is a different fact from a 1.
    expect(recipe.rating).toBeNull();
    expect(recipe.tags).toEqual([]);
  });

  it("normalizes tags: trimmed, lower-cased, de-duplicated and sorted", () => {
    const repo = new FakeHouseholdRepository();

    const recipe = createRecipe(repo, {
      name: "Chili",
      tags: ["Weeknight", " weeknight ", "SPICY", "spicy", "freezer"],
    });

    // Three tags, not five: there is no managed tag list to reconcile casing
    // later, so it has to happen at the boundary.
    expect(recipe.tags).toEqual(["freezer", "spicy", "weeknight"]);
  });

  it("rejects a recipe with no name", () => {
    const repo = new FakeHouseholdRepository();

    expect(() => createRecipe(repo, { name: "   " })).toThrow();
  });

  it("rejects a rating outside 1-10, but accepts a blank one as unrated", () => {
    const repo = new FakeHouseholdRepository();

    expect(() => createRecipe(repo, { name: "Soup", rating: 11 })).toThrow();
    expect(() => createRecipe(repo, { name: "Soup", rating: 0 })).toThrow();
    expect(() => createRecipe(repo, { name: "Soup", rating: 4.5 })).toThrow();
    expect(createRecipe(repo, { name: "Soup", rating: "" }).rating).toBeNull();
    expect(createRecipe(repo, { name: "Stew", rating: 10 }).rating).toBe(10);
  });

  it("rejects a malformed source URL but allows a blank one", () => {
    const repo = new FakeHouseholdRepository();

    expect(() => createRecipe(repo, { name: "Soup", sourceUrl: "not a url" })).toThrow();
    expect(createRecipe(repo, { name: "Soup" }).sourceUrl).toBe("");
    expect(
      createRecipe(repo, { name: "Stew", sourceUrl: "https://example.com/stew" }).sourceUrl,
    ).toBe("https://example.com/stew");
  });
});

describe("listRecipes", () => {
  it("returns everything, by name, when no filter is given", () => {
    const repo = new FakeHouseholdRepository();
    createRecipe(repo, aRecipe({ name: "Zucchini bake" }));
    createRecipe(repo, aRecipe({ name: "Apple pie" }));

    expect(listRecipes(repo).map((recipe) => recipe.name)).toEqual([
      "Apple pie",
      "Zucchini bake",
    ]);
  });

  it("searches ingredients as well as the name", () => {
    const repo = new FakeHouseholdRepository();
    createRecipe(repo, { name: "Roast chicken", ingredients: "chicken\nbutter\nthyme" });
    createRecipe(repo, { name: "Apple pie", ingredients: "apples\nflour" });

    // "what can I make with the butter" is the same box as "what's it called".
    expect(listRecipes(repo, { search: "butter" }).map((recipe) => recipe.name)).toEqual([
      "Roast chicken",
    ]);
  });

  it("filters by tag", () => {
    const repo = new FakeHouseholdRepository();
    createRecipe(repo, { name: "Chili", tags: ["freezer"] });
    createRecipe(repo, { name: "Salad", tags: ["quick"] });

    expect(listRecipes(repo, { tag: "freezer" }).map((recipe) => recipe.name)).toEqual([
      "Chili",
    ]);
  });
});

describe("updateRecipe", () => {
  it("replaces every field including the tag set", () => {
    const repo = new FakeHouseholdRepository();
    const created = createRecipe(repo, { name: "Chili", tags: ["spicy"], rating: 6 });

    const updated = updateRecipe(repo, created.id, {
      name: "Chili con carne",
      notes: "Better with a day in the fridge.",
      tags: ["freezer"],
      rating: 9,
    });

    expect(updated.name).toBe("Chili con carne");
    expect(updated.rating).toBe(9);
    // Replaced wholesale, not merged.
    expect(updated.tags).toEqual(["freezer"]);
  });

  it("throws on an unknown id rather than silently doing nothing", () => {
    const repo = new FakeHouseholdRepository();

    // The caller has an edit form open, so silence would read as a save that
    // vanished.
    expect(() => updateRecipe(repo, 404, aRecipe())).toThrow(/No recipe with id 404/);
  });
});

describe("deleteRecipes", () => {
  it("reports how many were actually removed", () => {
    const repo = new FakeHouseholdRepository();
    const first = createRecipe(repo, aRecipe({ name: "One" }));
    const second = createRecipe(repo, aRecipe({ name: "Two" }));

    // 404 is stale, not an error — the caller is told what really happened.
    expect(deleteRecipes(repo, { ids: [first.id, second.id, 404] })).toBe(2);
    expect(listRecipes(repo)).toHaveLength(0);
  });

  it("rejects an empty selection", () => {
    const repo = new FakeHouseholdRepository();

    expect(() => deleteRecipes(repo, { ids: [] })).toThrow();
  });
});

describe("bulkUpdateRecipes", () => {
  it("writes only the fields that were supplied", () => {
    const repo = new FakeHouseholdRepository();
    const first = createRecipe(repo, { name: "One", rating: 3, sourceUrl: "" });
    const second = createRecipe(repo, {
      name: "Two",
      rating: 4,
      sourceUrl: "https://example.com/two",
    });

    const changed = bulkUpdateRecipes(repo, { ids: [first.id, second.id], rating: 8 });

    expect(changed).toBe(2);
    // This is the whole contract of the feature: an omitted field is untouched,
    // so a blank box in the dialog cannot blank a column across a selection.
    expect(getRecipe(repo, second.id)?.sourceUrl).toBe("https://example.com/two");
    expect(getRecipe(repo, first.id)?.rating).toBe(8);
    expect(getRecipe(repo, second.id)?.rating).toBe(8);
  });

  it("adds, removes and replaces tags across a selection", () => {
    const repo = new FakeHouseholdRepository();
    const first = createRecipe(repo, { name: "One", tags: ["spicy"] });
    const second = createRecipe(repo, { name: "Two", tags: ["quick"] });
    const ids = [first.id, second.id];

    bulkUpdateRecipes(repo, { ids, tagEdit: { mode: "add", tags: ["freezer"] } });
    expect(getRecipe(repo, first.id)?.tags).toEqual(["freezer", "spicy"]);
    expect(getRecipe(repo, second.id)?.tags).toEqual(["freezer", "quick"]);

    bulkUpdateRecipes(repo, { ids, tagEdit: { mode: "remove", tags: ["freezer"] } });
    expect(getRecipe(repo, first.id)?.tags).toEqual(["spicy"]);

    bulkUpdateRecipes(repo, { ids, tagEdit: { mode: "replace", tags: ["weeknight"] } });
    expect(getRecipe(repo, first.id)?.tags).toEqual(["weeknight"]);
    expect(getRecipe(repo, second.id)?.tags).toEqual(["weeknight"]);
  });

  it("clears a rating when null is explicitly passed", () => {
    const repo = new FakeHouseholdRepository();
    const created = createRecipe(repo, { name: "One", rating: 5 });

    // null means "clear it"; undefined means "leave alone". They must not merge.
    bulkUpdateRecipes(repo, { ids: [created.id], rating: null });

    expect(getRecipe(repo, created.id)?.rating).toBeNull();
  });

  it("refuses an edit that changes nothing", () => {
    const repo = new FakeHouseholdRepository();
    const created = createRecipe(repo, aRecipe());

    // An empty edit quietly bumping every row's updated_at is worse than an error.
    expect(() => bulkUpdateRecipes(repo, { ids: [created.id] })).toThrow();
  });

  it("rejects an invalid value before any row is touched", () => {
    const repo = new FakeHouseholdRepository();
    const created = createRecipe(repo, { name: "One", rating: 5 });

    expect(() => bulkUpdateRecipes(repo, { ids: [created.id], rating: 99 })).toThrow();
    expect(getRecipe(repo, created.id)?.rating).toBe(5);
  });
});

describe("incrementMadeCount", () => {
  it("adds one and returns the new count", () => {
    const repo = new FakeHouseholdRepository();
    const created = createRecipe(repo, aRecipe());

    expect(incrementMadeCount(repo, created.id)).toBe(1);
    expect(incrementMadeCount(repo, created.id)).toBe(2);
    expect(getRecipe(repo, created.id)?.madeCount).toBe(2);
  });

  it("throws on an unknown id", () => {
    const repo = new FakeHouseholdRepository();

    expect(() => incrementMadeCount(repo, 404)).toThrow(/No recipe with id 404/);
  });
});

describe("recipe pictures", () => {
  const onePixelPng =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  it("stores and reads back an uploaded picture", async () => {
    const repo = new FakeHouseholdRepository();
    const created = createRecipe(repo, aRecipe());

    // No processor: the bytes are stored verbatim, which is the CLI's and the
    // test's path. The resize itself is covered in resize-recipe-picture.test.ts.
    await setRecipeImage(repo, {
      id: created.id,
      picture: { mimeType: "image/png", base64Data: onePixelPng },
    });

    const image = getRecipeImage(repo, created.id);
    expect(image?.mimeType).toBe("image/png");
    expect(image?.data.length).toBeGreaterThan(0);
    // The list projection has to notice, since it never reads the bytes.
    expect(getRecipe(repo, created.id)?.hasPicture).toBe(true);
  });

  it("refuses a picture for a recipe that does not exist", async () => {
    const repo = new FakeHouseholdRepository();

    await expect(
      setRecipeImage(repo, {
        id: 404,
        picture: { mimeType: "image/png", base64Data: onePixelPng },
      }),
    ).rejects.toThrow(/No recipe with id 404/);
  });

  it("refuses an SVG, which could carry script and is served from our origin", async () => {
    const repo = new FakeHouseholdRepository();
    const created = createRecipe(repo, aRecipe());

    await expect(
      setRecipeImage(repo, {
        id: created.id,
        // Not in IMAGE_UPLOAD_MIME_TYPES, deliberately.
        picture: { mimeType: "image/svg+xml" as "image/png", base64Data: onePixelPng },
      }),
    ).rejects.toThrow();
  });

  it("clears a picture", async () => {
    const repo = new FakeHouseholdRepository();
    const created = createRecipe(repo, aRecipe());
    await setRecipeImage(repo, {
      id: created.id,
      picture: { mimeType: "image/png", base64Data: onePixelPng },
    });

    clearRecipeImage(repo, created.id);

    expect(getRecipeImage(repo, created.id)).toBeUndefined();
    expect(getRecipe(repo, created.id)?.hasPicture).toBe(false);
  });
});

describe("category", () => {
  it("defaults to blank — a recipe is uncategorised until it is categorised", () => {
    const repo = new FakeHouseholdRepository();

    expect(createRecipe(repo, { name: "Soup" }).category).toBe("");
  });

  it("preserves the case it was typed in, unlike a tag", () => {
    const repo = new FakeHouseholdRepository();

    // The one deliberate difference from tags, which lower-case at the boundary.
    // A category is a display label, so "Dessert" must not become "dessert".
    const recipe = createRecipe(repo, { name: "Pie", category: "  Dessert  ", tags: ["Sweet"] });

    expect(recipe.category).toBe("Dessert");
    expect(recipe.tags).toEqual(["sweet"]);
  });

  it("rejects a category longer than the cap", () => {
    const repo = new FakeHouseholdRepository();

    expect(() => createRecipe(repo, { name: "Soup", category: "x".repeat(41) })).toThrow();
  });

  it("filters the list case-insensitively", () => {
    const repo = new FakeHouseholdRepository();
    createRecipe(repo, { name: "Pie", category: "Dessert" });
    createRecipe(repo, { name: "Stew", category: "Dinner" });

    // A bookmarked ?category=dessert has to keep working against stored "Dessert".
    expect(listRecipes(repo, { category: "dessert" }).map((row) => row.name)).toEqual(["Pie"]);
    expect(listRecipes(repo, { category: "Dessert" }).map((row) => row.name)).toEqual(["Pie"]);
  });

  it("combines with the search and tag filters rather than replacing them", () => {
    const repo = new FakeHouseholdRepository();
    createRecipe(repo, { name: "Apple pie", category: "Dessert", tags: ["easy"] });
    createRecipe(repo, { name: "Pecan pie", category: "Dessert", tags: ["hard"] });

    expect(
      listRecipes(repo, { category: "Dessert", tag: "easy" }).map((row) => row.name),
    ).toEqual(["Apple pie"]);
  });

  it("is settable across a selection, and clearable with a blank", () => {
    const repo = new FakeHouseholdRepository();
    const first = createRecipe(repo, { name: "One", category: "Lunch" });
    const second = createRecipe(repo, { name: "Two" });
    const ids = [first.id, second.id];

    expect(bulkUpdateRecipes(repo, { ids, category: "Dinner" })).toBe(2);
    expect(getRecipe(repo, second.id)?.category).toBe("Dinner");

    // Blank is a real instruction here, not "leave alone" — that is `undefined`.
    bulkUpdateRecipes(repo, { ids, category: "" });
    expect(getRecipe(repo, first.id)?.category).toBe("");
  });

  it("is left alone by a bulk edit that does not mention it", () => {
    const repo = new FakeHouseholdRepository();
    const created = createRecipe(repo, { name: "One", category: "Dinner" });

    // The whole safety property of the bulk dialog, now covering this field too.
    bulkUpdateRecipes(repo, { ids: [created.id], rating: 7 });

    expect(getRecipe(repo, created.id)?.category).toBe("Dinner");
  });

  it("counts categories in use, folding case and excluding the uncategorised", () => {
    const repo = new FakeHouseholdRepository();
    createRecipe(repo, { name: "One", category: "Dessert" });
    createRecipe(repo, { name: "Two", category: "dessert" });
    createRecipe(repo, { name: "Three", category: "Dinner" });
    createRecipe(repo, { name: "Four" });

    // One "Dessert" entry counting both spellings, and no blank entry —
    // uncategorised is the absence of a category, not one of the options.
    expect(listRecipeCategories(repo)).toEqual([
      { name: "Dessert", recipeCount: 2 },
      { name: "Dinner", recipeCount: 1 },
    ]);
  });

  it("reports nothing when no recipe is categorised", () => {
    const repo = new FakeHouseholdRepository();
    createRecipe(repo, { name: "One" });

    expect(listRecipeCategories(repo)).toEqual([]);
  });
});

describe("listRecipeTags", () => {
  it("counts how many recipes carry each tag", () => {
    const repo = new FakeHouseholdRepository();
    createRecipe(repo, { name: "One", tags: ["freezer", "spicy"] });
    createRecipe(repo, { name: "Two", tags: ["freezer"] });

    expect(listRecipeTags(repo)).toEqual([
      { name: "freezer", recipeCount: 2 },
      { name: "spicy", recipeCount: 1 },
    ]);
  });
});

describe("toLines", () => {
  it("splits a block into trimmed, non-empty lines", () => {
    expect(toLines("2 cups flour\n  1 tsp salt  \n\n3 eggs\n")).toEqual([
      "2 cups flour",
      "1 tsp salt",
      "3 eggs",
    ]);
  });

  it("returns nothing for a blank block", () => {
    expect(toLines("")).toEqual([]);
    expect(toLines("\n  \n")).toEqual([]);
  });
});

describe("deleteRecipe", () => {
  it("removes the recipe and its picture", () => {
    const repo = new FakeHouseholdRepository();
    const created = createRecipe(repo, aRecipe());

    deleteRecipe(repo, created.id);

    expect(getRecipe(repo, created.id)).toBeUndefined();
    expect(getRecipeImage(repo, created.id)).toBeUndefined();
  });

  it("rejects an id that is not a positive integer", () => {
    const repo = new FakeHouseholdRepository();

    expect(() => deleteRecipe(repo, 0)).toThrow();
    expect(() => deleteRecipe(repo, -1)).toThrow();
  });
});
