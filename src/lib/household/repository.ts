import type Database from "better-sqlite3";
import type { DecodedImage } from "@/lib/shared/image-upload";
import type { HouseholdRepository } from "./ports";
import type { BulkUpdateRecipesData, RecipeQuery, RecipeWriteData } from "./schema";
import type { Recipe, RecipeCategoryCount, RecipeSummary, RecipeTagCount } from "./types";

interface RecipeSummaryRow {
  id: number;
  name: string;
  description: string;
  made_count: number;
  rating: number | null;
  category: string;
  source_url: string;
  has_picture: number;
  tags: string | null;
  created_at: string;
  updated_at: string;
}

interface RecipeRow extends RecipeSummaryRow {
  ingredients: string;
  directions: string;
  notes: string;
}

interface ImageRow {
  picture: Buffer | null;
  picture_mime_type: string | null;
}

interface TagCountRow {
  name: string;
  recipe_count: number;
}

/**
 * The list projection.
 *
 * Note what is NOT selected: `picture`, `ingredients`, `directions`, `notes`.
 * `picture IS NOT NULL` is derived in SQL so a list of 200 recipes reads no
 * image bytes at all — the same discipline the texture and avatar tables use.
 *
 * Tags arrive as one comma-joined string from a correlated subquery rather than
 * a JOIN, because a JOIN would multiply the recipe row per tag and force a
 * group-by over every selected column.
 */
const SUMMARY_COLUMNS = `
  r.id,
  r.name,
  r.description,
  r.made_count,
  r.rating,
  r.category,
  r.source_url,
  r.picture IS NOT NULL AS has_picture,
  (SELECT group_concat(t.tag_name, ',')
     FROM (SELECT tag_name FROM hsh_recipe_tags
            WHERE recipe_id = r.id ORDER BY tag_name) AS t) AS tags,
  r.created_at,
  r.updated_at
`;

function toTags(joined: string | null): string[] {
  return joined ? joined.split(",").filter((tag) => tag.length > 0) : [];
}

function toSummary(row: RecipeSummaryRow): RecipeSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    madeCount: row.made_count,
    rating: row.rating,
    category: row.category,
    sourceUrl: row.source_url,
    hasPicture: row.has_picture === 1,
    tags: toTags(row.tags),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRecipe(row: RecipeRow): Recipe {
  return {
    ...toSummary(row),
    ingredients: row.ingredients,
    directions: row.directions,
    notes: row.notes,
  };
}

export class SqliteHouseholdRepository implements HouseholdRepository {
  constructor(private readonly db: Database.Database) {}

  listRecipes(query: RecipeQuery): RecipeSummary[] {
    const conditions: string[] = [];
    const params: Record<string, string> = {};

    if (query.search) {
      // Name, description and ingredients: "what's it called", "what is it" and
      // "what can I make with the chicken in the fridge" are the same question
      // asked three ways, and a cook asks all three of this one box.
      conditions.push(`(
        r.name LIKE :search COLLATE NOCASE
        OR r.description LIKE :search COLLATE NOCASE
        OR r.ingredients LIKE :search COLLATE NOCASE
      )`);
      params.search = `%${query.search}%`;
    }

    if (query.category) {
      // NOCASE so a bookmarked ?category=dessert still finds the "Dessert"
      // recipes. `idx_hsh_recipes_category` is declared with the same collation
      // so this uses the index rather than scanning.
      conditions.push(`r.category = :category COLLATE NOCASE`);
      params.category = query.category;
    }

    if (query.tag) {
      conditions.push(
        `EXISTS (SELECT 1 FROM hsh_recipe_tags WHERE recipe_id = r.id AND tag_name = :tag)`,
      );
      params.tag = query.tag;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT ${SUMMARY_COLUMNS} FROM hsh_recipes AS r ${where} ORDER BY r.name COLLATE NOCASE`,
      )
      .all(params) as RecipeSummaryRow[];

    return rows.map(toSummary);
  }

  getRecipeById(id: number): Recipe | undefined {
    const row = this.db
      .prepare(
        `SELECT ${SUMMARY_COLUMNS}, r.ingredients, r.directions, r.notes
           FROM hsh_recipes AS r WHERE r.id = ?`,
      )
      .get(id) as RecipeRow | undefined;

    return row ? toRecipe(row) : undefined;
  }

  createRecipe(input: RecipeWriteData): Recipe {
    const create = this.db.transaction((data: RecipeWriteData): number => {
      const result = this.db
        .prepare(
          `INSERT INTO hsh_recipes
             (name, description, ingredients, directions, notes, made_count, rating,
              category, source_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          data.name,
          data.description,
          data.ingredients,
          data.directions,
          data.notes,
          data.madeCount,
          data.rating,
          data.category,
          data.sourceUrl,
        );

      const id = Number(result.lastInsertRowid);
      this.writeTags(id, data.tags);
      return id;
    });

