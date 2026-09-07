"use server";

// Thin adapters for the Tax Lots section: validate input with the module's zod
// schema, call a `lib/tax-lots` use-case, revalidate. No calculation here — every
// figure the view shows comes from `analyzeTicker`, which the CLI drives identically.

import { revalidatePath } from "next/cache";
import {
  createTaxLot,
  createTaxLotSchema,
  deleteTaxLot,
  taxLotIdSchema,
  updateTaxLot,
  updateTaxLotSchema,
} from "@/lib/tax-lots";
import { deps } from "@/lib/wiring";

const TAX_LOTS_PATH = "/modules/stock-etfs/tax-lots";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

export async function createTaxLotAction(input: unknown): Promise<ActionResult> {
  try {
    createTaxLot(deps.taxLotRepo, createTaxLotSchema.parse(input));
  } catch (error) {
    return toErrorResult(error, "Failed to add the lot.");
  }
  revalidatePath(TAX_LOTS_PATH);
  return { ok: true };
}

export async function updateTaxLotAction(id: unknown, input: unknown): Promise<ActionResult> {
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
  try {
    const key = taxLotIdSchema.parse({ id });
    deleteTaxLot(deps.taxLotRepo, key.id);
  } catch (error) {
    return toErrorResult(error, "Failed to delete the lot.");
  }
  revalidatePath(TAX_LOTS_PATH);
  return { ok: true };
}
