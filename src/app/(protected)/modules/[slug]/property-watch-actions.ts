"use server";

import { revalidatePath } from "next/cache";
import {
  addToWatchlist,
  lookupProperty,
  refreshWatchedProperty,
  removeFromWatchlist,
  type PropertyDetails,
} from "@/lib/property-watch";
import { deps } from "@/lib/wiring";

const REAL_ESTATE_MODULE_PATH = "/modules/real-estate-investment";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface LookupResult extends ActionResult {
  details?: PropertyDetails;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

export async function lookupPropertyAction(address: string): Promise<LookupResult> {
  if (!deps.propertyLookupClient) {
    return { ok: false, error: "Property lookup isn't configured." };
  }

  try {
    const details = await lookupProperty(deps.propertyLookupClient, address);
    return { ok: true, details };
  } catch (error) {
    return toErrorResult(error, "Failed to look up property.");
  }
}

export async function addToWatchlistAction(
  address: string,
  details: PropertyDetails,
): Promise<ActionResult> {
  try {
    addToWatchlist(deps.watchedPropertyRepo, address, details);
  } catch (error) {
    return toErrorResult(error, "Failed to add property to watch list.");
  }
  revalidatePath(REAL_ESTATE_MODULE_PATH);
  return { ok: true };
}

export async function refreshWatchlistAction(watchedPropertyId: number): Promise<ActionResult> {
  if (!deps.propertyLookupClient) {
    return { ok: false, error: "Property lookup isn't configured." };
  }

  try {
    await refreshWatchedProperty(deps.watchedPropertyRepo, deps.propertyLookupClient, watchedPropertyId);
  } catch (error) {
    return toErrorResult(error, "Failed to refresh property.");
  }
  revalidatePath(REAL_ESTATE_MODULE_PATH);
  return { ok: true };
}

export async function removeFromWatchlistAction(watchedPropertyId: number): Promise<ActionResult> {
  try {
    removeFromWatchlist(deps.watchedPropertyRepo, watchedPropertyId);
  } catch (error) {
    return toErrorResult(error, "Failed to remove property from watch list.");
  }
  revalidatePath(REAL_ESTATE_MODULE_PATH);
  return { ok: true };
}
