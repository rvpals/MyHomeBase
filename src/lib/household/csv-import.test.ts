import { describe, expect, it } from "vitest";
import {
  autoMapRecipeHeaders,
  defaultRecipeFieldOptions,
  importRecipesCsv,
  planRecipeImport,
  testRecipeImport,
} from "./csv-import";
import { createRecipe } from "./household";
// The same fake the use-case tests drive, rather than a second one written
// here: a divergent fake is how a test starts passing against behaviour the
// real repository does not have.
import { FakeHouseholdRepository } from "./household.test";

/** Columns in the order every fixture below writes them. */
const MAPPING = { "0": "name", "1": "description", "2": "ingredients", "3": "tags" };

const HEADER = "Name,Description,Ingredients,Tags";

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

describe("autoMapRecipeHeaders", () => {
  it("maps recognized headers and seeds each field's default options", () => {
    const { columnMapping, fieldOptions } = autoMapRecipeHeaders([
      "Name",
      "Instructions",
      "Tags",
    ]);

    expect(columnMapping).toEqual({ "0": "name", "1": "directions", "2": "tags" });
    // Written, not merely rendered — an option that lives only in the control
    // is invisible to the import.
    expect(fieldOptions["1"]).toEqual({ delimiter: "\\n" });
    expect(fieldOptions["2"]).toEqual({ delimiter: "," });
  });

  it("leaves an unrecognized header unmapped rather than guessing", () => {
    const { columnMapping } = autoMapRecipeHeaders(["Name", "Oven tray size"]);

    expect(columnMapping).toEqual({ "0": "name" });
  });

  it("maps the category headers a recipe export actually uses", () => {
    const { columnMapping, fieldOptions } = autoMapRecipeHeaders(["Name", "Category"]);

    expect(columnMapping).toEqual({ "0": "name", "1": "category" });
    // No delimiter: a recipe has ONE category, so this column is never split.
    expect(fieldOptions["1"]).toBeUndefined();
    expect(autoMapRecipeHeaders(["Course"]).columnMapping).toEqual({ "0": "category" });
    expect(autoMapRecipeHeaders(["Meal type"]).columnMapping).toEqual({ "0": "category" });
  });
});

describe("defaultRecipeFieldOptions", () => {
  it("gives the block fields a newline and tags a comma", () => {
    expect(defaultRecipeFieldOptions("ingredients")).toEqual({ delimiter: "\\n" });
    expect(defaultRecipeFieldOptions("tags")).toEqual({ delimiter: "," });
    expect(defaultRecipeFieldOptions("name")).toBeUndefined();
  });
});

