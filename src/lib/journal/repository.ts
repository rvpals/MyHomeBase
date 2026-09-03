import type Database from "better-sqlite3";
import type { JournalEntryMatchKey, JournalRepository } from "./ports";
import {
  entryLocationSchema,
  journalCategorySchema,
  journalEntrySchema,
  journalTagSchema,
} from "./schema";
import type { DecodedImage } from "@/lib/shared/image-upload";
import { buildFilterSql } from "./filters";
import { parseStoredJournalFilter, parseStoredPrefillFields } from "./schema";
import type {
  EntryWriteData,
  JournalFilterWriteData,
  PrefillTemplateWriteData,
  UpsertCategoryInput,
  UpsertTagInput,
} from "./schema";
import type {
  EntryLocation,
  JournalCategory,
  JournalEntry,
  JournalEntryNeighbors,
  JournalEntryRef,
  JournalFilter,
  JournalPrefillField,
  JournalPrefillTemplate,
  JournalTag,
  JournalTaxonomyCount,
  JournalTaxonomyIcon,
  RecycledJournalEntry,
  SavedJournalFilter,
} from "./types";

interface EntryRow {
  id: number;
  entry_date: string;
  entry_time: string;
  title: string;
  content: string;
  place_name: string;
  weather_temp: number | null;
  weather_unit: string | null;
  weather_description: string | null;
  weather_code: number | null;
  is_pinned: number;
  is_locked: number;
  created_at: string;
  updated_at: string;
}

interface LocationRow {
  id: number;
  entry_id: number;
  latitude: number;
  longitude: number;
  location_name: string;
  sort_order: number;
}

interface PairingRow {
  entry_id: number;
  name: string;
}

// The bin's parent row (migration 0079). Same columns as EntryRow plus the two
// the bin owns: `entry_id` (the id it had in jrn_entries) and `deleted_at`.
interface RecycledEntryRow extends EntryRow {
  entry_id: number;
  deleted_at: string;
}

// Child rows in the bin key on the bin's own id, not the original entry id.
interface RecycledPairingRow {
  recycled_entry_id: number;
  name: string;
}

interface RecycledLocationRow {
  id: number;
  recycled_entry_id: number;
  latitude: number;
  longitude: number;
  location_name: string;
  sort_order: number;
}

interface TaxonomyRow {
  name: string;
  description: string;
  icon_image_mime_type: string | null;
  created_at: string;
  updated_at: string;
}

// Spelled out rather than SELECT *, so adding a column later can't silently
// widen every read of this table.
const PREFILL_TEMPLATE_COLUMNS =
  "SELECT id, name, description, is_enabled, fields_json, created_at, updated_at";

interface PrefillTemplateRow {
  id: number;
  name: string;
  description: string;
  is_enabled: number;
  fields_json: string;
  created_at: string;
  updated_at: string;
}

