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
    const rows = this.db.prepare("SELECT * FROM sys_app_settings ORDER BY key ASC").all() as SettingRow[];
    return rows.map(toDomain);
  }

  getSetting(key: string): Setting | undefined {
    const row = this.db.prepare("SELECT * FROM sys_app_settings WHERE key = ?").get(key) as
      | SettingRow
      | undefined;
    return row ? toDomain(row) : undefined;
  }

  updateAll(updates: SettingUpdate[]): void {
    // Upsert, not a plain UPDATE, for the same reason `setValue` below is one: a
    // database that predates the migration seeding a given key has no row for
    // it, and `UPDATE ... WHERE key = ?` against a missing row affects nothing
    // and reports no error -- so the save returns success and persists nothing.
    //
    // That is not hypothetical. It shipped with `chrome_style` (migrations/0121)
    // against a deployed database the migration had not yet run on: the picker
    // saved, said "Saved", and every refresh came back with the old style. The
    // seed row is still required -- it carries the `description` column, which
    // this statement deliberately leaves alone so an upsert can't blank it --
    // but the write no longer silently depends on the migration having run.
    const stmt = this.db.prepare(
      `INSERT INTO sys_app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
    const applyUpdates = this.db.transaction((items: SettingUpdate[]) => {
      items.forEach((item) => stmt.run(item.key, item.value));
    });
    applyUpdates(updates);
  }

  setValue(key: string, value: string): void {
    // Upsert, not UPDATE: a database that predates migration 0041 has no
    // STARTUP_MESSAGE row, and a plain UPDATE would silently do nothing.
    this.db
      .prepare(
        `INSERT INTO sys_app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  resetToDefaults(defaults: Setting[]): void {
    const insert = this.db.prepare(
      "INSERT INTO sys_app_settings (key, value, description) VALUES (?, ?, ?)",
    );
    const applyReset = this.db.transaction((items: Setting[]) => {
      this.db.prepare("DELETE FROM sys_app_settings").run();
      items.forEach((item) => insert.run(item.key, item.value, item.description ?? null));
    });
    applyReset(defaults);
  }
}
