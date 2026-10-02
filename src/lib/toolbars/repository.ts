// SQLite access for `sys_toolbars` and `sys_toolbar_items`.

import type Database from "better-sqlite3";
import type { ToolbarItemWrite, ToolbarRepository, ToolbarWrite } from "./ports";
import type { Toolbar, ToolbarItem, ToolbarWithItems } from "./types";

interface ToolbarRow {
  id: number;
  name: string;
  background_color: string | null;
  border_color: string | null;
  text_color: string | null;
  edge: string;
  full_mode_only: number;
  is_visible: number;
  sort_order: number;
}

interface ItemRow {
  id: number;
  toolbar_id: number;
  kind: string;
  menu_item_id: string | null;
  label: string | null;
  sort_order: number;
}

function toToolbar(row: ToolbarRow): Toolbar {
  return {
    id: row.id,
    name: row.name,
    backgroundColor: row.background_color ?? undefined,
    borderColor: row.border_color ?? undefined,
    textColor: row.text_color ?? undefined,
    // The column is a plain TEXT with a CHECK constraint, so the cast is safe at
    // the boundary the constraint guards.
    edge: row.edge as Toolbar["edge"],
    fullModeOnly: row.full_mode_only !== 0,
    isVisible: row.is_visible !== 0,
    sortOrder: row.sort_order,
  };
}

function toItem(row: ItemRow): ToolbarItem {
  return {
    id: row.id,
    toolbarId: row.toolbar_id,
    kind: row.kind as ToolbarItem["kind"],
    menuItemId: row.menu_item_id ?? undefined,
    label: row.label ?? undefined,
    sortOrder: row.sort_order,
  };
}

const TOOLBAR_COLUMNS = `id, name, background_color, border_color, text_color, edge, full_mode_only, is_visible, sort_order`;
const ITEM_COLUMNS = `id, toolbar_id, kind, menu_item_id, label, sort_order`;

export class SqliteToolbarRepository implements ToolbarRepository {
  constructor(private readonly db: Database.Database) {}

  listToolbars(): ToolbarWithItems[] {
    const toolbars = (
      this.db
        .prepare(`SELECT ${TOOLBAR_COLUMNS} FROM sys_toolbars ORDER BY sort_order, id`)
        .all() as ToolbarRow[]
    ).map(toToolbar);

    // One query for every row rather than one per toolbar: this runs on page
    // renders, and a bar per edge would otherwise be four round trips.
    const items = (
      this.db
        .prepare(`SELECT ${ITEM_COLUMNS} FROM sys_toolbar_items ORDER BY toolbar_id, sort_order, id`)
        .all() as ItemRow[]
    ).map(toItem);

    return toolbars.map((toolbar) => ({
      ...toolbar,
      items: items.filter((item) => item.toolbarId === toolbar.id),
    }));
  }

  getToolbar(id: number): ToolbarWithItems | undefined {
    const row = this.db
      .prepare(`SELECT ${TOOLBAR_COLUMNS} FROM sys_toolbars WHERE id = ?`)
      .get(id) as ToolbarRow | undefined;
    if (!row) return undefined;

    const items = (
      this.db
        .prepare(
          `SELECT ${ITEM_COLUMNS} FROM sys_toolbar_items WHERE toolbar_id = ? ORDER BY sort_order, id`,
        )
        .all(id) as ItemRow[]
    ).map(toItem);

    return { ...toToolbar(row), items };
  }

