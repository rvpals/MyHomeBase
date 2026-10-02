// SQLite access for `sys_menu_item_overrides`. The only place that talks to that
// table, and it returns domain types — never raw rows.

import type Database from "better-sqlite3";
import type { MenuItemOverrideRepository } from "./ports";
import type { MenuItemOverride } from "./types";

interface OverrideRow {
  menu_item_id: string;
  title: string | null;
  hint: string | null;
  updated_at: string;
}

/** A row to the domain type. NULL becomes `undefined` — one kind of nothing. */
function toOverride(row: OverrideRow): MenuItemOverride {
  return {
    menuItemId: row.menu_item_id,
    title: row.title ?? undefined,
    hint: row.hint ?? undefined,
    updatedAt: row.updated_at,
  };
}

const COLUMNS = `menu_item_id, title, hint, updated_at`;

export class SqliteMenuItemOverrideRepository implements MenuItemOverrideRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Every override, for resolving the whole registry in one read.
   *
   * Ordered by id so the result is stable between calls — the admin screen renders
   * from the registry's order, but a stable read makes a diff of two installs
   * comparable and keeps tests from depending on insertion order.
   */
  listAll(): MenuItemOverride[] {
    const rows = this.db
      .prepare(`SELECT ${COLUMNS} FROM sys_menu_item_overrides ORDER BY menu_item_id`)
      .all() as OverrideRow[];
    return rows.map(toOverride);
  }

  get(menuItemId: string): MenuItemOverride | undefined {
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM sys_menu_item_overrides WHERE menu_item_id = ?`)
      .get(menuItemId) as OverrideRow | undefined;
    return row ? toOverride(row) : undefined;
  }

  /**
   * Writes one override, replacing whatever was there.
   *
   * An upsert rather than an UPDATE: the table is sparse, so the first edit to any
   * item has no row to update. The same trap `updateSettings` carries — a plain
   * UPDATE would report success and write nothing.
   */
  upsert(override: MenuItemOverride): void {
    this.db
      .prepare(
        `INSERT INTO sys_menu_item_overrides (menu_item_id, title, hint, updated_at)
         VALUES (@menuItemId, @title, @hint, @updatedAt)
         ON CONFLICT(menu_item_id) DO UPDATE SET
           title = excluded.title,
           hint = excluded.hint,
           updated_at = excluded.updated_at`,
      )
      .run({
        menuItemId: override.menuItemId,
        // `undefined` is not a bindable value in better-sqlite3, and the column is
        // nullable on purpose — a cleared field is SQL NULL, not an empty string.
        title: override.title ?? null,
        hint: override.hint ?? null,
        updatedAt: override.updatedAt,
      });
  }

  /** Removes one override. Silent when there is none — "reset" is idempotent. */
  remove(menuItemId: string): void {
    this.db.prepare(`DELETE FROM sys_menu_item_overrides WHERE menu_item_id = ?`).run(menuItemId);
  }
}
