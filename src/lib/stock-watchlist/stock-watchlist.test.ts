import { describe, expect, it } from "vitest";
import type { MarketDataClient, Quote } from "@/lib/market-data";
import {
  addItem,
  createWatchList,
  deleteItem,
  deleteWatchList,
  listItems,
  listWatchLists,
  renameWatchList,
  updateItemReminder,
} from "./stock-watchlist";
import type { StockWatchListRepository } from "./ports";
import type { AddWatchListItemInput } from "./schema";
import type { StockWatchList, StockWatchListItem } from "./types";

// Hand-written fake — no mocking framework, reusable across tests.
function fakeRepo(
  seedLists: StockWatchList[] = [],
  seedItems: StockWatchListItem[] = [],
): StockWatchListRepository {
  let lists = [...seedLists];
  let items = [...seedItems];
  let nextListId = lists.reduce((max, list) => Math.max(max, list.id), 0) + 1;
  let nextItemId = items.reduce((max, item) => Math.max(max, item.id), 0) + 1;

  return {
    listWatchLists() {
      return [...lists];
    },
    getWatchListById(id) {
      return lists.find((list) => list.id === id);
    },
    createWatchList(input) {
      const created: StockWatchList = {
        id: nextListId++,
        ...input,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      lists.push(created);
      return created;
    },
    renameWatchList(id, input) {
      lists = lists.map((list) => (list.id === id ? { ...list, ...input } : list));
      const updated = lists.find((list) => list.id === id);
      if (!updated) throw new Error(`Watch list ${id} not found.`);
      return updated;
    },
    deleteWatchList(id) {
      lists = lists.filter((list) => list.id !== id);
      items = items.filter((item) => item.watchListId !== id);
    },
    listItems(watchListId) {
      return items.filter((item) => item.watchListId === watchListId);
    },
    getItemById(id) {
      return items.find((item) => item.id === id);
    },
    addItem(input, priceWhenAddedCents) {
      const created: StockWatchListItem = {
        id: nextItemId++,
        ...input,
        priceWhenAddedCents,
        reminderMessage: "",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      items.push(created);
      return created;
    },
    updateItemReminder(id, input) {
      items = items.map((item) => (item.id === id ? { ...item, ...input } : item));
      const updated = items.find((item) => item.id === id);
      if (!updated) throw new Error(`Watch list item ${id} not found.`);
      return updated;
    },
    deleteItem(id) {
      items = items.filter((item) => item.id !== id);
    },
  };
}

function fakeMarketDataClient(quote: Quote): MarketDataClient {
  return {
    async getQuote(ticker) {
      if (ticker !== quote.ticker) throw new Error(`No quote for ${ticker}.`);
      return quote;
    },
    async getHistory() {
      return [];
    },
  };
}

const sampleList: StockWatchList = {
  id: 1,
  name: "Tech Watchlist",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("createWatchList", () => {
  it("creates a watch list", () => {
    const repo = fakeRepo();
    const created = createWatchList(repo, { name: "New List" });
    expect(created.id).toBe(1);
    expect(listWatchLists(repo)).toHaveLength(1);
  });

  it("rejects an empty name", () => {
    const repo = fakeRepo();
    expect(() => createWatchList(repo, { name: "" })).toThrow();
  });
});

describe("renameWatchList", () => {
  it("renames the list", () => {
    const repo = fakeRepo([sampleList]);
    const renamed = renameWatchList(repo, 1, { name: "Renamed" });
    expect(renamed.name).toBe("Renamed");
  });
});

describe("deleteWatchList", () => {
  it("removes the list and its items", () => {
    const repo = fakeRepo([sampleList], [
      {
        id: 1,
        watchListId: 1,
        ticker: "AAPL",
        shares: 5,
        priceWhenAddedCents: 15000,
        addedDate: "2026-01-01",
        reminderMessage: "",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    deleteWatchList(repo, 1);
    expect(listWatchLists(repo)).toHaveLength(0);
    expect(listItems(repo, 1)).toHaveLength(0);
  });
});

describe("addItem", () => {
  const validInput: AddWatchListItemInput = {
    watchListId: 1,
    ticker: "AAPL",
    shares: 5,
    addedDate: "2026-01-15",
  };
  const quote: Quote = {
    ticker: "AAPL",
    priceCents: 15000,
    previousCloseCents: 14900,
    dayHighCents: 15200,
    dayLowCents: 14800,
    dividendRateCents: 96,
  };

  it("adds the item with the live price snapshotted", async () => {
    const repo = fakeRepo([sampleList]);
    const client = fakeMarketDataClient(quote);
    const item = await addItem(repo, client, validInput);
    expect(item.priceWhenAddedCents).toBe(15000);
    expect(listItems(repo, 1)).toHaveLength(1);
  });

  it("rejects an item for a non-existent watch list", async () => {
    const repo = fakeRepo([]);
    const client = fakeMarketDataClient(quote);
    await expect(addItem(repo, client, validInput)).rejects.toThrow();
  });

  it("propagates a quote failure for an unknown ticker", async () => {
    const repo = fakeRepo([sampleList]);
    const client = fakeMarketDataClient(quote);
    await expect(addItem(repo, client, { ...validInput, ticker: "ZZZZ" })).rejects.toThrow();
  });
});

describe("updateItemReminder and deleteItem", () => {
  const seedItem: StockWatchListItem = {
    id: 1,
    watchListId: 1,
    ticker: "AAPL",
    shares: 5,
    priceWhenAddedCents: 15000,
    addedDate: "2026-01-01",
    reminderMessage: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("sets a reminder", () => {
    const repo = fakeRepo([sampleList], [seedItem]);
    const updated = updateItemReminder(repo, 1, {
      reminderAt: "2026-02-01T00:00:00.000Z",
      reminderMessage: "Check earnings",
    });
    expect(updated.reminderMessage).toBe("Check earnings");
  });

  it("removes the item", () => {
    const repo = fakeRepo([sampleList], [seedItem]);
    deleteItem(repo, 1);
    expect(listItems(repo, 1)).toHaveLength(0);
  });
});
