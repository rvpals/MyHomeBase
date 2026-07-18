"use server";

import { revalidatePath } from "next/cache";
import { addItem, createWatchList, deleteItem, deleteWatchList, renameWatchList } from "@/lib/stock-watchlist";
import { deps } from "@/lib/wiring";

const STOCK_ETFS_MODULE_PATH = "/modules/stock-etfs";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

export async function createWatchListAction(name: string): Promise<ActionResult> {
  try {
    createWatchList(deps.stockWatchListRepo, { name });
  } catch (error) {
    return toErrorResult(error, "Failed to create watch list.");
  }
  revalidatePath(STOCK_ETFS_MODULE_PATH);
  return { ok: true };
}

export async function renameWatchListAction(watchListId: number, name: string): Promise<ActionResult> {
  try {
    renameWatchList(deps.stockWatchListRepo, watchListId, { name });
  } catch (error) {
    return toErrorResult(error, "Failed to rename watch list.");
  }
  revalidatePath(STOCK_ETFS_MODULE_PATH);
  return { ok: true };
}

export async function deleteWatchListAction(watchListId: number): Promise<ActionResult> {
  try {
    deleteWatchList(deps.stockWatchListRepo, watchListId);
  } catch (error) {
    return toErrorResult(error, "Failed to delete watch list.");
  }
  revalidatePath(STOCK_ETFS_MODULE_PATH);
  return { ok: true };
}

export interface AddWatchListItemFormInput {
  ticker: string;
  shares: string;
  addedDate: string;
}

export async function addWatchListItemAction(
  watchListId: number,
  input: AddWatchListItemFormInput,
): Promise<ActionResult> {
  try {
    await addItem(deps.stockWatchListRepo, deps.marketDataClient, {
      watchListId,
      ticker: input.ticker,
      shares: Number(input.shares || "0"),
      addedDate: input.addedDate,
    });
  } catch (error) {
    return toErrorResult(error, "Failed to add ticker to watch list.");
  }
  revalidatePath(STOCK_ETFS_MODULE_PATH);
  return { ok: true };
}

export async function deleteWatchListItemAction(itemId: number): Promise<ActionResult> {
  try {
    deleteItem(deps.stockWatchListRepo, itemId);
  } catch (error) {
    return toErrorResult(error, "Failed to remove ticker from watch list.");
  }
  revalidatePath(STOCK_ETFS_MODULE_PATH);
  return { ok: true };
}