    const id = create(input);
    // Non-null: the row was just inserted inside the transaction above.
    return this.getRecipeById(id)!;
  }

  updateRecipe(id: number, input: RecipeWriteData): Recipe | undefined {
    const update = this.db.transaction((data: RecipeWriteData): boolean => {
      const result = this.db
        .prepare(
          `UPDATE hsh_recipes
              SET name = ?, description = ?, ingredients = ?, directions = ?,
                  notes = ?, made_count = ?, rating = ?, category = ?, source_url = ?
            WHERE id = ?`,
        )
        .run(
          data.name,
          data.description,
          data.ingredients,
          data.directions,
          data.notes,
          data.madeCount,
          data.rating,
          data.category,
          data.sourceUrl,
          id,
        );

      if (result.changes === 0) return false;

      // Tags are replaced wholesale rather than diffed: the set is tiny, and a
      // delete-then-insert cannot leave a stale row behind the way a partial
      // diff can.
      this.db.prepare(`DELETE FROM hsh_recipe_tags WHERE recipe_id = ?`).run(id);
      this.writeTags(id, data.tags);
      return true;
    });

    return update(input) ? this.getRecipeById(id) : undefined;
  }

  deleteRecipe(id: number): void {
    // No DB-level foreign keys in this schema (the jrn_/att_ convention), so the
    // cascade is the repository's job.
    const remove = this.db.transaction((recipeId: number) => {
      this.db.prepare(`DELETE FROM hsh_recipe_tags WHERE recipe_id = ?`).run(recipeId);
      this.db.prepare(`DELETE FROM hsh_recipes WHERE id = ?`).run(recipeId);
    });
    remove(id);
  }

  deleteRecipes(ids: number[]): number {
    const removeMany = this.db.transaction((recipeIds: number[]): number => {
      const deleteTags = this.db.prepare(`DELETE FROM hsh_recipe_tags WHERE recipe_id = ?`);
      const deleteRecipe = this.db.prepare(`DELETE FROM hsh_recipes WHERE id = ?`);

      let removed = 0;
      for (const recipeId of recipeIds) {
        deleteTags.run(recipeId);
        // An id that no longer exists contributes 0 — a stale selection is not
        // an error, so the caller is told what actually happened instead.
        removed += deleteRecipe.run(recipeId).changes;
      }
      return removed;
    });

    return removeMany(ids);
  }

  bulkUpdateRecipes(input: BulkUpdateRecipesData): number {
    const apply = this.db.transaction((data: BulkUpdateRecipesData): number => {
      // Only the keys actually present are written. `undefined` means "leave
      // alone"; `null` on rating means "clear it", and the two must not merge.
      const assignments: string[] = [];
      const values: (string | number | null)[] = [];

      if (data.rating !== undefined) {
        assignments.push("rating = ?");
        values.push(data.rating);
      }
      if (data.madeCount !== undefined) {
        assignments.push("made_count = ?");
        values.push(data.madeCount);
      }
      if (data.category !== undefined) {
        assignments.push("category = ?");
        values.push(data.category);
      }
      if (data.sourceUrl !== undefined) {
        assignments.push("source_url = ?");
        values.push(data.sourceUrl);
      }

      let changed = 0;

      if (assignments.length > 0) {
        const statement = this.db.prepare(
          `UPDATE hsh_recipes SET ${assignments.join(", ")} WHERE id = ?`,
        );
        for (const id of data.ids) changed += statement.run(...values, id).changes;
      }

      if (data.tagEdit) {
        const { mode, tags } = data.tagEdit;
        const deleteAll = this.db.prepare(`DELETE FROM hsh_recipe_tags WHERE recipe_id = ?`);
        const deleteOne = this.db.prepare(
          `DELETE FROM hsh_recipe_tags WHERE recipe_id = ? AND tag_name = ?`,
        );
        const exists = this.db.prepare(`SELECT 1 FROM hsh_recipes WHERE id = ?`);

        for (const id of data.ids) {
          // Checked because a tag edit on a deleted id would otherwise insert
          // orphan rows that no recipe will ever read or clean up.
          if (!exists.get(id)) continue;
          if (mode === "remove") {
            for (const tag of tags) deleteOne.run(id, tag);
          } else {
            // `replace` clears first, then writes; `add` just writes.
            if (mode === "replace") deleteAll.run(id);
            this.writeTags(id, tags);
          }
        }

        // A tag-only edit still counts as touching every live row, so the
        // caller can report "12 updated" rather than "0 updated".
        if (assignments.length === 0) {
          changed = data.ids.filter((id) => exists.get(id)).length;
        }
      }

      return changed;
    });

    return apply(input);
  }

  incrementMadeCount(id: number): number | undefined {
    const result = this.db
      .prepare(`UPDATE hsh_recipes SET made_count = made_count + 1 WHERE id = ?`)
      .run(id);
    if (result.changes === 0) return undefined;

    const row = this.db.prepare(`SELECT made_count FROM hsh_recipes WHERE id = ?`).get(id) as
      | { made_count: number }
      | undefined;
    return row?.made_count;
  }

  getRecipeImage(id: number): DecodedImage | undefined {
    const row = this.db
      .prepare(`SELECT picture, picture_mime_type FROM hsh_recipes WHERE id = ?`)
      .get(id) as ImageRow | undefined;

    if (!row?.picture || !row.picture_mime_type) return undefined;
    return { data: row.picture, mimeType: row.picture_mime_type };
  }

  setRecipeImage(id: number, image: DecodedImage): void {
    this.db
      .prepare(`UPDATE hsh_recipes SET picture = ?, picture_mime_type = ? WHERE id = ?`)
      .run(image.data, image.mimeType, id);
  }

  clearRecipeImage(id: number): void {
    this.db
      .prepare(`UPDATE hsh_recipes SET picture = NULL, picture_mime_type = NULL WHERE id = ?`)
      .run(id);
  }

  listRecipeTags(): RecipeTagCount[] {
    const rows = this.db
      .prepare(
        `SELECT tag_name AS name, COUNT(*) AS recipe_count
           FROM hsh_recipe_tags
          GROUP BY tag_name
          ORDER BY tag_name`,
      )
      .all() as TagCountRow[];

    return rows.map((row) => ({ name: row.name, recipeCount: row.recipe_count }));
  }

  listRecipeCategories(): RecipeCategoryCount[] {
    // From the recipes themselves, not a catalog table — so this can never
    // offer a category nothing uses, nor miss one that something does.
    //
    // `GROUP BY ... COLLATE NOCASE` folds "Dessert" and "dessert" into one
    // entry; `MIN(category)` then picks a single spelling to show for that
    // group deterministically, rather than whichever row the engine happened
    // to reach first. Blank is excluded: "uncategorised" is the absence of a
    // category, not one of the options.
    const rows = this.db
      .prepare(
        `SELECT MIN(category) AS name, COUNT(*) AS recipe_count
           FROM hsh_recipes
          WHERE category <> ''
          GROUP BY category COLLATE NOCASE
          ORDER BY name COLLATE NOCASE`,
      )
      .all() as TagCountRow[];

    return rows.map((row) => ({ name: row.name, recipeCount: row.recipe_count }));
  }

  findRecipeIdsByName(name: string): number[] {
    // COLLATE NOCASE, matching the list's own ordering and the way tags are
    // folded: "Roast Chicken" from the sheet is the recipe already stored as
    // "roast chicken", not a second one.
    const rows = this.db
      .prepare(`SELECT id FROM hsh_recipes WHERE name = ? COLLATE NOCASE ORDER BY id`)
      .all(name) as { id: number }[];

    return rows.map((row) => row.id);
  }

  /** `OR IGNORE` leans on the unique index, so re-adding a tag is a no-op. */
  private writeTags(recipeId: number, tags: string[]): void {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO hsh_recipe_tags (recipe_id, tag_name) VALUES (?, ?)`,
    );
    for (const tag of tags) insert.run(recipeId, tag);
  }
}
