"use server";

import { revalidatePath } from "next/cache";
import {
  createQuote,
  deleteQuote,
  updateQuote,
  type CreateQuoteInput,
  type UpdateQuoteInput,
} from "@/lib/daily-quote";
import { deps } from "@/lib/wiring";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

export async function createQuoteAction(input: CreateQuoteInput): Promise<ActionResult> {
  try {
    createQuote(deps.dailyQuoteRepo, input);
  } catch (error) {
    return toErrorResult(error, "Failed to create quote.");
  }
  revalidatePath("/admin/daily-quote");
  revalidatePath("/");
  return { ok: true };
}

export async function updateQuoteAction(id: number, input: UpdateQuoteInput): Promise<ActionResult> {
  try {
    updateQuote(deps.dailyQuoteRepo, id, input);
  } catch (error) {
    return toErrorResult(error, "Failed to update quote.");
  }
  revalidatePath("/admin/daily-quote");
  revalidatePath("/");
  return { ok: true };
}

export async function deleteQuoteAction(id: number): Promise<ActionResult> {
  try {
    deleteQuote(deps.dailyQuoteRepo, id);
  } catch (error) {
    return toErrorResult(error, "Failed to delete quote.");
  }
  revalidatePath("/admin/daily-quote");
  revalidatePath("/");
  return { ok: true };
}
