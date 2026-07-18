import type Database from "better-sqlite3";
import type { StockWatchListRepository } from "./ports";
import { stockWatchListItemSchema, stockWatchListSchema } from "./schema";
import type {
  AddWatchListItemInput,
  CreateWatchListInput,
  RenameWatchListInput,
  UpdateWatchListItemReminderInput,
} from "./schema";
import type { StockWatchList, StockWatchListItem } from "./types";

interface WatchListRow {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

interface WatchListItemRow {
  id: number;
  watch_list_id: number;
  ticker: string;
  shares: number;
  price_when_added_cents: number;
  added_date: string;
  reminder_at: string | null;
  reminder_message: string;
  created_at: string;
  updated_at: string;
}

function watchListToDomain(row: WatchListRow): StockWatchList {
  return stockWatchListSchema.parse({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function itemToDomain(row: WatchListItemRow): StockWatchListItem {
  return stockWatchListItemSchema.parse({
    id: row.id,
    watchListId: row.watch_list_id,
    ticker: row.ticker,
    shares: row.shares,
    priceWhenAddedCents: row.price_when_added_cents,
    addedDate: row.added_date,
    reminderAt: row.reminder_at ?? undefined,
    reminderMessage: row.reminder_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

// The real repository. Swap the database without touching any use-case.
export class SqliteStockWatchListRepository implements StockWatchListRepository {
  constructor(private db: Database.Database) {}

  listWatchLists(): StockWatchList[] {
    const rows = this.db
      .prepare("SELECT * FROM stock_watch_lists ORDER BY created_at ASC")
      .all() as WatchListRow[];
    return rows.map(watchListToDomain);
  }

  getWatchListById(id: number): StockWatchList | undefined {
    const row = this.db.prepare("SELECT * FROM stock_watch_lists WHERE id = ?").get(id) as
      | WatchListRow
      | undefined;
    return row ? watchListToDomain(row) : undefined;
  }

  createWatchList(input: CreateWatchListInput): StockWatchList {
    const result = this.db.prepare("INSERT INTO stock_watch_lists (name) VALUES (@name)").run(input);
    const created = this.getWatchListById(Number(result.lastInsertRowid));
    if (!created) throw new Error("Failed to read back newly created watch list.");
    return created;
  }

  renameWatchList(id: number, input: RenameWatchListInput): StockWatchList {
    this.db.prepare("UPDATE stock_watch_lists SET name = @name WHERE id = @id").run({ ...input, id });
    const updated = this.getWatchListById(id);
    if (!updated) throw new Error(`Failed to read back updated watch list ${id}.`);
    return updated;
  }

  deleteWatchList(id: number): void {
    const deleteItems = this.db.prepare("DELETE FROM stock_watch_list_items WHERE watch_list_id = ?");
    const deleteList = this.db.prepare("DELETE FROM stock_watch_lists WHERE id = ?");
    this.db.transaction(() => {
      deleteItems.run(id);
      deleteList.run(id);
    })();
  }

  listItems(watchListId: number): StockWatchListItem[] {
    const rows = this.db
      .prepare("SELECT * FROM stock_watch_list_items WHERE watch_list_id = ? ORDER BY added_date ASC")
      .all(watchListId) as WatchListItemRow[];
    return rows.map(itemToDomain);
  }

  getItemById(id: number): StockWatchListItem | undefined {
    const row = this.db.prepare("SELECT * FROM stock_watch_list_items WHERE id = ?").get(id) as
      | WatchListItemRow
      | undefined;
    return row ? itemToDomain(row) : undefined;
  }

  addItem(input: AddWatchListItemInput, priceWhenAddedCents: number): StockWatchListItem {
    const result = this.db
      .prepare(
        `INSERT INTO stock_watch_list_items (watch_list_id, ticker, shares, price_when_added_cents, added_date)
         VALUES (@watchListId, @ticker, @shares, @priceWhenAddedCents, @addedDate)`,
      )
      .run({ ...input, priceWhenAddedCents });

    const created = this.getItemById(Number(result.lastInsertRowid));
    if (!created) throw new Error("Failed to read back newly created watch list item.");
    return created;
  }

  updateItemReminder(id: number, input: UpdateWatchListItemReminderInput): StockWatchListItem {
    this.db
      .prepare(
        `UPDATE stock_watch_list_items
         SET reminder_at = @reminderAt, reminder_message = @reminderMessage
         WHERE id = @id`,
      )
      .run({ reminderAt: input.reminderAt ?? null, reminderMessage: input.reminderMessage, id });

    const updated = this.getItemById(id);
    if (!updated) throw new Error(`Failed to read back updated watch list item ${id}.`);
    return updated;
  }

  deleteItem(id: number): void {
    this.db.prepare("DELETE FROM stock_watch_list_items WHERE id = ?").run(id);
  }
}
