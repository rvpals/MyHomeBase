import type Database from "better-sqlite3";
import { settingSchema, type SettingUpdate } from "./schema";
import type { Setting } from "./types";
import type { SettingsRepository } from "./ports";

interface SettingRow {
  key: string;
  value: string;
  description: string | null;
}

function toDomain(row: SettingRow): Setting {
  return settingSchema.parse({
    key: row.key,
    value: row.value,
    description: row.description ?? undefined,
  });
}

// The real repository. Swap the database without touching any use-case.
export class SqliteSettingsRepository implements SettingsRepository {
  constructor(private db: Database.Database) {}

  listSettings(): Setting[] {
    const rows = this.db.prepare("SELECT * FROM app_settings ORDER BY key ASC").all() as SettingRow[];
    return rows.map(toDomain);
  }

  getSetting(key: string): Setting | undefined {
    const row = this.db.prepare("SELECT * FROM app_settings WHERE key = ?").get(key) as
      | SettingRow
      | undefined;
    return row ? toDomain(row) : undefined;
  }

  updateAll(updates: SettingUpdate[]): void {
    const stmt = this.db.prepare("UPDATE app_settings SET value = ? WHERE key = ?");
    const applyUpdates = this.db.transaction((items: SettingUpdate[]) => {
      items.forEach((item) => stmt.run(item.value, item.key));
    });
    applyUpdates(updates);
  }

  resetToDefaults(defaults: Setting[]): void {
    const insert = this.db.prepare(
      "INSERT INTO app_settings (key, value, description) VALUES (?, ?, ?)",
    );
    const applyReset = this.db.transaction((items: Setting[]) => {
      this.db.prepare("DELETE FROM app_settings").run();
      items.forEach((item) => insert.run(item.key, item.value, item.description ?? null));
    });
    applyReset(defaults);
  }
}
