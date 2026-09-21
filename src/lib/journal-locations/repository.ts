import type Database from "better-sqlite3";
import type { SavedLocationRepository } from "./ports";
import {
  locationTaxonomySchema,
  savedLocationSchema,
  type LocationSearchCriteria,
  type LocationTaxonomyWriteData,
  type LocationWriteData,
} from "./schema";
import type {
  EntryLocationSource,
  LocationCategory,
  LocationTag,
  LocationTaxonomyCount,
  SavedLocation,
  SavedLocationWithUsage,
} from "./types";

interface LocationRow {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  description: string;
  address: string;
  created_at: string;
  updated_at: string;
  usage_count: number;
}

interface TaxonomyRow {
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

interface LinkRow {
  location_id: number;
  name: string;
}

interface CountRow {
  name: string;
  count: number;
}

/**
 * Every read selects the usage count in the same statement.
 *
 * A correlated subquery rather than a LEFT JOIN + GROUP BY: the join would
 * multiply the location rows before collapsing them, and this rides
 * idx_jrn_entry_locations_saved_location_id directly. The picker ignores the
 * number, which costs it one indexed count per row — cheaper than a second
 * query shape to maintain.
 */
const LOCATION_COLUMNS = `
  l.id, l.name, l.latitude, l.longitude, l.description, l.address,
  l.created_at, l.updated_at,
  (SELECT COUNT(*) FROM jrn_entry_locations el WHERE el.saved_location_id = l.id) AS usage_count
`;

/** Name first, then id — so the list reads alphabetically and ties are stable. */
const LOCATION_ORDER = "ORDER BY l.name COLLATE NOCASE ASC, l.id ASC";

const TAXONOMY_COLUMNS = "name, description, created_at, updated_at";

function taxonomyToDomain(row: TaxonomyRow): LocationCategory {
  return locationTaxonomySchema.parse({
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class SqliteSavedLocationRepository implements SavedLocationRepository {
  constructor(private readonly db: Database.Database) {}

  // --- Places ---------------------------------------------------------------

  listLocations(): SavedLocationWithUsage[] {
    const rows = this.db
      .prepare(`SELECT ${LOCATION_COLUMNS} FROM jrn_locations l ${LOCATION_ORDER}`)
      .all() as LocationRow[];
    return this.attachTaxonomy(rows);
  }

  getLocationById(id: number): SavedLocation | undefined {
    const row = this.db
      .prepare(`SELECT ${LOCATION_COLUMNS} FROM jrn_locations l WHERE l.id = ?`)
      .get(id) as LocationRow | undefined;
    if (!row) return undefined;
    return this.attachTaxonomy([row])[0];
  }

  searchLocations(criteria: LocationSearchCriteria): SavedLocationWithUsage[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (criteria.query !== "") {
      // LIKE with no ESCAPE, so a query containing % or _ matches loosely rather
      // than erroring. That is the right call for a search box: the wildcard is
      // a surprise, not a failure, and these are place names not patterns.
      clauses.push(
        "(l.name LIKE ? COLLATE NOCASE OR l.description LIKE ? COLLATE NOCASE OR l.address LIKE ? COLLATE NOCASE)",
      );
      const like = `%${criteria.query}%`;
      params.push(like, like, like);
    }

    // AND semantics: a location must carry *every* selected category. Expressed
    // as one EXISTS per name rather than `IN (...) HAVING COUNT(*) = n`, which
    // reads clearly and lets SQLite use the unique index on each probe.
    for (const category of criteria.categories) {
      clauses.push(
        "EXISTS (SELECT 1 FROM jrn_location_category_links cl WHERE cl.location_id = l.id AND cl.category_name = ? COLLATE NOCASE)",
      );
      params.push(category);
    }
    for (const tag of criteria.tags) {
      clauses.push(
        "EXISTS (SELECT 1 FROM jrn_location_tag_links tl WHERE tl.location_id = l.id AND tl.tag_name = ? COLLATE NOCASE)",
      );
      params.push(tag);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = criteria.limit === undefined ? "" : `LIMIT ${criteria.limit}`;
    const rows = this.db
      .prepare(`SELECT ${LOCATION_COLUMNS} FROM jrn_locations l ${where} ${LOCATION_ORDER} ${limit}`)
      .all(...params) as LocationRow[];
    return this.attachTaxonomy(rows);
  }

  createLocation(input: LocationWriteData): SavedLocation {
    const id = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT INTO jrn_locations (name, latitude, longitude, description, address)
           VALUES (@name, @latitude, @longitude, @description, @address)`,
        )
        .run({
          name: input.name,
          latitude: input.latitude,
          longitude: input.longitude,
          description: input.description,
          address: input.address,
        });
      const locationId = Number(result.lastInsertRowid);
      this.replaceLinks(locationId, input);
      return locationId;
    })();

    const created = this.getLocationById(id);
    if (!created) throw new Error("Failed to read back newly created saved location.");
    return created;
  }

  updateLocation(id: number, input: LocationWriteData): SavedLocation {
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE jrn_locations SET
             name = @name, latitude = @latitude, longitude = @longitude,
             description = @description, address = @address
           WHERE id = @id`,
        )
        .run({
          id,
          name: input.name,
          latitude: input.latitude,
          longitude: input.longitude,
          description: input.description,
          address: input.address,
        });
      this.replaceLinks(id, input);
    })();

    const updated = this.getLocationById(id);
    if (!updated) throw new Error(`Failed to read back updated saved location ${id}.`);
    return updated;
  }

  deleteLocation(id: number): void {
    // The link rows and the detaching of entry locations are both done by the
    // schema's foreign keys (CASCADE and SET NULL respectively) — see migration
    // 0101. This is one statement on purpose; doing it by hand here would be a
    // second, divergent copy of that policy.
    this.db.prepare("DELETE FROM jrn_locations WHERE id = ?").run(id);
  }

  countUsage(id: number): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM jrn_entry_locations WHERE saved_location_id = ?")
      .get(id) as { count: number };
    return row.count;
  }

  mergeLocations(keepId: number, removeIds: readonly number[]): number {
    // One transaction, for the reason spelled out on the port: a delete that
    // lands without its repoint detaches entries silently.
    return this.db.transaction(() => {
      const placeholders = removeIds.map(() => "?").join(", ");

      // Union the losers' taxonomy onto the survivor before the rows go. `OR
      // IGNORE` leans on idx_jrn_location_category_links_unique so a category
      // both copies already carry stays one link rather than raising.
      this.db
        .prepare(
          `INSERT OR IGNORE INTO jrn_location_category_links (location_id, category_name)
           SELECT ?, category_name FROM jrn_location_category_links
           WHERE location_id IN (${placeholders})`,
        )
        .run(keepId, ...removeIds);
      this.db
        .prepare(
          `INSERT OR IGNORE INTO jrn_location_tag_links (location_id, tag_name)
           SELECT ?, tag_name FROM jrn_location_tag_links
           WHERE location_id IN (${placeholders})`,
        )
        .run(keepId, ...removeIds);

      // The repoint. This is the whole point of the operation: these entries
      // would otherwise be detached by ON DELETE SET NULL a moment from now.
      const moved = this.db
        .prepare(
          `UPDATE jrn_entry_locations SET saved_location_id = ?
           WHERE saved_location_id IN (${placeholders})`,
        )
        .run(keepId, ...removeIds);

      // The link rows go with them by ON DELETE CASCADE, as in deleteLocation.
      this.db.prepare(`DELETE FROM jrn_locations WHERE id IN (${placeholders})`).run(...removeIds);

      return moved.changes;
    })();
  }

  linkEntryLocation(entryLocationId: number, savedLocationId: number): void {
    this.db
      .prepare("UPDATE jrn_entry_locations SET saved_location_id = ? WHERE id = ?")
      .run(savedLocationId, entryLocationId);
  }

  // --- Importing from existing entries ---------------------------------------

  listEntryLocationsForImport(): EntryLocationSource[] {
    // Joined to jrn_entries for place_name, which lives on the entry rather
    // than the location. INNER JOIN: a location whose entry is gone is not
    // reachable in the app either, so it is not a place worth importing.
    const rows = this.db
      .prepare(
        `SELECT el.id            AS entry_location_id,
                el.latitude      AS latitude,
                el.longitude     AS longitude,
                el.location_name AS location_name,
                e.place_name     AS place_name
           FROM jrn_entry_locations el
           JOIN jrn_entries e ON e.id = el.entry_id
          ORDER BY e.entry_date ASC, el.sort_order ASC, el.id ASC`,
      )
      .all() as {
      entry_location_id: number;
      latitude: number;
      longitude: number;
      location_name: string;
      place_name: string;
    }[];
    return rows.map((row) => ({
      entryLocationId: row.entry_location_id,
      latitude: row.latitude,
      longitude: row.longitude,
      locationName: row.location_name,
      placeName: row.place_name,
    }));
  }

  listLocationCoordinates(): { latitude: number; longitude: number }[] {
    return this.db
      .prepare("SELECT latitude, longitude FROM jrn_locations")
      .all() as { latitude: number; longitude: number }[];
  }

  // --- Taxonomy -------------------------------------------------------------

  listCategories(): LocationCategory[] {
    const rows = this.db
      .prepare(
        `SELECT ${TAXONOMY_COLUMNS} FROM jrn_location_categories ORDER BY name COLLATE NOCASE ASC`,
      )
      .all() as TaxonomyRow[];
    return rows.map(taxonomyToDomain);
  }

  getCategoryByName(name: string): LocationCategory | undefined {
    const row = this.db
      .prepare(
        `SELECT ${TAXONOMY_COLUMNS} FROM jrn_location_categories WHERE name = ? COLLATE NOCASE`,
      )
      .get(name) as TaxonomyRow | undefined;
    return row ? taxonomyToDomain(row) : undefined;
  }

  upsertCategory(input: LocationTaxonomyWriteData): LocationCategory {
    this.db
      .prepare(
        `INSERT INTO jrn_location_categories (name, description) VALUES (@name, @description)
         ON CONFLICT(name) DO UPDATE SET description = excluded.description`,
      )
      .run(input);
    const saved = this.getCategoryByName(input.name);
    if (!saved) throw new Error(`Failed to read back location category "${input.name}".`);
    return saved;
  }

  deleteCategory(name: string): void {
    this.db.transaction(() => {
      // Explicit, unlike deleteLocation: the link table's FK to the taxonomy is
      // ON UPDATE CASCADE (for renames) but has no ON DELETE clause, so the
      // pairings would block the delete rather than follow it.
      this.db
        .prepare("DELETE FROM jrn_location_category_links WHERE category_name = ? COLLATE NOCASE")
        .run(name);
      this.db
        .prepare("DELETE FROM jrn_location_categories WHERE name = ? COLLATE NOCASE")
        .run(name);
    })();
  }

  countLocationsByCategory(): LocationTaxonomyCount[] {
    const rows = this.db
      .prepare(
        `SELECT c.name AS name,
                (SELECT COUNT(*) FROM jrn_location_category_links cl WHERE cl.category_name = c.name) AS count
           FROM jrn_location_categories c
          ORDER BY c.name COLLATE NOCASE ASC`,
      )
      .all() as CountRow[];
    return rows.map((row) => ({ name: row.name, count: row.count }));
  }

  listTags(): LocationTag[] {
    const rows = this.db
      .prepare(
        `SELECT ${TAXONOMY_COLUMNS} FROM jrn_location_tags ORDER BY name COLLATE NOCASE ASC`,
      )
      .all() as TaxonomyRow[];
    return rows.map(taxonomyToDomain);
  }

  getTagByName(name: string): LocationTag | undefined {
    const row = this.db
      .prepare(`SELECT ${TAXONOMY_COLUMNS} FROM jrn_location_tags WHERE name = ? COLLATE NOCASE`)
      .get(name) as TaxonomyRow | undefined;
    return row ? taxonomyToDomain(row) : undefined;
  }

  upsertTag(input: LocationTaxonomyWriteData): LocationTag {
    this.db
      .prepare(
        `INSERT INTO jrn_location_tags (name, description) VALUES (@name, @description)
         ON CONFLICT(name) DO UPDATE SET description = excluded.description`,
      )
      .run(input);
    const saved = this.getTagByName(input.name);
    if (!saved) throw new Error(`Failed to read back location tag "${input.name}".`);
    return saved;
  }

  deleteTag(name: string): void {
    this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM jrn_location_tag_links WHERE tag_name = ? COLLATE NOCASE")
        .run(name);
      this.db.prepare("DELETE FROM jrn_location_tags WHERE name = ? COLLATE NOCASE").run(name);
    })();
  }

  countLocationsByTag(): LocationTaxonomyCount[] {
    const rows = this.db
      .prepare(
        `SELECT t.name AS name,
                (SELECT COUNT(*) FROM jrn_location_tag_links tl WHERE tl.tag_name = t.name) AS count
           FROM jrn_location_tags t
          ORDER BY t.name COLLATE NOCASE ASC`,
      )
      .all() as CountRow[];
    return rows.map((row) => ({ name: row.name, count: row.count }));
  }

  // --- Internals ------------------------------------------------------------

  /**
   * Fills in each row's category and tag names with two queries for the whole
   * page, not two per row.
   *
   * The alternative — a `group_concat` in the main select — would need a
   * separator that can't appear in a name, and names are free text.
   */
  private attachTaxonomy(rows: LocationRow[]): SavedLocationWithUsage[] {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const placeholders = ids.map(() => "?").join(", ");

    const categoryRows = this.db
      .prepare(
        `SELECT location_id, category_name AS name FROM jrn_location_category_links
          WHERE location_id IN (${placeholders}) ORDER BY category_name COLLATE NOCASE ASC`,
      )
      .all(...ids) as LinkRow[];
    const tagRows = this.db
      .prepare(
        `SELECT location_id, tag_name AS name FROM jrn_location_tag_links
          WHERE location_id IN (${placeholders}) ORDER BY tag_name COLLATE NOCASE ASC`,
      )
      .all(...ids) as LinkRow[];

    const categoriesById = groupByLocation(categoryRows);
    const tagsById = groupByLocation(tagRows);

    return rows.map((row) => ({
      ...savedLocationSchema.parse({
        id: row.id,
        name: row.name,
        latitude: row.latitude,
        longitude: row.longitude,
        description: row.description,
        address: row.address,
        categories: categoriesById.get(row.id) ?? [],
        tags: tagsById.get(row.id) ?? [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
      usageCount: row.usage_count,
    }));
  }

  /** Replaces a location's category and tag links. Callers hold the transaction. */
  private replaceLinks(locationId: number, input: LocationWriteData): void {
    this.db.prepare("DELETE FROM jrn_location_category_links WHERE location_id = ?").run(locationId);
    this.db.prepare("DELETE FROM jrn_location_tag_links WHERE location_id = ?").run(locationId);

    const insertCategory = this.db.prepare(
      "INSERT INTO jrn_location_category_links (location_id, category_name) VALUES (?, ?)",
    );
    for (const name of input.categories) insertCategory.run(locationId, name);

    const insertTag = this.db.prepare(
      "INSERT INTO jrn_location_tag_links (location_id, tag_name) VALUES (?, ?)",
    );
    for (const name of input.tags) insertTag.run(locationId, name);
  }
}

function groupByLocation(rows: LinkRow[]): Map<number, string[]> {
  const grouped = new Map<number, string[]>();
  for (const row of rows) {
    const existing = grouped.get(row.location_id);
    if (existing) existing.push(row.name);
    else grouped.set(row.location_id, [row.name]);
  }
  return grouped;
}
