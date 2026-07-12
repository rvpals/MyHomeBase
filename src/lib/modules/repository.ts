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
    const insert = this.db.prepare(
      "INSERT INTO modules (slug, short_name, long_name, description, sequence, is_visible, icon) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const applyReset = this.db.transaction((items: Omit<Module, "id">[]) => {
      this.db.prepare("DELETE FROM modules").run();
      items.forEach((item, index) => {
        insert.run(
          item.slug,
          item.shortName,
          item.longName,
          item.description ?? null,
          index + 1,
          item.isVisible ? 1 : 0,
          item.icon,
        );
      });
    });
    applyReset(defaults);
  }
}