  createToolbar(toolbar: ToolbarWrite): ToolbarWithItems {
    // Appended last. `MAX + 1` rather than a count, so a deleted toolbar doesn't
    // make the next one collide with an existing position.
    const next = this.db
      .prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM sys_toolbars`)
      .get() as { next: number };

    const result = this.db
      .prepare(
        `INSERT INTO sys_toolbars
           (name, background_color, border_color, text_color, edge, full_mode_only, is_visible, sort_order)
         VALUES (@name, @backgroundColor, @borderColor, @textColor, @edge, @fullModeOnly, @isVisible, @sortOrder)`,
      )
      .run({ ...this.bindToolbar(toolbar), sortOrder: next.next });

    return this.getToolbar(Number(result.lastInsertRowid))!;
  }

  updateToolbar(id: number, toolbar: ToolbarWrite): void {
    this.db
      .prepare(
        `UPDATE sys_toolbars SET
           name = @name,
           background_color = @backgroundColor,
           border_color = @borderColor,
           text_color = @textColor,
           edge = @edge,
           full_mode_only = @fullModeOnly,
           is_visible = @isVisible
         WHERE id = @id`,
      )
      .run({ ...this.bindToolbar(toolbar), id });
  }

  /**
   * Removes a toolbar and its rows, in one transaction.
   *
   * There are no DB-level foreign keys here (project convention), so the rows are
   * deleted explicitly. The transaction is what stops a crash between the two
   * statements from leaving rows belonging to a toolbar that no longer exists.
   */
  deleteToolbar(id: number): void {
    this.db.transaction((toolbarId: number) => {
      this.db.prepare(`DELETE FROM sys_toolbar_items WHERE toolbar_id = ?`).run(toolbarId);
      this.db.prepare(`DELETE FROM sys_toolbars WHERE id = ?`).run(toolbarId);
    })(id);
  }

  addItem(toolbarId: number, item: ToolbarItemWrite): ToolbarItem {
    const next = this.db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM sys_toolbar_items WHERE toolbar_id = ?`,
      )
      .get(toolbarId) as { next: number };

    const result = this.db
      .prepare(
        `INSERT INTO sys_toolbar_items (toolbar_id, kind, menu_item_id, label, sort_order)
         VALUES (@toolbarId, @kind, @menuItemId, @label, @sortOrder)`,
      )
      .run({
        toolbarId,
        kind: item.kind,
        menuItemId: item.menuItemId ?? null,
        label: item.label ?? null,
        sortOrder: next.next,
      });

    const row = this.db
      .prepare(`SELECT ${ITEM_COLUMNS} FROM sys_toolbar_items WHERE id = ?`)
      .get(Number(result.lastInsertRowid)) as ItemRow;
    return toItem(row);
  }

  updateItem(itemId: number, item: ToolbarItemWrite): void {
    this.db
      .prepare(
        `UPDATE sys_toolbar_items SET kind = @kind, menu_item_id = @menuItemId, label = @label
         WHERE id = @id`,
      )
      .run({
        id: itemId,
        kind: item.kind,
        menuItemId: item.menuItemId ?? null,
        label: item.label ?? null,
      });
  }

  removeItem(itemId: number): void {
    this.db.prepare(`DELETE FROM sys_toolbar_items WHERE id = ?`).run(itemId);
  }

  /**
   * Rewrites the whole order in one transaction.
   *
   * `toolbar_id` is in the WHERE clause as well as the id: it makes a row from
   * another toolbar impossible to move by passing its id, rather than relying on
   * the use-case's check alone.
   */
  setItemOrder(toolbarId: number, itemIds: number[]): void {
    const statement = this.db.prepare(
      `UPDATE sys_toolbar_items SET sort_order = ? WHERE id = ? AND toolbar_id = ?`,
    );
    this.db.transaction((ids: number[]) => {
      ids.forEach((itemId, index) => statement.run(index, itemId, toolbarId));
    })(itemIds);
  }

  /** Shared binding, so the INSERT and the UPDATE can't disagree about nulls. */
  private bindToolbar(toolbar: ToolbarWrite) {
    return {
      name: toolbar.name,
      backgroundColor: toolbar.backgroundColor ?? null,
      borderColor: toolbar.borderColor ?? null,
      textColor: toolbar.textColor ?? null,
      edge: toolbar.edge,
      // SQLite has no boolean; the columns are 0/1 and the conversion happens here
      // rather than leaking an integer to every caller.
      fullModeOnly: toolbar.fullModeOnly ? 1 : 0,
      isVisible: toolbar.isVisible ? 1 : 0,
    };
  }
}
