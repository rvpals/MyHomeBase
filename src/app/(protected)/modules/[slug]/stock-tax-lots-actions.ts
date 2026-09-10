"use server";

// Thin adapters for the Tax Lots section: validate input with the module's zod
// schema, call a `lib/tax-lots` use-case, revalidate. No calculation here — every
// figure the view shows comes from `analyzeTicker`, which the CLI drives identically.

import { revalidatePath } from "next/cache";
import {
  analyzeAdhocLots,
  analyzeAdhocLotsSchema,
  createTaxLot,
  createTaxLotSchema,
  deleteTaxLot,
  saveAdhocLots,
  saveAdhocLotsSchema,
  taxLotIdSchema,
  updateTaxLot,
  updateTaxLotSchema,
  type PortfolioAnalysis,
} from "@/lib/tax-lots";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "stock-etfs";

const TAX_LOTS_PATH = "/modules/stock-etfs/tax-lots";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

export async function createTaxLotAction(input: unknown): Promise<ActionResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    createTaxLot(deps.taxLotRepo, createTaxLotSchema.parse(input));
  } catch (error) {
    return toErrorResult(error, "Failed to add the lot.");
  }
  revalidatePath(TAX_LOTS_PATH);
  return { ok: true };
}

export async function updateTaxLotAction(id: unknown, input: unknown): Promise<ActionResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const key = taxLotIdSchema.parse({ id });
    updateTaxLot(deps.taxLotRepo, key.id, updateTaxLotSchema.parse(input));
  } catch (error) {
    return toErrorResult(error, "Failed to update the lot.");
  }
  revalidatePath(TAX_LOTS_PATH);
  return { ok: true };
}

export async function deleteTaxLotAction(id: unknown): Promise<ActionResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const key = taxLotIdSchema.parse({ id });
    deleteTaxLot(deps.taxLotRepo, key.id);
  } catch (error) {
    return toErrorResult(error, "Failed to delete the lot.");
  }
  revalidatePath(TAX_LOTS_PATH);
  return { ok: true };
}

/* ---------------------------------------------------------------------------------
   The ad-hoc analyzer. Same two rules as above: parse with the module's schema,
   call the use-case. Nothing here computes a figure.
--------------------------------------------------------------------------------- */

export interface AnalyzeAdhocResult extends ActionResult {
  analysis?: PortfolioAnalysis;
}

/**
 * Re-scores an edited transaction set without a page navigation.
 *
 * The screen could put every edit in the URL and let the server component re-render,
 * but that pushes a history entry per keystroke. This action is the same use-case
 * the URL path calls, so the two cannot report different numbers — and it stores
 * nothing, so there is no revalidate.
 */
export async function analyzeAdhocLotsAction(input: unknown): Promise<AnalyzeAdhocResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const analysis = analyzeAdhocLots(analyzeAdhocLotsSchema.parse(input));
    return { ok: true, analysis };
  } catch (error) {
    return toErrorResult(error, "Failed to analyze those transactions.");
  }
}

export interface SaveAdhocResult extends ActionResult {
  savedCount?: number;
  skippedCount?: number;
}

/**
 * Records an ad-hoc set as real lots, skipping ones already stored.
 *
 * The counts come back so the screen can say "3 saved, 2 already recorded" — the
 * duplicate skip has to be visible, or a user who pressed Save twice would have no
 * way to tell whether the second press did nothing or doubled their position.
 */
export async function saveAdhocLotsAction(input: unknown): Promise<SaveAdhocResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  let result;
  try {
    result = saveAdhocLots(deps.taxLotRepo, saveAdhocLotsSchema.parse(input));
  } catch (error) {
    return toErrorResult(error, "Failed to save those lots.");
  }
  revalidatePath(TAX_LOTS_PATH);
  return { ok: true, savedCount: result.saved.length, skippedCount: result.skipped.length };
}
