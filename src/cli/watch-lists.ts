// Watch lists and their watch conditions from the terminal — the same
// use-cases the Investments module's Watch Lists screen drives.
//
//   npm run cli -- watch-lists lists
//   npm run cli -- watch-lists items 1
//   npm run cli -- watch-lists add 1 NVDA 2026-09-23
//   npm run cli -- watch-lists watch 4 price 100
//   npm run cli -- watch-lists watch 4 price-range 10 15
//   npm run cli -- watch-lists watch 4 dividend
//   npm run cli -- watch-lists watch 4 gain-loss-pct 20
//   npm run cli -- watch-lists watch 4 gain-loss-price 10
//   npm run cli -- watch-lists watch 4 none
//   npm run cli -- watch-lists run [--with-events]
//
// `run` exists so a cron job can fire watches without the web app — which is
// the point of the pass being a library use-case rather than a screen.

import {
  addItem,
  listItems,
  listWatchLists,
  listWatchedItems,
  runWatchListWatches,
  summarizeWatch,
  updateItemWatch,
  type StockWatchListItem,
  type UpdateWatchListItemWatchInput,
  type WatchKind,
} from "@/lib/stock-watchlist";
import { formatCents } from "@/lib/shared/money";
import { deps } from "@/lib/wiring";
import { messageOf } from "./error-message";

const USAGE = `Usage:
  watch-lists lists
  watch-lists items <watchListId>
  watch-lists add <watchListId> <ticker> <addedDate> [shares]
  watch-lists watch <itemId> <kind> [value] [highValue]
  watch-lists run [--with-events]

  <kind> is one of:
    price <dollars>              price hits the target
    price-range <low> <high>     price sits inside the range
    dividend                     a dividend is issued
    split                        a split happens
    gain-loss-pct <percent>      price swings +/- that percent since added
    gain-loss-price <dollars>    price swings +/- that much per share
    none                         stop watching`;

/**
 * The CLI's hyphenated spelling to the stored kind. A separate map rather than
 * accepting the storage values directly, so `gain_loss_pct` in a shell — where
 * an underscore reads badly — is not the only way to say it.
 */
const KIND_BY_NAME: Record<string, WatchKind> = {
  price: "price",
  "price-range": "price_range",
  dividend: "dividend",
  split: "split",
  "gain-loss-pct": "gain_loss_pct",
  "gain-loss-price": "gain_loss_price",
};

function printItem(item: StockWatchListItem): void {
  const mark = item.watchIsTriggered ? "*" : " ";
  console.log(
    `${mark} [${item.id}] ${item.ticker.padEnd(6)} added ${item.addedDate} at ${formatCents(item.priceWhenAddedCents)}  —  ${summarizeWatch(item)}`,
  );
  if (item.watchLastMessage !== "") console.log(`         ${item.watchLastMessage}`);
}

/** Builds the watch input from the positional arguments, in domain units. */
function toWatchInput(kindName: string, value?: string, high?: string): UpdateWatchListItemWatchInput {
  if (kindName === "none") return { watchKind: "" };

  const watchKind = KIND_BY_NAME[kindName];
  if (!watchKind) throw new Error(`Unknown kind: "${kindName}".`);
  if (watchKind === "dividend" || watchKind === "split") return { watchKind };

  const amount = Number(value ?? "");
  if (!Number.isFinite(amount)) throw new Error(`Not a number: "${value}"`);

  // Dollars in, cents stored — the same conversion the web form makes. The
  // percentage kind is the one exception, and is stored as typed.
  const isPercent = watchKind === "gain_loss_pct";
  const toStored = (dollars: number): number => (isPercent ? dollars : Math.round(dollars * 100));

  if (watchKind === "price_range") {
    const highAmount = Number(high ?? "");
    if (!Number.isFinite(highAmount)) throw new Error(`Not a number: "${high}"`);
    return {
      watchKind,
      watchValue: toStored(amount),
      watchValueHigh: toStored(highAmount),
    };
  }

  return { watchKind, watchValue: toStored(amount) };
}

export async function watchListsCommand(args: string[]): Promise<void> {
  const [action, ...rest] = args;

  // Wrapped for the same reason every other write command is: the schema throws
  // on an unset value or an inverted range, and that should print as a message
  // with an exit code rather than a stack trace.
  try {
    switch (action) {
      case undefined:
      case "lists": {
        const lists = listWatchLists(deps.stockWatchListRepo);
        if (lists.length === 0) {
          console.log("No watch lists yet.");
          return;
        }
        for (const list of lists) {
          const count = listItems(deps.stockWatchListRepo, list.id).length;
          console.log(`[${list.id}] ${list.name} — ${count} ticker(s)`);
        }
        return;
      }

      case "items": {
        const watchListId = Number(rest[0]);
        if (!Number.isInteger(watchListId)) {
          console.error(USAGE);
          process.exitCode = 1;
          return;
        }
        const items = listItems(deps.stockWatchListRepo, watchListId);
        if (items.length === 0) {
          console.log("Nothing on this list yet.");
          return;
        }
        for (const item of items) printItem(item);
        return;
      }

      case "add": {
        const [listId, ticker, addedDate, shares] = rest;
        const watchListId = Number(listId);
        if (!Number.isInteger(watchListId) || !ticker || !addedDate) {
          console.error(USAGE);
          process.exitCode = 1;
          return;
        }
        const item = await addItem(deps.stockWatchListRepo, deps.marketDataClient, {
          watchListId,
          ticker,
          addedDate,
          // Left to the schema's default when the argument is absent, rather
          // than repeating the zero here where it could drift.
          ...(shares === undefined ? {} : { shares: Number(shares) }),
        });
        console.log(`Added [${item.id}] ${item.ticker} at ${formatCents(item.priceWhenAddedCents)}.`);
        return;
      }

      case "watch": {
        const [itemId, kindName, value, high] = rest;
        const id = Number(itemId);
        if (!Number.isInteger(id) || !kindName) {
          console.error(USAGE);
          process.exitCode = 1;
          return;
        }
        const updated = updateItemWatch(
          deps.stockWatchListRepo,
          id,
          toWatchInput(kindName, value, high),
        );
        console.log(`Item ${id} now watching: ${summarizeWatch(updated)}`);
        return;
      }

      case "run": {
        const watched = listWatchedItems(deps.stockWatchListRepo);
        if (watched.length === 0) {
          console.log("Nothing is being watched.");
          return;
        }

        // Off by default, matching the manual Refresh All button: corporate
        // actions cost one call per ticker on top of the quote. The scheduled
        // pass always includes them (migrations/0111).
        const withEvents = rest.includes("--with-events");

        const result = await runWatchListWatches({
          repo: deps.stockWatchListRepo,
          marketDataClient: deps.marketDataClient,
          messages: deps.messageRepo,
          ...(withEvents ? { eventsClient: deps.marketEventsClient } : {}),
        });

        console.log(
          `Evaluated ${result.evaluated}, triggered ${result.triggered}, re-armed ${result.cleared}.`,
        );
        if (result.triggeredTickers.length > 0) {
          console.log(`Fired: ${result.triggeredTickers.join(", ")}`);
        }
        if (!withEvents) {
          console.log("Dividends and splits were skipped — pass --with-events to include them.");
        }
        return;
      }

      default:
        console.error(USAGE);
        process.exitCode = 1;
    }
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}
