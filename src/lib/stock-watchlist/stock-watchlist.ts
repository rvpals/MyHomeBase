import type { MarketDataClient, MarketEventsClient } from "@/lib/market-data";
import { createMessage, type MessageRepository } from "@/lib/messages";
import type { StockWatchListRepository } from "./ports";
import {
  addWatchListItemSchema,
  createWatchListSchema,
  renameWatchListSchema,
  updateWatchListItemReminderSchema,
  updateWatchListItemWatchSchema,
} from "./schema";
import type {
  AddWatchListItemInput,
  CreateWatchListInput,
  RenameWatchListInput,
  UpdateWatchListItemReminderInput,
  UpdateWatchListItemWatchInput,
} from "./schema";
import type { StockWatchList, StockWatchListItem, WatchRunResult } from "./types";
import { isEventWatchKind } from "./types";
import { evaluateEventWatch, evaluatePriceWatch } from "./watch-condition";

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

/**
 * Sets, changes or clears the watch on a row.
 *
 * Clearing is `{ watchKind: "" }` — the same call, because "stop watching this"
 * is a change to the condition rather than a separate operation.
 */
export function updateItemWatch(
  repo: StockWatchListRepository,
  id: number,
  input: UpdateWatchListItemWatchInput,
): StockWatchListItem {
  const validated = updateWatchListItemWatchSchema.parse(input);
  return repo.updateItemWatch(id, validated);
}

export function deleteItem(repo: StockWatchListRepository, id: number): void {
  repo.deleteItem(id);
}

/** Every watched row, across every list. What the refresh pass evaluates. */
export function listWatchedItems(repo: StockWatchListRepository): StockWatchListItem[] {
  return repo.listWatchedItems();
}

/**
 * Which of a list's rows are firing *right now*.
 *
 * Read-only: it files nothing and touches no latch, so it is safe to call on
 * every render. Takes the prices it judges against rather than fetching them,
 * because the screen already has them.
 *
 * Only the price kinds are judged here — `dividend` and `split` would need a
 * network call per ticker, which a render must not make. Their state comes from
 * `watchLastMessage`, written by the last scheduled pass.
 */
export function activeWatchesForItems(
  items: readonly StockWatchListItem[],
  pricesByTicker: ReadonlyMap<string, number>,
): { item: StockWatchListItem; message: string }[] {
  return items
    .map((item) => {
      const price = pricesByTicker.get(item.ticker);
      if (price == null) return undefined;
      const evaluation = evaluatePriceWatch(item, price);
      return evaluation.isActive ? { item, message: evaluation.message } : undefined;
    })
    .filter((entry): entry is { item: StockWatchListItem; message: string } => entry !== undefined);
}

/**
 * What `runWatchListWatches` needs. Grouped into one object because the event
 * client is optional and a five-argument call would read as a puzzle.
 */
export interface RunWatchesDeps {
  repo: StockWatchListRepository;
  marketDataClient: MarketDataClient;
  messages: MessageRepository;
  /**
   * Corporate actions, for the `dividend` and `split` kinds. **Optional**: it
   * is one network call per ticker on top of the quote, so the manual refresh
   * button leaves it out and the timed pass supplies it. Without it those two
   * kinds are skipped entirely rather than reported as quiet — see
   * migrations/0111.
   */
  eventsClient?: MarketEventsClient;
  /** How far back to ask for events. A quarter covers a missed dividend. */
  eventRange?: string;
}

/**
 * Run every watched row and file a message for each one that newly fired.
 *
 * **This is what a price refresh calls.** Three things happen per row:
 *
 *   1. Evaluate against the ticker's current price (or its recent events).
 *   2. If it newly became true, file a message and set the latch.
 *   3. If it has ceased to be true, clear the latch so the next crossing
 *      reports.
 *
 * Quotes are fetched once per *ticker* rather than once per row: the same
 * symbol on two watch lists is two conditions over one price, and fetching it
 * twice would be the same call for the same answer.
 *
 * Never throws on a single ticker's failure — a delisted symbol must not stop
 * the rest of the pass.
 */
export async function runWatchListWatches(deps: RunWatchesDeps): Promise<WatchRunResult> {
  const items = deps.repo.listWatchedItems();
  const result: WatchRunResult = {
    evaluated: 0,
    triggered: 0,
    cleared: 0,
    triggeredTickers: [],
  };

  const prices = new Map<string, number>();
  const events = new Map<string, Awaited<ReturnType<MarketEventsClient["getEvents"]>>>();

  for (const item of items) {
    const needsEvents = isEventWatchKind(item.watchKind);

    // The event kinds are skipped outright when no client was supplied, rather
    // than evaluated against an empty list — "we did not look" and "there was
    // no dividend" must not both clear the latch.
    if (needsEvents && !deps.eventsClient) continue;

    try {
      let evaluation;

      if (needsEvents && deps.eventsClient) {
        let ticker = events.get(item.ticker);
        if (!ticker) {
          ticker = await deps.eventsClient.getEvents(item.ticker, deps.eventRange ?? "3mo");
          events.set(item.ticker, ticker);
        }
        evaluation = evaluateEventWatch(item, ticker);
      } else {
        let price = prices.get(item.ticker);
        if (price == null) {
          const quote = await deps.marketDataClient.getQuote(item.ticker);
          price = quote.priceCents;
          prices.set(item.ticker, price);
        }
        evaluation = evaluatePriceWatch(item, price);
      }

      result.evaluated += 1;

      if (evaluation.shouldNotify) {
        createMessage(deps.messages, {
          title: `${item.ticker}: watch triggered`,
          body: evaluation.message,
          source: "Investments watch list",
        });
        deps.repo.setItemTriggered(item.id, true, evaluation.message, evaluation.eventDate);
        result.triggered += 1;
        if (!result.triggeredTickers.includes(item.ticker)) {
          result.triggeredTickers.push(item.ticker);
        }
        continue;
      }

      // Ceased to hold — re-arm, so the next crossing reports again. Only
      // written when the latch is actually set, so a quiet watch costs no
      // writes. The event kinds never latch this way (their cursor does the
      // de-duplication), so they are left alone.
      if (!evaluation.isActive && item.watchIsTriggered && !needsEvents) {
        deps.repo.setItemTriggered(item.id, false, "");
        result.cleared += 1;
      }
    } catch {
      // One ticker's quote or event fetch failed. Deliberately ignored: a watch
      // is a courtesy on top of the refresh, and a delisted symbol must not
      // stop the rest of the pass.
    }
  }

  return result;
}
