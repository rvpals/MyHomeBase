"use server";

import { revalidatePath } from "next/cache";
import { createProperty, deleteProperty, updateProperty } from "@/lib/real-estate";
import { dollarsToCents } from "@/lib/shared/money";
import { deps } from "@/lib/wiring";

const REAL_ESTATE_MODULE_PATH = "/modules/real-estate-investment";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface PropertyFormInput {
  address: string;
  purchasePrice: string;
  purchaseDate: string;
  currentValue: string;
  mortgageBalance: string;
  notes?: string;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

export async function createPropertyAction(input: PropertyFormInput): Promise<ActionResult> {
  try {
    createProperty(deps.propertyRepo, {
      address: input.address,
      purchasePriceCents: dollarsToCents(input.purchasePrice),
      purchaseDate: input.purchaseDate,
      currentValueCents: dollarsToCents(input.currentValue),
      mortgageBalanceCents: dollarsToCents(input.mortgageBalance || "0"),
      notes: input.notes,
    });
  } catch (error) {
    return toErrorResult(error, "Failed to add property.");
  }
  revalidatePath(REAL_ESTATE_MODULE_PATH);
  return { ok: true };
}

export async function updatePropertyAction(
  propertyId: number,
  input: PropertyFormInput,
): Promise<ActionResult> {
  try {
    updateProperty(deps.propertyRepo, propertyId, {
      address: input.address,
      purchasePriceCents: dollarsToCents(input.purchasePrice),
      purchaseDate: input.purchaseDate,
      currentValueCents: dollarsToCents(input.currentValue),
      mortgageBalanceCents: dollarsToCents(input.mortgageBalance || "0"),
      notes: input.notes,
    });
  } catch (error) {
    return toErrorResult(error, "Failed to update property.");
  }
  revalidatePath(REAL_ESTATE_MODULE_PATH);
  return { ok: true };
}

export async function deletePropertyAction(propertyId: number): Promise<ActionResult> {
  try {
    deleteProperty(deps.propertyRepo, propertyId);
  } catch (error) {
    return toErrorResult(error, "Failed to delete property.");
  }
  revalidatePath(REAL_ESTATE_MODULE_PATH);
  return { ok: true };
}
