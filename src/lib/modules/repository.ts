import type Database from "better-sqlite3";
import { moduleSchema, type ModuleUpdate } from "./schema";
import type { Module } from "./types";
import type { ModuleRepository } from "./ports";

interface ModuleRow {
  id: number;
  slug: string;
  short_name: string;
  long_name: string;
  description: string | null;
  sequence: number;
  is_visible: number;
  icon: string;
}

function toDomain(row: ModuleRow): Module {
  return moduleSchema.parse({
    id: row.id,
    slug: row.slug,
    shortName: row.short_name,
    longName: row.long_name,
    description: row.description ?? undefined,
    sequence: row.sequence,
    isVisible: row.is_visible === 1,
    icon: row.icon,
  });
}

// The real repository. Swap the database without touching any use-case.
export class SqliteModuleRepository implements ModuleRepository {
  constructor(private db: Database.Database) {}

  listModules(options: { includeHidden?: boolean } = {}): Module[] {
    const query = options.includeHidden
      ? "SELECT * FROM modules ORDER BY sequence ASC"
      : "SELECT * FROM modules WHERE is_visible = 1 ORDER BY sequence ASC";
    const rows = this.db.prepare(query).all() as ModuleRow[];
    return rows.map(toDomain);
  }

  getModuleBySlug(slug: string): Module | undefined {
    const row = this.db.prepare("SELECT * FROM modules WHERE slug = ?").get(slug) as
      | ModuleRow
      | undefined;
    return row ? toDomain(row) : undefined;
  }

  updateAll(updates: ModuleUpdate[]): void {
    const stmt = this.db.prepare(
      "UPDATE modules SET short_name = ?, long_name = ?, description = ?, is_visible = ?, sequence = ? WHERE slug = ?",
    );
    const applyUpdates = this.db.transaction((items: ModuleUpdate[]) => {
      items.forEach((item, index) => {
        stmt.run(
          item.shortName,
          item.longName,
          item.description ?? null,
          item.isVisible ? 1 : 0,
          index + 1,
          item.slug,
        );
      });
    });
    applyUpdates(updates);
  }

  resetToDefaults(defaults: Omit<Module, "id">[]): void {
    // Upsert by slug rather than delete-then-insert: modules that stay in the
    // defaults list keep their id, so module_settings rows (keyed by module_id,
    // no FK) don't get orphaned by a reset. Only modules dropped from the
    // defaults list are actually deleted.
    const upsert = this.db.prepare(`
      INSERT INTO modules (slug, short_name, long_name, description, sequence, is_visible, icon)
      VALUES (@slug, @shortName, @longName, @description, @sequence, @isVisible, @icon)
      ON CONFLICT(slug) DO UPDATE SET
        short_name = excluded.short_name,
        long_name = excluded.long_name,
        description = excluded.description,
        sequence = excluded.sequence,
        is_visible = excluded.is_visible,
        icon = excluded.icon
    `);
    const deleteBySlug = this.db.prepare("DELETE FROM modules WHERE slug = ?");

    const applyReset = this.db.transaction((items: Omit<Module, "id">[]) => {
      const defaultSlugs = new Set(items.map((item) => item.slug));
      const existingSlugs = (
        this.db.prepare("SELECT slug FROM modules").all() as { slug: string }[]
      ).map((row) => row.slug);

      for (const slug of existingSlugs) {
        if (!defaultSlugs.has(slug)) deleteBySlug.run(slug);
      }

      items.forEach((item, index) => {
        upsert.run({
          slug: item.slug,
          shortName: item.shortName,
          longName: item.longName,
          description: item.description ?? null,
          sequence: index + 1,
          isVisible: item.isVisible ? 1 : 0,
          icon: item.icon,
        });
      });
    });
    applyReset(defaults);
  }
}
