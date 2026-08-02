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

export interface ImportQuotesResult extends ActionResult {
  importedCount?: number;
  /** Per-quote failures, so a bad row is reported rather than silently dropped. */
  failures?: { index: number; reason: string }[];
}

/**
 * Saves the quotes the user approved in the newsletter-import preview. Each is
 * validated and inserted independently: one bad entry doesn't discard the rest,
 * and every failure is reported back.
 */
export async function importQuotesAction(inputs: CreateQuoteInput[]): Promise<ImportQuotesResult> {
  const failures: { index: number; reason: string }[] = [];
  let importedCount = 0;

  inputs.forEach((input, index) => {
    try {
      createQuote(deps.dailyQuoteRepo, input);
      importedCount += 1;
    } catch (error) {
      failures.push({
        index,
        reason: error instanceof Error ? error.message : "Failed to save quote.",
      });
    }
  });

  revalidatePath("/admin/daily-quote");
  revalidatePath("/");
  return { ok: failures.length === 0, importedCount, failures };
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
