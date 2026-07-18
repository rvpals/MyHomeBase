export interface StockWatchList {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface StockWatchListItem {
  id: number;
  watchListId: number;
  ticker: string;
  shares: number;
  priceWhenAddedCents: number;
  addedDate: string;
  reminderAt?: string;
  reminderMessage: string;
  createdAt: string;
  updatedAt: string;
}