// parseStoredPrefillFields is deliberately forgiving (see its doc): a row whose
// JSON can't be read comes back with no fields rather than throwing, so one bad
// template doesn't take the Templates screen down with it.
function prefillTemplateToDomain(row: PrefillTemplateRow): JournalPrefillTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isEnabled: row.is_enabled === 1,
    fields: parseStoredPrefillFields(row.fields_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface SavedFilterRow {
  id: number;
  name: string;
  filter_json: string;
  created_at: string;
  updated_at: string;
}

// parseStoredJournalFilter is deliberately forgiving (see its doc): a row whose
// JSON can't be read comes back as an empty filter rather than throwing, so one
// bad row can't take down the Entries screen.
function savedFilterToDomain(row: SavedFilterRow): SavedJournalFilter {
  return {
    id: row.id,
    name: row.name,
    filter: parseStoredJournalFilter(row.filter_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Every normal category/tag read names its columns and omits icon_image, so the
// icon bytes never ride along with a list or a page render. Only
// getCategoryIcon/setCategoryIcon (and the tag equivalents) touch that column.
const TAXONOMY_COLUMNS = "name, description, icon_image_mime_type, created_at, updated_at";

function locationToDomain(row: LocationRow): EntryLocation {
  return entryLocationSchema.parse({
    id: row.id,
    entryId: row.entry_id,
    latitude: row.latitude,
    longitude: row.longitude,
    locationName: row.location_name,
    sortOrder: row.sort_order,
  });
}

function categoryToDomain(row: TaxonomyRow): JournalCategory {
  return journalCategorySchema.parse({
    name: row.name,
    description: row.description,
    iconMimeType: row.icon_image_mime_type ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function tagToDomain(row: TaxonomyRow): JournalTag {
  return journalTagSchema.parse({
    name: row.name,
    description: row.description,
    iconMimeType: row.icon_image_mime_type ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function entryToDomain(
  row: EntryRow,
  categories: string[],
  tags: string[],
  locations: EntryLocation[],
): JournalEntry {
  // weather_temp is the anchor: an entry with weather always has a temperature,
  // so its presence tells us whether to build the weather object at all.
  const weather =
    row.weather_temp === null
      ? undefined
      : {
          temp: row.weather_temp,
          unit: row.weather_unit ?? "",
          description: row.weather_description ?? "",
          code: row.weather_code ?? 0,
        };

  return journalEntrySchema.parse({
    id: row.id,
    date: row.entry_date,
    time: row.entry_time,
    title: row.title,
    content: row.content,
    placeName: row.place_name,
    weather,
    isPinned: row.is_pinned === 1,
    isLocked: row.is_locked === 1,
    categories,
    tags,
    locations,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

// The real repository. Every jrn_ table access lives here; swapping the database
// (or faking it in tests) leaves the use-cases untouched.
export class SqliteJournalRepository implements JournalRepository {
  constructor(private db: Database.Database) {}

  listEntries(): JournalEntry[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM jrn_entries ORDER BY entry_date DESC, entry_time DESC, id DESC",
      )
      .all() as EntryRow[];

    // Every entry, so the child reads need no id filter.
    return this.hydrateEntries(rows, "all");
  }

  listRecentEntries(limit: number): JournalEntry[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM jrn_entries ORDER BY entry_date DESC, entry_time DESC, id DESC LIMIT ?",
      )
      .all(limit) as EntryRow[];
    return this.hydrateEntries(rows);
  }

  listEntriesByMonthDay(monthDay: string): JournalEntry[] {
    // entry_date is stored as YYYY-MM-DD text, so the month/day is a fixed-offset
    // substring. This can't use idx_jrn_entries_entry_date (it's not a prefix
    // match), but the table is small enough that a scan is fine here.
    const rows = this.db
      .prepare(
        `SELECT * FROM jrn_entries
         WHERE substr(entry_date, 6, 5) = ?
         ORDER BY entry_date DESC, entry_time DESC, id DESC`,
      )
      .all(monthDay) as EntryRow[];

    return this.hydrateEntries(rows);
  }

  listEntriesInDateRange(startDate: string, endDate: string): JournalEntry[] {
    // A BETWEEN on entry_date itself, so idx_jrn_entries_entry_date applies —
    // the reason the calendar reads a range rather than filtering listEntries()
    // in memory. Ascending, because a calendar reads top-to-bottom through time.
    const rows = this.db
      .prepare(
        `SELECT * FROM jrn_entries
         WHERE entry_date BETWEEN ? AND ?
         ORDER BY entry_date ASC, entry_time ASC, id ASC`,
      )
      .all(startDate, endDate) as EntryRow[];

    return this.hydrateEntries(rows);
  }

  searchEntries(term: string, limit: number): JournalEntry[] {
    // LIKE is ASCII case-insensitive by default. The term is escaped so a user
    // typing "%", "_", or "\" searches for the literal character rather than a
    // wildcard — and the ESCAPE clause tells SQLite that "\" is the escape char.
    const escaped = term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    const pattern = `%${escaped}%`;
    const rows = this.db
      .prepare(
        `SELECT e.*
         FROM jrn_entries e
         WHERE e.entry_date LIKE ? ESCAPE '\\'
            OR e.entry_time LIKE ? ESCAPE '\\'
            OR e.title LIKE ? ESCAPE '\\'
            OR e.content LIKE ? ESCAPE '\\'
            OR e.place_name LIKE ? ESCAPE '\\'
            OR EXISTS (SELECT 1 FROM jrn_entry_categories c
                       WHERE c.entry_id = e.id AND c.category_name LIKE ? ESCAPE '\\')
            OR EXISTS (SELECT 1 FROM jrn_entry_tags t
                       WHERE t.entry_id = e.id AND t.tag_name LIKE ? ESCAPE '\\')
         ORDER BY e.entry_date DESC, e.entry_time DESC, e.id DESC
         LIMIT ?`,
      )
      .all(pattern, pattern, pattern, pattern, pattern, pattern, pattern, limit) as EntryRow[];

    return this.hydrateEntries(rows);
  }

  findEntries(filter: JournalFilter, limit: number): JournalEntry[] {
    const compiled = buildFilterSql(filter);
    // No WHERE at all when nothing narrows, rather than a synthetic `1=1` — an
    // empty filter is a real state ("All entries") and this keeps the query the
    // planner sees identical to listRecentEntries in that case.
    const where = compiled ? `WHERE ${compiled.sql}` : "";
    const rows = this.db
      .prepare(
        `SELECT e.*
         FROM jrn_entries e
         ${where}
         ORDER BY e.entry_date DESC, e.entry_time DESC, e.id DESC
         LIMIT @__limit`,
      )
      // Named params throughout: buildFilterSql generates its own keys, and
      // `__limit` is prefixed so it can't collide with one of them.
      .all({ ...(compiled?.params ?? {}), __limit: limit }) as EntryRow[];

    return this.hydrateEntries(rows);
  }

  listFilters(): SavedJournalFilter[] {
    const rows = this.db
      .prepare("SELECT id, name, filter_json, created_at, updated_at FROM jrn_saved_filters ORDER BY name ASC")
      .all() as SavedFilterRow[];
    return rows.map(savedFilterToDomain);
  }

  getFilterById(id: number): SavedJournalFilter | undefined {
    const row = this.db
      .prepare("SELECT id, name, filter_json, created_at, updated_at FROM jrn_saved_filters WHERE id = ?")
      .get(id) as SavedFilterRow | undefined;
    return row ? savedFilterToDomain(row) : undefined;
  }

  saveFilter(input: JournalFilterWriteData): SavedJournalFilter {
    // Upsert by name — UNIQUE (name) makes this one statement instead of a
    // create/update pair. See migration 0043.
    this.db
      .prepare(
        `INSERT INTO jrn_saved_filters (name, filter_json) VALUES (@name, @filterJson)
         ON CONFLICT(name) DO UPDATE SET filter_json = excluded.filter_json`,
      )
      .run({ name: input.name, filterJson: JSON.stringify(input.filter) });

    const saved = this.db
      .prepare("SELECT id, name, filter_json, created_at, updated_at FROM jrn_saved_filters WHERE name = ?")
      .get(input.name) as SavedFilterRow | undefined;
    if (!saved) throw new Error(`Failed to read back saved filter "${input.name}".`);
    return savedFilterToDomain(saved);
  }

  deleteFilter(id: number): void {
    this.db.prepare("DELETE FROM jrn_saved_filters WHERE id = ?").run(id);
  }

  getEntryById(id: number): JournalEntry | undefined {
    const row = this.db.prepare("SELECT * FROM jrn_entries WHERE id = ?").get(id) as
      | EntryRow
      | undefined;
    if (!row) return undefined;
    return entryToDomain(
      row,
      this.categoryNamesFor(id),
      this.tagNamesFor(id),
      this.locationsFor(id),
    );
  }

  getEntryNeighbors(entryId: number): JournalEntryNeighbors {
    const anchor = this.db
      .prepare("SELECT id, entry_date, entry_time FROM jrn_entries WHERE id = ?")
      .get(entryId) as Pick<EntryRow, "id" | "entry_date" | "entry_time"> | undefined;
    if (!anchor) return {};

    // SQLite row-value comparison ((a,b,c) < (?,?,?)) gives the exact tuple
    // ordering the list uses, without spelling out the nested OR chain.
    const older = this.db
      .prepare(
        `SELECT id, entry_date, title FROM jrn_entries
         WHERE (entry_date, entry_time, id) < (?, ?, ?)
         ORDER BY entry_date DESC, entry_time DESC, id DESC
         LIMIT 1`,
      )
      .get(anchor.entry_date, anchor.entry_time, anchor.id) as
      | { id: number; entry_date: string; title: string }
      | undefined;

    const newer = this.db
      .prepare(
        `SELECT id, entry_date, title FROM jrn_entries
         WHERE (entry_date, entry_time, id) > (?, ?, ?)
         ORDER BY entry_date ASC, entry_time ASC, id ASC
         LIMIT 1`,
      )
      .get(anchor.entry_date, anchor.entry_time, anchor.id) as
      | { id: number; entry_date: string; title: string }
      | undefined;

    const toRef = (row: { id: number; entry_date: string; title: string }): JournalEntryRef => ({
      id: row.id,
      date: row.entry_date,
      title: row.title,
    });

    return {
      previous: older ? toRef(older) : undefined,
      next: newer ? toRef(newer) : undefined,
    };
  }

  createEntry(input: EntryWriteData): JournalEntry {
    const insertEntry = this.db.prepare(
      `INSERT INTO jrn_entries
         (entry_date, entry_time, title, content, place_name,
          weather_temp, weather_unit, weather_description, weather_code,
          is_pinned, is_locked)
       VALUES
         (@date, @time, @title, @content, @placeName,
          @weatherTemp, @weatherUnit, @weatherDescription, @weatherCode,
          @isPinned, @isLocked)`,
    );

    const id = this.db.transaction(() => {
      const result = insertEntry.run(entryParams(input));
      const entryId = Number(result.lastInsertRowid);
      this.replaceChildren(entryId, input);
      return entryId;
    })();

    const created = this.getEntryById(id);
    if (!created) throw new Error("Failed to read back newly created journal entry.");
    return created;
  }

  updateEntry(id: number, input: EntryWriteData): JournalEntry {
    const updateEntryRow = this.db.prepare(
      `UPDATE jrn_entries SET
         entry_date = @date, entry_time = @time, title = @title, content = @content,
         place_name = @placeName, weather_temp = @weatherTemp, weather_unit = @weatherUnit,
         weather_description = @weatherDescription, weather_code = @weatherCode,
         is_pinned = @isPinned, is_locked = @isLocked
       WHERE id = @id`,
    );

    this.db.transaction(() => {
      updateEntryRow.run({ ...entryParams(input), id });
      this.replaceChildren(id, input);
    })();

    const updated = this.getEntryById(id);
    if (!updated) throw new Error(`Failed to read back updated journal entry ${id}.`);
    return updated;
  }

  deleteEntry(id: number): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM jrn_entry_categories WHERE entry_id = ?").run(id);
      this.db.prepare("DELETE FROM jrn_entry_tags WHERE entry_id = ?").run(id);
      this.db.prepare("DELETE FROM jrn_entry_locations WHERE entry_id = ?").run(id);
      this.db.prepare("DELETE FROM jrn_entries WHERE id = ?").run(id);
    })();
  }

  countEntriesMatching(key: JournalEntryMatchKey): number {
    // Rides idx_jrn_entries_match_key (migration 0072) on all three columns.
    // TRIM on the stored side too: a title that arrived with trailing space from
    // an earlier import must still match the same title read cleanly today.
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS matches FROM jrn_entries
         WHERE entry_date = @date
           AND entry_time = @time
           AND TRIM(title) = @title`,
      )
      .get({ ...key, title: key.title.trim() }) as { matches: number };
    return row.matches;
  }

  findEntryIdsMatching(key: JournalEntryMatchKey): number[] {
    // Same predicate and same index as countEntriesMatching — kept literally
    // identical so the overwrite import can never target a row the duplicate
    // check would not have counted.
    const rows = this.db
      .prepare(
        `SELECT id FROM jrn_entries
         WHERE entry_date = @date
           AND entry_time = @time
           AND TRIM(title) = @title
         ORDER BY id`,
      )
      .all({ ...key, title: key.title.trim() }) as { id: number }[];
    return rows.map((row) => row.id);
  }

  countAllEntries(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS total FROM jrn_entries").get() as {
      total: number;
    };
    return row.total;
  }

  countLockedEntries(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS total FROM jrn_entries WHERE is_locked = 1")
      .get() as { total: number };
    return row.total;
  }

  deleteAllEntries(): number {
    // Counted inside the transaction so the number reported back is the number
    // actually deleted, not a tally taken before a concurrent write.
    return this.db.transaction(() => {
      const { total } = this.db.prepare("SELECT COUNT(*) AS total FROM jrn_entries").get() as {
        total: number;
      };
      this.db.prepare("DELETE FROM jrn_entry_categories").run();
      this.db.prepare("DELETE FROM jrn_entry_tags").run();
      this.db.prepare("DELETE FROM jrn_entry_locations").run();
      this.db.prepare("DELETE FROM jrn_entries").run();
      return total;
    })();
  }

  setEntryPinned(id: number, isPinned: boolean): JournalEntry {
    this.db
      .prepare("UPDATE jrn_entries SET is_pinned = ? WHERE id = ?")
      .run(isPinned ? 1 : 0, id);
    const updated = this.getEntryById(id);
    if (!updated) throw new Error(`Failed to read back journal entry ${id}.`);
    return updated;
  }

  setEntryLocked(id: number, isLocked: boolean): JournalEntry {
    this.db
      .prepare("UPDATE jrn_entries SET is_locked = ? WHERE id = ?")
      .run(isLocked ? 1 : 0, id);
    const updated = this.getEntryById(id);
    if (!updated) throw new Error(`Failed to read back journal entry ${id}.`);
    return updated;
  }

  listCategories(): JournalCategory[] {
    const rows = this.db
      .prepare(`SELECT ${TAXONOMY_COLUMNS} FROM jrn_categories ORDER BY name ASC`)
      .all() as TaxonomyRow[];
    return rows.map(categoryToDomain);
  }

  getCategoryByName(name: string): JournalCategory | undefined {
    const row = this.db
      .prepare(`SELECT ${TAXONOMY_COLUMNS} FROM jrn_categories WHERE name = ?`)
      .get(name) as TaxonomyRow | undefined;
    return row ? categoryToDomain(row) : undefined;
  }

  getCategoryIcon(name: string): JournalTaxonomyIcon | undefined {
    const row = this.db
      .prepare("SELECT icon_image, icon_image_mime_type FROM jrn_categories WHERE name = ?")
      .get(name) as { icon_image: Buffer | null; icon_image_mime_type: string | null } | undefined;
    if (!row || !row.icon_image || !row.icon_image_mime_type) return undefined;
    return { data: row.icon_image, mimeType: row.icon_image_mime_type };
  }

  setCategoryIcon(name: string, icon: DecodedImage | undefined): void {
    this.db
      .prepare("UPDATE jrn_categories SET icon_image = ?, icon_image_mime_type = ? WHERE name = ?")
      .run(icon?.data ?? null, icon?.mimeType ?? null, name);
  }

  upsertCategory(input: UpsertCategoryInput): JournalCategory {
    this.db
      .prepare(
        `INSERT INTO jrn_categories (name, description) VALUES (@name, @description)
         ON CONFLICT(name) DO UPDATE SET description = excluded.description`,
      )
      .run(input);
    const saved = this.getCategoryByName(input.name);
    if (!saved) throw new Error(`Failed to read back upserted category "${input.name}".`);
    return saved;
  }

  deleteCategory(name: string): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM jrn_entry_categories WHERE category_name = ?").run(name);
      this.db.prepare("DELETE FROM jrn_categories WHERE name = ?").run(name);
    })();
  }

  listTags(): JournalTag[] {
    const rows = this.db
      .prepare(`SELECT ${TAXONOMY_COLUMNS} FROM jrn_tags ORDER BY name ASC`)
      .all() as TaxonomyRow[];
    return rows.map(tagToDomain);
  }

  getTagByName(name: string): JournalTag | undefined {
    const row = this.db
      .prepare(`SELECT ${TAXONOMY_COLUMNS} FROM jrn_tags WHERE name = ?`)
      .get(name) as TaxonomyRow | undefined;
    return row ? tagToDomain(row) : undefined;
  }

  getTagIcon(name: string): JournalTaxonomyIcon | undefined {
    const row = this.db
      .prepare("SELECT icon_image, icon_image_mime_type FROM jrn_tags WHERE name = ?")
      .get(name) as { icon_image: Buffer | null; icon_image_mime_type: string | null } | undefined;
    if (!row || !row.icon_image || !row.icon_image_mime_type) return undefined;
    return { data: row.icon_image, mimeType: row.icon_image_mime_type };
  }

  setTagIcon(name: string, icon: DecodedImage | undefined): void {
    this.db
      .prepare("UPDATE jrn_tags SET icon_image = ?, icon_image_mime_type = ? WHERE name = ?")
      .run(icon?.data ?? null, icon?.mimeType ?? null, name);
  }

  upsertTag(input: UpsertTagInput): JournalTag {
    this.db
      .prepare(
        `INSERT INTO jrn_tags (name, description) VALUES (@name, @description)
         ON CONFLICT(name) DO UPDATE SET description = excluded.description`,
      )
      .run(input);
    const saved = this.getTagByName(input.name);
    if (!saved) throw new Error(`Failed to read back upserted tag "${input.name}".`);
    return saved;
  }

  deleteTag(name: string): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM jrn_entry_tags WHERE tag_name = ?").run(name);
      this.db.prepare("DELETE FROM jrn_tags WHERE name = ?").run(name);
    })();
  }

  registerCategoriesIfMissing(names: string[]): void {
    if (names.length === 0) return;
    const insert = this.db.prepare("INSERT OR IGNORE INTO jrn_categories (name) VALUES (?)");
    this.db.transaction(() => {
      for (const name of names) insert.run(name);
    })();
  }

  registerTagsIfMissing(names: string[]): void {
    if (names.length === 0) return;
    const insert = this.db.prepare("INSERT OR IGNORE INTO jrn_tags (name) VALUES (?)");
    this.db.transaction(() => {
      for (const name of names) insert.run(name);
    })();
  }

  listTopTags(limit: number): JournalTaxonomyCount[] {
    return this.db
      .prepare(
        `SELECT tag_name AS name, COUNT(*) AS entryCount
         FROM jrn_entry_tags
         GROUP BY tag_name
         ORDER BY entryCount DESC, name ASC
         LIMIT ?`,
      )
      .all(limit) as JournalTaxonomyCount[];
  }

  listTopCategories(limit: number): JournalTaxonomyCount[] {
    return this.db
      .prepare(
        `SELECT category_name AS name, COUNT(*) AS entryCount
         FROM jrn_entry_categories
         GROUP BY category_name
         ORDER BY entryCount DESC, name ASC
         LIMIT ?`,
      )
      .all(limit) as JournalTaxonomyCount[];
  }

  // --- prefill templates (migration 0062) -----------------------------------

  listPrefillTemplates(): JournalPrefillTemplate[] {
    const rows = this.db
      .prepare(`${PREFILL_TEMPLATE_COLUMNS} FROM jrn_prefill_templates ORDER BY name ASC`)
      .all() as PrefillTemplateRow[];
    return rows.map(prefillTemplateToDomain);
  }

  getPrefillTemplateById(id: number): JournalPrefillTemplate | undefined {
    const row = this.db
      .prepare(`${PREFILL_TEMPLATE_COLUMNS} FROM jrn_prefill_templates WHERE id = ?`)
      .get(id) as PrefillTemplateRow | undefined;
    return row ? prefillTemplateToDomain(row) : undefined;
  }

  getPrefillTemplateByName(name: string): JournalPrefillTemplate | undefined {
    // NOCASE matches idx_jrn_prefill_templates_name, so this finds "gym" for
    // "Gym" — which is what the uniqueness check in the use-case needs.
    const row = this.db
      .prepare(
        `${PREFILL_TEMPLATE_COLUMNS} FROM jrn_prefill_templates WHERE name = ? COLLATE NOCASE`,
      )
      .get(name) as PrefillTemplateRow | undefined;
    return row ? prefillTemplateToDomain(row) : undefined;
  }

  // Create and update in one method: the input's optional id decides which. An
  // update rewrites every column, matching how the editor works — it loads the
  // whole template and saves the whole template, so there is no partial write.
  savePrefillTemplate(input: PrefillTemplateWriteData): JournalPrefillTemplate {
    const params = {
      name: input.name,
      description: input.description,
      isEnabled: input.isEnabled ? 1 : 0,
      fieldsJson: JSON.stringify(input.fields),
    };

    if (input.id !== undefined) {
      this.db
        .prepare(
          `UPDATE jrn_prefill_templates
              SET name = @name,
                  description = @description,
                  is_enabled = @isEnabled,
                  fields_json = @fieldsJson
            WHERE id = @id`,
        )
        .run({ ...params, id: input.id });
      const updated = this.getPrefillTemplateById(input.id);
      if (!updated) throw new Error(`Prefill template ${input.id} no longer exists.`);
      return updated;
    }

    const result = this.db
      .prepare(
        `INSERT INTO jrn_prefill_templates (name, description, is_enabled, fields_json)
         VALUES (@name, @description, @isEnabled, @fieldsJson)`,
      )
      .run(params);
    const created = this.getPrefillTemplateById(Number(result.lastInsertRowid));
    if (!created) throw new Error(`Failed to read back prefill template "${input.name}".`);
    return created;
  }

  deletePrefillTemplate(id: number): void {
    this.db.prepare("DELETE FROM jrn_prefill_templates WHERE id = ?").run(id);
  }

  setPrefillTemplateEnabled(id: number, isEnabled: boolean): JournalPrefillTemplate {
    this.db
      .prepare("UPDATE jrn_prefill_templates SET is_enabled = ? WHERE id = ?")
      .run(isEnabled ? 1 : 0, id);
    const updated = this.getPrefillTemplateById(id);
    if (!updated) throw new Error(`Prefill template ${id} no longer exists.`);
    return updated;
  }

  listDistinctFieldValues(field: JournalPrefillField, limit: number): string[] {
    // An allowlist mapping field -> column, not string interpolation of the
    // field name: this value reaches SQL, and an allowlist makes the injection
    // question unanswerable rather than merely unlikely.
    //
    // Only the free-text columns are here. Categories and tags have their own
    // managed lists (listCategories/listTags) which the editor uses instead, and
    // suggesting a previously-used date would be actively unhelpful.
    const COLUMNS: Partial<Record<JournalPrefillField, string>> = {
      title: "title",
      content: "content",
      placeName: "place_name",
    };
    const column = COLUMNS[field];
    if (!column) return [];

    // Most-used first, so the suggestion list opens with the value most likely
    // wanted. Blanks are excluded — an empty suggestion is not a suggestion.
    const rows = this.db
      .prepare(
        `SELECT ${column} AS value, COUNT(*) AS uses
           FROM jrn_entries
          WHERE ${column} <> ''
          GROUP BY ${column}
          ORDER BY uses DESC, value ASC
          LIMIT ?`,
      )
      .all(limit) as { value: string }[];
    return rows.map((row) => row.value);
  }

  // --- internal helpers -----------------------------------------------------

  // Wipes an entry's child rows and re-inserts them from the input. Called only
  // inside createEntry/updateEntry transactions; sort_order follows array order.
  // --- Recycle bin (migration 0079) ------------------------------------------
  //
  // An entry is four tables. Every operation below copies or removes all four in
  // one transaction, so a crash mid-move can't leave an entry half in the bin.

  recycleEntries(ids: number[]): number {
    if (ids.length === 0) return 0;

    const insertParent = this.db.prepare(
      `INSERT INTO jrn_recycled_entries (
         entry_id, entry_date, entry_time, title, content, place_name,
         weather_temp, weather_unit, weather_description, weather_code,
         is_pinned, is_locked, created_at, updated_at
       )
       SELECT id, entry_date, entry_time, title, content, place_name,
              weather_temp, weather_unit, weather_description, weather_code,
              is_pinned, is_locked, created_at, updated_at
       FROM jrn_entries WHERE id = ?`,
    );
    // The children are re-keyed onto the new parent id, which is why each entry
    // is moved one at a time rather than in a single set-based INSERT..SELECT:
    // last_insert_rowid() is only unambiguous for a single-row insert.
    const copyCategories = this.db.prepare(
      `INSERT INTO jrn_recycled_entry_categories (recycled_entry_id, category_name)
       SELECT ?, category_name FROM jrn_entry_categories WHERE entry_id = ?`,
    );
    const copyTags = this.db.prepare(
      `INSERT INTO jrn_recycled_entry_tags (recycled_entry_id, tag_name)
       SELECT ?, tag_name FROM jrn_entry_tags WHERE entry_id = ?`,
    );
    const copyLocations = this.db.prepare(
      `INSERT INTO jrn_recycled_entry_locations
         (recycled_entry_id, latitude, longitude, location_name, sort_order)
       SELECT ?, latitude, longitude, location_name, sort_order
       FROM jrn_entry_locations WHERE entry_id = ?`,
    );

    let moved = 0;
    this.db.transaction(() => {
      for (const id of ids) {
        // An id that has already gone contributes no row here, so the whole
        // move for it is skipped — the count the caller reports stays honest.
        const result = insertParent.run(id);
        if (result.changes === 0) continue;

        const recycledId = Number(result.lastInsertRowid);
        copyCategories.run(recycledId, id);
        copyTags.run(recycledId, id);
        copyLocations.run(recycledId, id);

        // Reuses the same child-table list the ordinary delete uses, so the two
        // paths can't drift on which tables an entry owns.
        this.db.prepare("DELETE FROM jrn_entry_categories WHERE entry_id = ?").run(id);
        this.db.prepare("DELETE FROM jrn_entry_tags WHERE entry_id = ?").run(id);
        this.db.prepare("DELETE FROM jrn_entry_locations WHERE entry_id = ?").run(id);
        this.db.prepare("DELETE FROM jrn_entries WHERE id = ?").run(id);
        moved += 1;
      }
    })();

    return moved;
  }

  listRecycledEntries(): RecycledJournalEntry[] {
    const rows = this.db
      .prepare(
        // deleted_at DESC rides idx_jrn_recycled_entries_deleted_at; id DESC
        // breaks the tie, because a bulk delete stamps one second on every row.
        "SELECT * FROM jrn_recycled_entries ORDER BY deleted_at DESC, id DESC",
      )
      .all() as RecycledEntryRow[];

    return this.hydrateRecycledEntries(rows);
  }

  restoreRecycledEntries(recycledIds: number[]): number {
    if (recycledIds.length === 0) return 0;

    const readParent = this.db.prepare("SELECT * FROM jrn_recycled_entries WHERE id = ?");
    const idTaken = this.db.prepare("SELECT 1 FROM jrn_entries WHERE id = ?");
    // Two inserts, differing only in whether they name `id`: restoring at the
    // original id keeps any existing reference to that entry working, and
    // letting SQLite assign one is the fallback when the id has been taken.
    const insertAtId = this.db.prepare(
      `INSERT INTO jrn_entries (
         id, entry_date, entry_time, title, content, place_name,
         weather_temp, weather_unit, weather_description, weather_code,
         is_pinned, is_locked, created_at, updated_at
       ) VALUES (
         @id, @entry_date, @entry_time, @title, @content, @place_name,
         @weather_temp, @weather_unit, @weather_description, @weather_code,
         @is_pinned, @is_locked, @created_at, @updated_at
       )`,
    );
    const insertFresh = this.db.prepare(
      `INSERT INTO jrn_entries (
         entry_date, entry_time, title, content, place_name,
         weather_temp, weather_unit, weather_description, weather_code,
         is_pinned, is_locked, created_at, updated_at
       ) VALUES (
         @entry_date, @entry_time, @title, @content, @place_name,
         @weather_temp, @weather_unit, @weather_description, @weather_code,
         @is_pinned, @is_locked, @created_at, @updated_at
       )`,
    );
    const restoreCategories = this.db.prepare(
      `INSERT INTO jrn_entry_categories (entry_id, category_name)
       SELECT ?, category_name FROM jrn_recycled_entry_categories
       WHERE recycled_entry_id = ?`,
    );
    const restoreTags = this.db.prepare(
      `INSERT INTO jrn_entry_tags (entry_id, tag_name)
       SELECT ?, tag_name FROM jrn_recycled_entry_tags WHERE recycled_entry_id = ?`,
    );
    const restoreLocations = this.db.prepare(
      `INSERT INTO jrn_entry_locations (entry_id, latitude, longitude, location_name, sort_order)
       SELECT ?, latitude, longitude, location_name, sort_order
       FROM jrn_recycled_entry_locations WHERE recycled_entry_id = ? ORDER BY sort_order ASC`,
    );

    let restored = 0;
    this.db.transaction(() => {
      for (const recycledId of recycledIds) {
        const row = readParent.get(recycledId) as RecycledEntryRow | undefined;
        if (!row) continue;

        const params = {
          entry_date: row.entry_date,
          entry_time: row.entry_time,
          title: row.title,
          content: row.content,
          place_name: row.place_name,
          weather_temp: row.weather_temp,
          weather_unit: row.weather_unit,
          weather_description: row.weather_description,
          weather_code: row.weather_code,
          is_pinned: row.is_pinned,
          is_locked: row.is_locked,
          created_at: row.created_at,
          updated_at: row.updated_at,
        };

        const canKeepId = idTaken.get(row.entry_id) === undefined;
        const result = canKeepId
          ? insertAtId.run({ ...params, id: row.entry_id })
          : insertFresh.run(params);
        const newEntryId = canKeepId ? row.entry_id : Number(result.lastInsertRowid);

        restoreCategories.run(newEntryId, recycledId);
        restoreTags.run(newEntryId, recycledId);
        restoreLocations.run(newEntryId, recycledId);

        // Out of the bin: the entry lives in jrn_entries again, and leaving the
        // row here would let it be restored a second time.
        this.deleteRecycledRows(recycledId);
        restored += 1;

        // The managed category/tag lists are deliberately NOT re-registered. A
        // recycled entry's names were registered when it was first written, and
        // deleteCategory/deleteTag detach names from live entries only — so a
        // name can only be missing if the user deliberately deleted it, and
        // silently resurrecting it here would undo that.
      }
    })();

    return restored;
  }

  deleteRecycledEntriesForever(recycledIds: number[]): number {
    if (recycledIds.length === 0) return 0;

    const exists = this.db.prepare("SELECT 1 FROM jrn_recycled_entries WHERE id = ?");
    let deleted = 0;
    this.db.transaction(() => {
      for (const recycledId of recycledIds) {
        if (exists.get(recycledId) === undefined) continue;
        this.deleteRecycledRows(recycledId);
        deleted += 1;
      }
    })();

    return deleted;
  }

  emptyRecycleBin(): number {
    let deleted = 0;
    this.db.transaction(() => {
      deleted = this.countRecycledEntries();
      // Unqualified DELETEs rather than a per-row loop: this is the one
      // operation with nothing to preserve. Children first, so an interrupted
      // run can never leave a parent row without them.
      this.db.prepare("DELETE FROM jrn_recycled_entry_categories").run();
      this.db.prepare("DELETE FROM jrn_recycled_entry_tags").run();
      this.db.prepare("DELETE FROM jrn_recycled_entry_locations").run();
      this.db.prepare("DELETE FROM jrn_recycled_entries").run();
    })();

    return deleted;
  }

  countRecycledEntries(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS total FROM jrn_recycled_entries").get() as {
      total: number;
    };
    return row.total;
  }

  /** Removes one bin row and its children. The caller owns the transaction. */
  private deleteRecycledRows(recycledId: number): void {
    this.db
      .prepare("DELETE FROM jrn_recycled_entry_categories WHERE recycled_entry_id = ?")
      .run(recycledId);
    this.db
      .prepare("DELETE FROM jrn_recycled_entry_tags WHERE recycled_entry_id = ?")
      .run(recycledId);
    this.db
      .prepare("DELETE FROM jrn_recycled_entry_locations WHERE recycled_entry_id = ?")
      .run(recycledId);
    this.db.prepare("DELETE FROM jrn_recycled_entries WHERE id = ?").run(recycledId);
  }

  /**
   * Builds RecycledJournalEntry objects, reusing `entryToDomain` so the
   * registered JournalViewer can render a bin row unchanged.
   *
   * `id` is set to the ORIGINAL entry id (`entry_id`), not the bin's row id —
   * the viewer and its links expect the entry's own identity. `recycledId`
   * carries the bin handle separately.
   */
  private hydrateRecycledEntries(rows: RecycledEntryRow[]): RecycledJournalEntry[] {
    if (rows.length === 0) return [];

    const idList = rows.map((row) => row.id).join(",");
    const originalIdByRow = new Map(rows.map((row) => [row.id, row.entry_id]));

    const categoriesByRow = this.groupRecycledPairings(
      this.db
        .prepare(
          `SELECT recycled_entry_id, category_name AS name FROM jrn_recycled_entry_categories
           WHERE recycled_entry_id IN (${idList}) ORDER BY id ASC`,
        )
        .all() as RecycledPairingRow[],
    );
    const tagsByRow = this.groupRecycledPairings(
      this.db
        .prepare(
          `SELECT recycled_entry_id, tag_name AS name FROM jrn_recycled_entry_tags
           WHERE recycled_entry_id IN (${idList}) ORDER BY id ASC`,
        )
        .all() as RecycledPairingRow[],
    );

    const locationsByRow = new Map<number, EntryLocation[]>();
    const locationRows = this.db
      .prepare(
        `SELECT * FROM jrn_recycled_entry_locations
         WHERE recycled_entry_id IN (${idList})
         ORDER BY recycled_entry_id ASC, sort_order ASC`,
      )
      .all() as RecycledLocationRow[];
    for (const row of locationRows) {
      const existing = locationsByRow.get(row.recycled_entry_id) ?? [];
      existing.push(
        locationToDomain({
          id: row.id,
          // entryId points at the original entry, matching the `id` on the
          // entry object this location hangs off.
          entry_id: originalIdByRow.get(row.recycled_entry_id) ?? 0,
          latitude: row.latitude,
          longitude: row.longitude,
          location_name: row.location_name,
          sort_order: row.sort_order,
        }),
      );
      locationsByRow.set(row.recycled_entry_id, existing);
    }

    return rows.map((row) => {
      const entry = entryToDomain(
        // The original id, so the viewer sees the entry's own identity.
        { ...row, id: row.entry_id },
        categoriesByRow.get(row.id) ?? [],
        tagsByRow.get(row.id) ?? [],
        locationsByRow.get(row.id) ?? [],
      );
      return { ...entry, recycledId: row.id, deletedAt: row.deleted_at };
    });
  }

  private groupRecycledPairings(rows: RecycledPairingRow[]): Map<number, string[]> {
    const grouped = new Map<number, string[]>();
    for (const row of rows) {
      const existing = grouped.get(row.recycled_entry_id) ?? [];
      existing.push(row.name);
      grouped.set(row.recycled_entry_id, existing);
    }
    return grouped;
  }

  private replaceChildren(entryId: number, input: EntryWriteData): void {
    this.db.prepare("DELETE FROM jrn_entry_categories WHERE entry_id = ?").run(entryId);
    this.db.prepare("DELETE FROM jrn_entry_tags WHERE entry_id = ?").run(entryId);
    this.db.prepare("DELETE FROM jrn_entry_locations WHERE entry_id = ?").run(entryId);

    const insertCategory = this.db.prepare(
      "INSERT INTO jrn_entry_categories (entry_id, category_name) VALUES (?, ?)",
    );
    for (const name of input.categories) insertCategory.run(entryId, name);

    const insertTag = this.db.prepare(
      "INSERT INTO jrn_entry_tags (entry_id, tag_name) VALUES (?, ?)",
    );
    for (const name of input.tags) insertTag.run(entryId, name);

    const insertLocation = this.db.prepare(
      `INSERT INTO jrn_entry_locations (entry_id, latitude, longitude, location_name, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
    );
    input.locations.forEach((location, index) => {
      insertLocation.run(entryId, location.latitude, location.longitude, location.locationName, index);
    });
  }

  /**
   * Turns a set of entry rows into domain entries, reading each child table
   * ONCE for the whole set rather than once per row.
   *
   * Every list reader goes through here. The per-entry `categoryNamesFor` /
   * `tagNamesFor` / `locationsFor` helpers below are now only for
   * `getEntryById`, where there is exactly one row and a batch would be three
   * identical queries with a one-element IN list.
   *
   * Why this matters: the Entries screen reads 500 rows and the year calendar
   * ~380, so per-row child fetches meant ~1,500 and ~1,140 queries for one page
   * — each a round trip to a database file that lives on the NAS over SMB.
   *
   * The id list is interpolated as literal integers rather than bound as
   * parameters. They come from `jrn_entries.id` (INTEGER PRIMARY KEY) that
   * SQLite just handed us, never from user input, and binding them would mean a
   * fresh statement per distinct row count — which defeats better-sqlite3's
   * statement cache on exactly the queries this is meant to speed up.
   *
   * `all` skips the IN filter altogether, for `listEntries()`: when the caller
   * already holds every row, naming each id back to SQLite is both a needlessly
   * long statement and a worse plan than the three unfiltered scans it replaces.
   */
  private hydrateEntries(rows: EntryRow[], scope: "some" | "all" = "some"): JournalEntry[] {
    if (rows.length === 0) return [];

    const idList = rows.map((row) => row.id).join(",");
    const restrict = (column: string) => (scope === "all" ? "" : `WHERE ${column} IN (${idList})`);

    const categoriesByEntry = this.groupPairings(
      this.db
        .prepare(
          `SELECT entry_id, category_name AS name FROM jrn_entry_categories
           ${restrict("entry_id")} ORDER BY id ASC`,
        )
        .all() as PairingRow[],
    );
    const tagsByEntry = this.groupPairings(
      this.db
        .prepare(
          `SELECT entry_id, tag_name AS name FROM jrn_entry_tags
           ${restrict("entry_id")} ORDER BY id ASC`,
        )
        .all() as PairingRow[],
    );

    const locationsByEntry = new Map<number, EntryLocation[]>();
    const locationRows = this.db
      .prepare(
        `SELECT * FROM jrn_entry_locations
         ${restrict("entry_id")} ORDER BY entry_id ASC, sort_order ASC`,
      )
      .all() as LocationRow[];
    for (const row of locationRows) {
      const existing = locationsByEntry.get(row.entry_id) ?? [];
      existing.push(locationToDomain(row));
      locationsByEntry.set(row.entry_id, existing);
    }

    // Row order is preserved: the caller's ORDER BY is the sort the screen wants.
    return rows.map((row) =>
      entryToDomain(
        row,
        categoriesByEntry.get(row.id) ?? [],
        tagsByEntry.get(row.id) ?? [],
        locationsByEntry.get(row.id) ?? [],
      ),
    );
  }

  private categoryNamesFor(entryId: number): string[] {
    const rows = this.db
      .prepare(
        "SELECT category_name AS name FROM jrn_entry_categories WHERE entry_id = ? ORDER BY id ASC",
      )
      .all(entryId) as { name: string }[];
    return rows.map((row) => row.name);
  }

  private tagNamesFor(entryId: number): string[] {
    const rows = this.db
      .prepare("SELECT tag_name AS name FROM jrn_entry_tags WHERE entry_id = ? ORDER BY id ASC")
      .all(entryId) as { name: string }[];
    return rows.map((row) => row.name);
  }

  private locationsFor(entryId: number): EntryLocation[] {
    const rows = this.db
      .prepare("SELECT * FROM jrn_entry_locations WHERE entry_id = ? ORDER BY sort_order ASC")
      .all(entryId) as LocationRow[];
    return rows.map(locationToDomain);
  }

  private groupPairings(rows: PairingRow[]): Map<number, string[]> {
    const grouped = new Map<number, string[]>();
    for (const row of rows) {
      const existing = grouped.get(row.entry_id) ?? [];
      existing.push(row.name);
      grouped.set(row.entry_id, existing);
    }
    return grouped;
  }
}

// Maps a create/update input to the named SQL parameters, collapsing the
// optional weather object into its four nullable columns.
function entryParams(input: EntryWriteData): Record<string, string | number | null> {
  return {
    date: input.date,
    time: input.time,
    title: input.title,
    content: input.content,
    placeName: input.placeName,
    weatherTemp: input.weather ? input.weather.temp : null,
    weatherUnit: input.weather ? input.weather.unit : null,
    weatherDescription: input.weather ? input.weather.description : null,
    weatherCode: input.weather ? input.weather.code : null,
    isPinned: input.isPinned ? 1 : 0,
    isLocked: input.isLocked ? 1 : 0,
  };
}
