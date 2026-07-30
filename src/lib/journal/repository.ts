import type Database from "better-sqlite3";
import type { JournalRepository } from "./ports";
import {
  entryLocationSchema,
  journalCategorySchema,
  journalEntrySchema,
  journalTagSchema,
} from "./schema";
import type { EntryWriteData, UpsertCategoryInput, UpsertTagInput } from "./schema";
import type {
  EntryLocation,
  JournalCategory,
  JournalEntry,
  JournalEntryNeighbors,
  JournalEntryRef,
  JournalTag,
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

interface TaxonomyRow {
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function tagToDomain(row: TaxonomyRow): JournalTag {
  return journalTagSchema.parse({
    name: row.name,
    description: row.description,
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
    if (rows.length === 0) return [];

    // Fetch all child rows once and group by entry to avoid an N+1 query storm.
    const categoriesByEntry = this.groupPairings(
      this.db
        .prepare(
          "SELECT entry_id, category_name AS name FROM jrn_entry_categories ORDER BY id ASC",
        )
        .all() as PairingRow[],
    );
    const tagsByEntry = this.groupPairings(
      this.db
        .prepare("SELECT entry_id, tag_name AS name FROM jrn_entry_tags ORDER BY id ASC")
        .all() as PairingRow[],
    );
    const locationsByEntry = new Map<number, EntryLocation[]>();
    const locationRows = this.db
      .prepare(
        "SELECT * FROM jrn_entry_locations ORDER BY entry_id ASC, sort_order ASC",
      )
      .all() as LocationRow[];
    for (const row of locationRows) {
      const existing = locationsByEntry.get(row.entry_id) ?? [];
      existing.push(locationToDomain(row));
      locationsByEntry.set(row.entry_id, existing);
    }

    return rows.map((row) =>
      entryToDomain(
        row,
        categoriesByEntry.get(row.id) ?? [],
        tagsByEntry.get(row.id) ?? [],
        locationsByEntry.get(row.id) ?? [],
      ),
    );
  }

  listRecentEntries(limit: number): JournalEntry[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM jrn_entries ORDER BY entry_date DESC, entry_time DESC, id DESC LIMIT ?",
      )
      .all(limit) as EntryRow[];
    // Only a handful of rows (the overview list), so per-entry child fetches are fine.
    return rows.map((row) =>
      entryToDomain(
        row,
        this.categoryNamesFor(row.id),
        this.tagNamesFor(row.id),
        this.locationsFor(row.id),
      ),
    );
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

    return rows.map((row) =>
      entryToDomain(
        row,
        this.categoryNamesFor(row.id),
        this.tagNamesFor(row.id),
        this.locationsFor(row.id),
      ),
    );
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
      .prepare("SELECT * FROM jrn_categories ORDER BY name ASC")
      .all() as TaxonomyRow[];
    return rows.map(categoryToDomain);
  }

  getCategoryByName(name: string): JournalCategory | undefined {
    const row = this.db.prepare("SELECT * FROM jrn_categories WHERE name = ?").get(name) as
      | TaxonomyRow
      | undefined;
    return row ? categoryToDomain(row) : undefined;
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
      .prepare("SELECT * FROM jrn_tags ORDER BY name ASC")
      .all() as TaxonomyRow[];
    return rows.map(tagToDomain);
  }

  getTagByName(name: string): JournalTag | undefined {
    const row = this.db.prepare("SELECT * FROM jrn_tags WHERE name = ?").get(name) as
      | TaxonomyRow
      | undefined;
    return row ? tagToDomain(row) : undefined;
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

  // --- internal helpers -----------------------------------------------------

  // Wipes an entry's child rows and re-inserts them from the input. Called only
  // inside createEntry/updateEntry transactions; sort_order follows array order.
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
