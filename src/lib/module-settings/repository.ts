import type Database from "better-sqlite3";
import { moduleSettingSchema, type ModuleSettingEntry } from "./schema";
import type { ModuleSetting } from "./types";
import type { ModuleSettingsRepository } from "./ports";

interface ModuleSettingRow {
  id: number;
  module_id: number;
  setting_key: string;
  setting_value: string;
  setting_description: string | null;
}

function toDomain(row: ModuleSettingRow): ModuleSetting {
  return moduleSettingSchema.parse({
    id: row.id,
    moduleId: row.module_id,
    key: row.setting_key,
    value: row.setting_value,
    description: row.setting_description ?? undefined,
  });
}

// The real repository. Swap the database without touching any use-case.
export class SqliteModuleSettingsRepository implements ModuleSettingsRepository {
  constructor(private db: Database.Database) {}

  listByModuleId(moduleId: number): ModuleSetting[] {
    const rows = this.db
      .prepare("SELECT * FROM module_settings WHERE module_id = ? ORDER BY setting_key ASC")
      .all(moduleId) as ModuleSettingRow[];
    return rows.map(toDomain);
  }

  listAll(): ModuleSetting[] {
    const rows = this.db
      .prepare("SELECT * FROM module_settings ORDER BY module_id ASC, setting_key ASC")
      .all() as ModuleSettingRow[];
    return rows.map(toDomain);
  }

  replaceForModule(moduleId: number, entries: ModuleSettingEntry[]): void {
    const deleteExisting = this.db.prepare("DELETE FROM module_settings WHERE module_id = ?");
    const insert = this.db.prepare(
      "INSERT INTO module_settings (module_id, setting_key, setting_value, setting_description) VALUES (?, ?, ?, ?)",
    );
    const apply = this.db.transaction((items: ModuleSettingEntry[]) => {
      deleteExisting.run(moduleId);
      items.forEach((item) => insert.run(moduleId, item.key, item.value, item.description ?? null));
    });
    apply(entries);
  }
}
