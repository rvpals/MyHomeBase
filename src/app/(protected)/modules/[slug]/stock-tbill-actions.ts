"use server";

import { revalidatePath } from "next/cache";
import { dollarsToCents } from "@/lib/shared/money";
import { createPurchase, deletePurchase, updatePurchase } from "@/lib/treasury-bills";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/**
 * The module these actions belong to, matched **exactly** by `requireModuleAccess`.
 *
 * Never a prefix and never a route path: a prefix test would let `investments`
 * authorise a future `investments-pro`.
 */
const ACCESS_MODULE_SLUG = "investments";

const TBILL_SECTION_PATH = "/modules/investments/t-bill";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Every numeric field is the raw string from its input; the action parses them. */
export interface TBillFormInput {
  symbol: string;
  description: string;
  datePurchased: string;
  datePayout: string;
  sharesPurchased: string;
  purchasePrice: string;
  amountSpent: string;
  payoutAmount: string;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

/**
 * Parses the form's strings into the library's input shape.
 *
 * Only parsing — no rules. Every rule (a symbol is required, a price cannot exceed
 * par, a payout cannot precede the purchase) lives in `createTBillPurchaseSchema`,
 * so the web form and the CLI refuse the same inputs for the same reasons.
 */
function toCreateInput(input: TBillFormInput) {
  return {
    symbol: input.symbol.trim(),
    description: input.description,
    datePurchased: input.datePurchased,
    datePayout: input.datePayout,
    sharesPurchased: Number(input.sharesPurchased) || 0,
    purchasePrice: Number(input.purchasePrice) || 0,
    amountSpentCents: dollarsToCents(input.amountSpent || "0"),
    payoutAmountCents: dollarsToCents(input.payoutAmount || "0"),
  };
}

export async function createTBillPurchaseAction(input: TBillFormInput): Promise<ActionResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    createPurchase(deps.tbillRepo, toCreateInput(input));
  } catch (error) {
    return toErrorResult(error, "Could not save that T-Bill purchase.");
  }
  revalidatePath(TBILL_SECTION_PATH);
  return { ok: true };
}

export async function updateTBillPurchaseAction(
  id: number,
  input: TBillFormInput,
): Promise<ActionResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    updatePurchase(deps.tbillRepo, id, toCreateInput(input));
  } catch (error) {
    return toErrorResult(error, "Could not save that T-Bill purchase.");
  }
  revalidatePath(TBILL_SECTION_PATH);
  return { ok: true };
}

export async function deleteTBillPurchaseAction(id: number): Promise<ActionResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    deletePurchase(deps.tbillRepo, id);
  } catch (error) {
    return toErrorResult(error, "Could not delete that T-Bill purchase.");
  }
  revalidatePath(TBILL_SECTION_PATH);
  return { ok: true };
}

/** Deletes a ticked selection. Reports the first failure rather than half-succeeding silently. */
export async function deleteTBillPurchasesAction(ids: number[]): Promise<ActionResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    for (const id of ids) deletePurchase(deps.tbillRepo, id);
  } catch (error) {
    revalidatePath(TBILL_SECTION_PATH);
    return toErrorResult(error, "Could not delete those T-Bill purchases.");
  }
  revalidatePath(TBILL_SECTION_PATH);
  return { ok: true };
}