describe("importRecipesCsv", () => {
  it("imports a row, splitting the block and tag columns", () => {
    const repo = new FakeHouseholdRepository();

    const summary = importRecipesCsv(
      repo,
      csv('Roast chicken,Sunday dinner,"chicken\\nsalt\\nlemon","sunday, easy"'),
      MAPPING,
      { "2": { delimiter: "\\n" }, "3": { delimiter: "," } },
    );

    expect(summary.importedCount).toBe(1);
    const [recipe] = repo.listRecipes({ search: "", category: "", tag: "" });
    expect(recipe.name).toBe("Roast chicken");
    expect(repo.getRecipeById(recipe.id)?.ingredients).toBe("chicken\nsalt\nlemon");
    // Lower-cased, trimmed and sorted by the schema.
    expect(recipe.tags).toEqual(["easy", "sunday"]);
  });

  it("imports a category as typed, and never splits it", () => {
    const repo = new FakeHouseholdRepository();

    const summary = importRecipesCsv(
      repo,
      ["Name,Category", 'Apple pie,"Dessert, sweet"'].join("\n"),
      { "0": "name", "1": "category" },
      {},
    );

    expect(summary.importedCount).toBe(1);
    const [recipe] = repo.listRecipes({ search: "", category: "", tag: "" });
    // One category, case preserved — NOT two categories, and not lower-cased
    // the way the tags column would be. A comma in the cell is part of an
    // oddly-named category, since splitting would invent a value nobody typed.
    expect(recipe.category).toBe("Dessert, sweet");
  });

  it("splits a block on real newlines as well as the chosen delimiter", () => {
    const repo = new FakeHouseholdRepository();

    // A quoted cell holding a real line break AND a semicolon between items —
    // both mean "next item", so neither may end up buried inside a line.
    const summary = importRecipesCsv(
      repo,
      csv('Soup,,"stock; onion\ncarrot",'),
      MAPPING,
      { "2": { delimiter: ";" } },
    );

    expect(summary.importedCount).toBe(1);
    expect(repo.getRecipeById(1)?.ingredients).toBe("stock\nonion\ncarrot");
  });

  it("splits tags written with the newline escape", () => {
    const repo = new FakeHouseholdRepository();

    const summary = importRecipesCsv(repo, csv("Soup,,,easy\\nwinter"), MAPPING, {
      "3": { delimiter: "\\n" },
    });

    expect(summary.importedCount).toBe(1);
    expect(repo.listRecipes({ search: "", category: "", tag: "" })[0].tags).toEqual(["easy", "winter"]);
  });

  it("skips a row with no name rather than dropping it silently", () => {
    const repo = new FakeHouseholdRepository();

    const summary = importRecipesCsv(repo, csv(",orphaned,,"), MAPPING);

    expect(summary.importedCount).toBe(0);
    expect(summary.skippedCount).toBe(1);
    expect(summary.results[0]).toMatchObject({ rowNumber: 2 });
    expect(summary.results[0].reason).toContain("Name");
  });

  it("reports a bad rating as a skipped row and imports the rest", () => {
    const repo = new FakeHouseholdRepository();

    const summary = importRecipesCsv(
      repo,
      ["Name,Rating", "Roast chicken,99", "Soup,7"].join("\n"),
      { "0": "name", "1": "rating" },
    );

    expect(summary.importedCount).toBe(1);
    expect(summary.skippedCount).toBe(1);
    expect(summary.results[0].reason).toContain("Rating");
    expect(repo.listRecipes({ search: "", category: "", tag: "" })).toHaveLength(1);
  });

  it("skips a name that already exists, so re-importing a file is a no-op", () => {
    const repo = new FakeHouseholdRepository();
    createRecipe(repo, { name: "Roast chicken", description: "The stored one" });

    const summary = importRecipesCsv(repo, csv("Roast chicken,From the file,,"), MAPPING);

    expect(summary.importedCount).toBe(0);
    expect(summary.skippedCount).toBe(1);
    // Untouched: a skip leaves the stored recipe exactly as it was.
    expect(repo.listRecipes({ search: "", category: "", tag: "" })[0].description).toBe("The stored one");
  });

  it("matches an existing name case-insensitively", () => {
    const repo = new FakeHouseholdRepository();
    createRecipe(repo, { name: "roast chicken" });

    const summary = importRecipesCsv(repo, csv("Roast Chicken,,,"), MAPPING);

    expect(summary.skippedCount).toBe(1);
  });

  it("imports a duplicate name when skipDuplicates is off", () => {
    const repo = new FakeHouseholdRepository();
    createRecipe(repo, { name: "Roast chicken" });

    const summary = importRecipesCsv(repo, csv("Roast chicken,,,"), MAPPING, {}, {
      skipDuplicates: false,
    });

    expect(summary.importedCount).toBe(1);
    expect(repo.listRecipes({ search: "", category: "", tag: "" })).toHaveLength(2);
  });

  it("overwrites a matched recipe in place instead of skipping it", () => {
    const repo = new FakeHouseholdRepository();
    const stored = createRecipe(repo, { name: "Roast chicken", description: "Stale" });

    const summary = importRecipesCsv(repo, csv("Roast chicken,Fresh,,"), MAPPING, {}, {
      overwrite: true,
    });

    expect(summary.updatedCount).toBe(1);
    expect(summary.importedCount).toBe(0);
    // Replaced in place — same id, so the recipe's picture and history survive.
    expect(repo.getRecipeById(stored.id)?.description).toBe("Fresh");
    expect(repo.listRecipes({ search: "", category: "", tag: "" })).toHaveLength(1);
  });

  it("treats the second identical row in one file as a new recipe, not a duplicate of the first", () => {
    const repo = new FakeHouseholdRepository();

    // Nothing stored beforehand: both rows are genuine additions, and the
    // baseline must not count what this run just inserted.
    const summary = importRecipesCsv(repo, csv("Soup,,,", "Soup,,,"), MAPPING);

    expect(summary.importedCount).toBe(2);
  });
});

