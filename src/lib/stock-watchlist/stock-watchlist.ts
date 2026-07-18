import type { MarketDataClient } from "@/lib/market-data";
import type { StockWatchListRepository } from "./ports";
import {
  addWatchListItemSchema,
  createWatchListSchema,
  renameWatchListSchema,
  updateWatchListItemReminderSchema,
} from "./schema";
import type {
  AddWatchListItemInput,
  CreateWatchListInput,
  RenameWatchListInput,
  UpdateWatchListItemReminderInput,
} from "./schema";
import type { StockWatchList, StockWatchListItem } from "./types";

export function listWatchLists(repo: StockWatchListRepository): StockWatchList[] {
  return repo.listWatchLists();
}

export function createWatchList(
  repo: StockWatchListRepository,
  input: CreateWatchListInput,
): StockWatchList {
  const validated = createWatchListSchema.parse(input);
  return repo.createWatchList(validated);
}

export function renameWatchList(
  repo: StockWatchListRepository,
  id: number,
  input: RenameWatchListInput,
): StockWatchList {
  const validated = renameWatchListSchema.parse(input);
  return repo.renameWatchList(id, validated);
}

export function deleteWatchList(repo: StockWatchListRepository, id: number): void {
  repo.deleteWatchList(id);
}

export function listItems(repo: StockWatchListRepository, watchListId: number): StockWatchListItem[] {
  return repo.listItems(watchListId);
}

/** Adds a ticker to a watch list, snapshotting its live price at the moment it's added. */
export async function addItem(
  repo: StockWatchListRepository,
  client: MarketDataClient,
  input: AddWatchListItemInput,
): Promise<StockWatchListItem> {
  const validated = addWatchListItemSchema.parse(input);
  if (!repo.getWatchListById(validated.watchListId)) {
    throw new Error(`No watch list with id ${validated.watchListId}.`);
  }

  const quote = await client.getQuote(validated.ticker);
  return repo.addItem(validated, quote.priceCents);
}

export function updateItemReminder(
  repo: StockWatchListRepository,
  id: number,
  input: UpdateWatchListItemReminderInput,
): StockWatchListItem {
  const validated = updateWatchListItemReminderSchema.parse(input);
  return repo.updateItemReminder(id, validated);
}

export function deleteItem(repo: StockWatchListRepository, id: number): void {
  repo.deleteItem(id);
}
