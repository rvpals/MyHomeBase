import { describe, expect, it } from "vitest";
import type { MarketDataClient, Quote } from "@/lib/market-data";
import { FakeMessageRepository } from "@/lib/messages";
import {
  addItem,
  createWatchList,
  deleteItem,
  deleteWatchList,
  listItems,
  listWatchLists,
  listWatchedItems,
  renameWatchList,
  runWatchListWatches,
  updateItemReminder,
  updateItemWatch,
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
        watchIsTriggered: false,
        watchLastMessage: "",
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
    listWatchedItems() {
      return items.filter((item) => item.watchKind !== "");
    },
    updateItemWatch(id, input) {
      // Mirrors the real repository: changing the watch resets the latch, so a
      // new target's first crossing is not swallowed by the old one's.
      items = items.map((item) =>
        item.id === id
          ? {
              ...item,
              ...input,
              watchIsTriggered: false,
              watchLastTriggeredAt: undefined,
              watchLastMessage: "",
            }
          : item,
      );
      const updated = items.find((item) => item.id === id);
      if (!updated) throw new Error(`Watch list item ${id} not found.`);
      return updated;
    },
    setItemTriggered(id, isTriggered, message, lastTriggeredAt) {
      items = items.map((item) =>
        item.id === id
          ? {
              ...item,
              watchIsTriggered: isTriggered,
              watchLastMessage: message,
              // Left alone when the caller passes nothing, so clearing a latch
              // keeps the event cursor it was carrying.
              watchLastTriggeredAt: lastTriggeredAt ?? item.watchLastTriggeredAt,
            }
          : item,
      );
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
        watchKind: "",
        watchValue: 0,
        watchValueHigh: 0,
        watchIsTriggered: false,
        watchLastMessage: "",
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
    watchKind: "",
    watchValue: 0,
    watchValueHigh: 0,
    watchIsTriggered: false,
    watchLastMessage: "",
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

describe("updateItemWatch", () => {
  const seedItem: StockWatchListItem = {
    id: 1,
    watchListId: 1,
    ticker: "AAPL",
    shares: 5,
    priceWhenAddedCents: 15000,
    addedDate: "2026-01-01",
    reminderMessage: "",
    watchKind: "price",
    watchValue: 20000,
    watchValueHigh: 0,
    watchIsTriggered: true,
    watchLastTriggeredAt: "2026-02-01",
    watchLastMessage: "AAPL reached $200.00.",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("changes the watch and resets the latch", () => {
    // A new target's first crossing must not be swallowed by the old target's
    // latch — the rule coding-guide.md records for monitors, followed here.
    const repo = fakeRepo([sampleList], [seedItem]);
    const updated = updateItemWatch(repo, 1, { watchKind: "price", watchValue: 25000 });

    expect(updated.watchValue).toBe(25000);
    expect(updated.watchIsTriggered).toBe(false);
    expect(updated.watchLastMessage).toBe("");
  });

  it("clears the watch when given no kind", () => {
    const repo = fakeRepo([sampleList], [seedItem]);
    const cleared = updateItemWatch(repo, 1, { watchKind: "" });
    expect(cleared.watchKind).toBe("");
    expect(listWatchedItems(repo)).toHaveLength(0);
  });

  it("rejects a kind whose value was left unset", () => {
    const repo = fakeRepo([sampleList], [seedItem]);
    expect(() => updateItemWatch(repo, 1, { watchKind: "price", watchValue: 0 })).toThrow();
    expect(() => updateItemWatch(repo, 1, { watchKind: "gain_loss_pct" })).toThrow();
  });

  it("rejects a range whose high end is not above its low end", () => {
    const repo = fakeRepo([sampleList], [seedItem]);
    expect(() =>
      updateItemWatch(repo, 1, { watchKind: "price_range", watchValue: 1500, watchValueHigh: 1000 }),
    ).toThrow();
  });

  it("accepts the event kinds with no value at all", () => {
    const repo = fakeRepo([sampleList], [seedItem]);
    expect(updateItemWatch(repo, 1, { watchKind: "dividend" }).watchKind).toBe("dividend");
    expect(updateItemWatch(repo, 1, { watchKind: "split" }).watchKind).toBe("split");
  });
});

describe("runWatchListWatches", () => {
  function watchedItem(overrides: Partial<StockWatchListItem> = {}): StockWatchListItem {
    return {
      id: 1,
      watchListId: 1,
      ticker: "AAPL",
      shares: 0,
      priceWhenAddedCents: 10000,
      addedDate: "2026-01-01",
      reminderMessage: "",
      watchKind: "price",
      watchValue: 15000,
      watchValueHigh: 0,
      watchIsTriggered: false,
      watchLastMessage: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    };
  }

  function priceClient(pricesByTicker: Record<string, number>): MarketDataClient {
    return {
      async getQuote(ticker) {
        const priceCents = pricesByTicker[ticker];
        if (priceCents == null) throw new Error(`No quote for ${ticker}.`);
        return {
          ticker,
          priceCents,
          previousCloseCents: priceCents,
          dayHighCents: priceCents,
          dayLowCents: priceCents,
          dividendRateCents: 0,
        };
      },
      async getHistory() {
        return [];
      },
    };
  }

  it("files one message when a watch newly fires, and latches it", async () => {
    const repo = fakeRepo([sampleList], [watchedItem()]);
    const messages = new FakeMessageRepository();

    const result = await runWatchListWatches({
      repo,
      marketDataClient: priceClient({ AAPL: 15000 }),
      messages,
    });

    expect(result.triggered).toBe(1);
    expect(result.triggeredTickers).toEqual(["AAPL"]);
    expect(messages.messages).toHaveLength(1);
    expect(messages.messages[0].source).toBe("Investments watch list");
    expect(repo.getItemById(1)?.watchIsTriggered).toBe(true);
  });

  it("files nothing on a second pass while the condition still holds", async () => {
    const repo = fakeRepo([sampleList], [watchedItem({ watchIsTriggered: true })]);
    const messages = new FakeMessageRepository();

    const result = await runWatchListWatches({
      repo,
      marketDataClient: priceClient({ AAPL: 15000 }),
      messages,
    });

    expect(result.triggered).toBe(0);
    expect(messages.messages).toHaveLength(0);
  });

  it("re-arms a latched watch once its condition stops holding", async () => {
    const repo = fakeRepo([sampleList], [watchedItem({ watchIsTriggered: true })]);
    const messages = new FakeMessageRepository();

    const result = await runWatchListWatches({
      repo,
      marketDataClient: priceClient({ AAPL: 9000 }),
      messages,
    });

    expect(result.cleared).toBe(1);
    expect(repo.getItemById(1)?.watchIsTriggered).toBe(false);
  });

  it("skips the event kinds when no events client was supplied", async () => {
    // "We did not look" and "there was no dividend" must not both clear a latch.
    const repo = fakeRepo([sampleList], [watchedItem({ watchKind: "dividend" })]);
    const messages = new FakeMessageRepository();

    const result = await runWatchListWatches({
      repo,
      marketDataClient: priceClient({ AAPL: 15000 }),
      messages,
    });

    expect(result.evaluated).toBe(0);
    expect(messages.messages).toHaveLength(0);
  });

  it("fires an event watch and stores the event's date as the cursor", async () => {
    const repo = fakeRepo([sampleList], [watchedItem({ watchKind: "dividend" })]);
    const messages = new FakeMessageRepository();

    const result = await runWatchListWatches({
      repo,
      marketDataClient: priceClient({ AAPL: 15000 }),
      messages,
      eventsClient: {
        async getEvents() {
          return [
            {
              timestamp: Math.floor(Date.parse("2026-02-01T12:00:00.000Z") / 1000),
              kind: "dividend" as const,
              amountCents: 25,
            },
          ];
        },
      },
    });

    expect(result.triggered).toBe(1);
    expect(repo.getItemById(1)?.watchLastTriggeredAt).toBe("2026-02-01");
  });

  it("keeps going when one ticker's quote fails", async () => {
    const repo = fakeRepo(
      [sampleList],
      [watchedItem({ id: 1, ticker: "ZZZZ" }), watchedItem({ id: 2, ticker: "AAPL" })],
    );
    const messages = new FakeMessageRepository();

    const result = await runWatchListWatches({
      repo,
      marketDataClient: priceClient({ AAPL: 15000 }),
      messages,
    });

    // The unknown symbol is skipped; the good one still fires.
    expect(result.triggered).toBe(1);
    expect(result.triggeredTickers).toEqual(["AAPL"]);
  });

  it("ignores rows that are not watching anything", async () => {
    const repo = fakeRepo([sampleList], [watchedItem({ watchKind: "" })]);
    const messages = new FakeMessageRepository();

    const result = await runWatchListWatches({
      repo,
      marketDataClient: priceClient({ AAPL: 15000 }),
      messages,
    });

    expect(result.evaluated).toBe(0);
  });
});
