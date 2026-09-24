import type {
  CreateWatchListInput,
  RenameWatchListInput,
  UpdateWatchListItemReminderInput,
  UpdateWatchListItemWatch,
} from "./schema";
import type { StockWatchList, StockWatchListItem } from "./types";

/** The validated add input, as the repository receives it — defaults applied. */
export interface AddWatchListItemFields {
  watchListId: number;
  ticker: string;
  shares: number;
  addedDate: string;
  watchKind: StockWatchListItem["watchKind"];
  watchValue: number;
  watchValueHigh: number;
}

export interface StockWatchListRepository {
  listWatchLists(): StockWatchList[];
  getWatchListById(id: number): StockWatchList | undefined;
  createWatchList(input: CreateWatchListInput): StockWatchList;
  renameWatchList(id: number, input: RenameWatchListInput): StockWatchList;
  /** Deletes the list and all its items in one transaction. */
  deleteWatchList(id: number): void;

  listItems(watchListId: number): StockWatchListItem[];
  getItemById(id: number): StockWatchListItem | undefined;
  addItem(input: AddWatchListItemFields, priceWhenAddedCents: number): StockWatchListItem;
  updateItemReminder(id: number, input: UpdateWatchListItemReminderInput): StockWatchListItem;
  deleteItem(id: number): void;

  /**
   * Every row across every list that is actually watching something.
   *
   * One read rather than a walk over the lists: the refresh pass wants the
   * watched rows and nothing else, and most rows are not watched (which is what
   * the partial index in 0111 is for).
   */
  listWatchedItems(): StockWatchListItem[];

  /** Sets, changes or clears the watch on a row. Clearing resets the latch. */
  updateItemWatch(id: number, input: UpdateWatchListItemWatch): StockWatchListItem;

  /**
   * Moves the latch. `lastTriggeredAt` is the caller's business because the
   * event kinds store the *event's* date there as a cursor, not the clock.
   */
  setItemTriggered(
    id: number,
    isTriggered: boolean,
    message: string,
    lastTriggeredAt?: string,
  ): void;
}
