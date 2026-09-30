import {
  createRecipe,
  deleteRecipe,
  getRecipe,
  incrementMadeCount,
  listRecipeCategories,
  listRecipeTags,
  listRecipes,
  toLines,
} from "@/lib/household";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

/**
 * The recipe box from the terminal — the same use-cases the web app calls.
 *
 *   recipes                                    list everything
 *   recipes --search chicken                   filter by name, description or ingredient
 *   recipes --category Dessert                 filter by category
 *   recipes --tag freezer                      filter by tag
 *   recipes --list-tags                        list the tags in use, with counts
 *   recipes --list-categories                  list the categories in use, with counts
 *   recipes --show 3                           print one recipe in full
 *   recipes --add "Roast chicken" --rating 9 --tags "sunday, easy"
 *   recipes --made 3                           record that you made it again
 *   recipes --delete 3
 *
 * Adding supports `--description`, `--ingredients`, `--directions`, `--notes`,
 * `--rating`, `--category`, `--source` and `--tags`. Multi-line fields take `\n` escapes, since
 * a real newline is awkward to pass through a shell.
 *
 * The picture is deliberately not settable here: the only sensible terminal form
 * would be a file path, and the use-case takes decoded bytes with a validated mime
 * type. That is a gap in convenience, not in reach — nothing else about a recipe is
 * web-only.
 */
export async function recipesCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const repo = deps.householdRepo;

  // The category vocabulary — what the editor's dropdown offers, so the same
  // list is reachable before typing `--category` on an add.
  if (flags["list-categories"] !== undefined) {
    const categories = listRecipeCategories(repo);
    if (categories.length === 0) {
      console.log("No categories yet.");
      return;
    }
    for (const entry of categories) console.log(`${entry.name}\t${entry.recipeCount}`);
    return;
  }

  // List the tag vocabulary. `--list-tags` rather than a bare `--tags`, which is
  // already this command's "set these tags" argument to `--add`: `parseFlags` takes
  // the next argv element as a flag's value, so one name cannot mean both.
  if (flags["list-tags"] !== undefined) {
    const tags = listRecipeTags(repo);
    if (tags.length === 0) {
      console.log("No tags yet.");
      return;
    }
    for (const tag of tags) console.log(`${tag.name}\t${tag.recipeCount}`);
    return;
  }

  // Print one recipe in full.
  if (flags.show) {
    const recipe = getRecipe(repo, Number(flags.show));
    if (!recipe) {
      console.error(`No recipe with id ${flags.show}.`);
      process.exitCode = 1;
      return;
    }
    console.log(`${recipe.name}  [#${recipe.id}]`);
    if (recipe.description) console.log(recipe.description);
    console.log(
      `\nRating: ${recipe.rating === null ? "unrated" : `${recipe.rating}/10`}` +
        `   Made: ${recipe.madeCount}` +
        (recipe.category ? `   Category: ${recipe.category}` : "") +
        (recipe.sourceUrl ? `   Source: ${recipe.sourceUrl}` : ""),
    );
    if (recipe.tags.length > 0) console.log(`Tags: ${recipe.tags.join(", ")}`);
    const ingredients = toLines(recipe.ingredients);
    if (ingredients.length > 0) {
      console.log("\nIngredients:");
      for (const line of ingredients) console.log(`  - ${line}`);
    }
    const directions = toLines(recipe.directions);
    if (directions.length > 0) {
      console.log("\nDirections:");
      directions.forEach((line, index) => console.log(`  ${index + 1}. ${line}`));
    }
    if (recipe.notes) console.log(`\nNotes:\n${recipe.notes}`);
    return;
  }

  // Record that it was made again.
  if (flags.made) {
    try {
      const madeCount = incrementMadeCount(repo, Number(flags.made));
      console.log(`Made ${madeCount} ${madeCount === 1 ? "time" : "times"}.`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Could not update that recipe.");
      process.exitCode = 1;
    }
    return;
  }

  if (flags.delete) {
    const id = Number(flags.delete);
    if (!getRecipe(repo, id)) {
      console.error(`No recipe with id ${id}.`);
      process.exitCode = 1;
      return;
    }
    deleteRecipe(repo, id);
    console.log(`Deleted recipe ${id}.`);
    return;
  }

  if (flags.add) {
    try {
      // `\n` rather than a real newline: the shell makes the latter awkward, and a
      // recipe's two long fields are exactly the ones that need line breaks.
      const unescape = (value: string | undefined) => (value ?? "").replace(/\\n/g, "\n");
      const recipe = createRecipe(repo, {
        name: flags.add,
        description: flags.description ?? "",
        ingredients: unescape(flags.ingredients),
        directions: unescape(flags.directions),
        notes: unescape(flags.notes),
        rating: flags.rating ?? "",
        category: flags.category ?? "",
        sourceUrl: flags.source ?? "",
        tags: (flags.tags ?? "")
          .split(",")
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0),
      });
      console.log(`Added "${recipe.name}" as #${recipe.id}.`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Could not add that recipe.");
      process.exitCode = 1;
    }
    return;
  }

  // Default: the list, same filters the web screen offers.
  const recipes = listRecipes(repo, {
    search: flags.search ?? "",
    category: flags.category ?? "",
    tag: flags.tag ?? "",
  });
  if (recipes.length === 0) {
    console.log("No recipes match.");
    return;
  }
  for (const recipe of recipes) {
    const rating = recipe.rating === null ? "  -" : `${String(recipe.rating).padStart(2, " ")}/10`;
    console.log(
      `#${String(recipe.id).padStart(3, " ")}  ${rating}  made ${String(recipe.madeCount).padStart(2, " ")}  ` +
        `${recipe.name}` +
        // Category before tags, and parenthesised rather than bracketed, so the
        // one-per-recipe value reads as distinct from the many-per-recipe list.
        `${recipe.category ? `  (${recipe.category})` : ""}` +
        `${recipe.tags.length > 0 ? `  [${recipe.tags.join(", ")}]` : ""}`,
    );
  }
  console.log(`\n${recipes.length} ${recipes.length === 1 ? "recipe" : "recipes"}.`);
}