describe("excludedRowIndexes", () => {
  it("drops an unticked row entirely — not as a skip", () => {
    const repo = new FakeHouseholdRepository();

    const summary = importRecipesCsv(repo, csv("Soup,,,", "Stew,,,"), MAPPING, {}, {
      excludedRowIndexes: [1],
    });

    expect(summary.importedCount).toBe(1);
    // Not reported as skipped: the reader removed it deliberately, which is not
    // something that surprised the importer.
    expect(summary.skippedCount).toBe(0);
    expect(repo.listRecipes({ search: "", category: "", tag: "" }).map((r) => r.name)).toEqual(["Soup"]);
  });

  it("keeps each surviving row's own file row number", () => {
    const repo = new FakeHouseholdRepository();

    // Row 3 carries a name but no other field, so it is a real row rather than
    // a blank line — blank lines are dropped before numbering and would not
    // show the renumbering bug this guards against.
    const summary = importRecipesCsv(repo, csv("Soup,,,", "Broth,,,", "Stew,,,"), MAPPING, {}, {
      excludedRowIndexes: [0],
    });

    // Excluding the first row must not renumber the survivors to 2 and 3.
    expect(summary.results.map((r) => r.rowNumber)).toEqual([3, 4]);
  });
});

describe("testRecipeImport", () => {
  it("reports the parsed value, so a split that did not happen is visible", () => {
    const rows = testRecipeImport(
      csv('Soup,,"stock\\nonion",'),
      MAPPING,
      { "2": { delimiter: "\\n" } },
    );

    expect(rows).toHaveLength(1);
    const ingredients = rows[0].fields.find((f) => f.label === "Ingredients");
    expect(ingredients?.value).toBe("stock\nonion");
    expect(rows[0].label).toBe("Soup");
  });

  it("honours the selection", () => {
    const rows = testRecipeImport(csv("Soup,,,", "Stew,,,"), MAPPING, {}, [0]);

    expect(rows.map((row) => row.label)).toEqual(["Stew"]);
  });

  it("reports a row that would fail rather than omitting it", () => {
    const rows = testRecipeImport(csv(",no name,,"), MAPPING);

    expect(rows[0].error).toContain("Name");
    expect(rows[0].fields).toEqual([]);
  });

  it("writes nothing — running it leaves the box empty", () => {
    const repo = new FakeHouseholdRepository();

    // It takes no repository at all, so there is nothing it could write to;
    // this asserts the consequence rather than the signature.
    testRecipeImport(csv("Soup,,,", "Stew,,,"), MAPPING);

    expect(repo.listRecipes({ search: "", category: "", tag: "" })).toEqual([]);
  });
});

describe("planRecipeImport", () => {
  it("reports what an overwrite would do without writing anything", () => {
    const repo = new FakeHouseholdRepository();
    createRecipe(repo, { name: "Roast chicken", description: "Stale" });

    const plan = planRecipeImport(repo, csv("Roast chicken,Fresh,,", "Soup,,,", ",,,x"), MAPPING, {}, {
      overwrite: true,
    });

    expect(plan.updateCount).toBe(1);
    expect(plan.createCount).toBe(1);
    expect(plan.skipCount).toBe(1); // the nameless row
    expect(plan.rows[0]).toMatchObject({ rowNumber: 2, action: "update", name: "Roast chicken" });
    // The dry run wrote nothing.
    expect(repo.getRecipeById(1)?.description).toBe("Stale");
  });

  it("agrees with the import it precedes", () => {
    const repo = new FakeHouseholdRepository();
    createRecipe(repo, { name: "Soup" });
    const file = csv("Soup,,,", "Roast chicken,,,");

    const plan = planRecipeImport(repo, file, MAPPING);
    const summary = importRecipesCsv(repo, file, MAPPING);

    expect(plan.createCount).toBe(summary.importedCount);
    expect(plan.skipCount).toBe(summary.skippedCount);
  });
});
