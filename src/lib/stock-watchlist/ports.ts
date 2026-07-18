import type {
  AddWatchListItemInput,
  CreateWatchListInput,
  RenameWatchListInput,
  UpdateWatchListItemReminderInput,
} from "./schema";
import type { StockWatchList, StockWatchListItem } from "./types";

export interface StockWatchListRepository {
  listWatchLists(): StockWatchList[];
  getWatchListById(id: number): StockWatchList | undefined;
  createWatchList(input: CreateWatchListInput): StockWatchList;
  renameWatchList(id: number, input: RenameWatchListInput): StockWatchList;
  /** Deletes the list and all its items in one transaction. */
  deleteWatchList(id: number): void;

  listItems(watchListId: number): StockWatchListItem[];
  getItemById(id: number): StockWatchListItem | undefined;
  addItem(input: AddWatchListItemInput, priceWhenAddedCents: number): StockWatchListItem;
  updateItemReminder(id: number, input: UpdateWatchListItemReminderInput): StockWatchListItem;
  deleteItem(id: number): void;
}
