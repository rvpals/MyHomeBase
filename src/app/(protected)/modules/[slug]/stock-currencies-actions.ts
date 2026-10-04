"use server";

import { currencyBoardSchema, loadCurrencyBoard, type CurrencyBoard } from "@/lib/exchange-rates";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "investments";

export interface LoadCurrencyBoardActionResult {
  ok: boolean;
  error?: string;
  board?: CurrencyBoard;
}

/**
 * Validate, fetch, return. No `revalidatePath` — the board is read-only and
 * nothing is stored, so there is no server-rendered data to invalidate; the
 * result lives in the card's own state until the next Refresh.
 *
 * A partly-failed board is still a success: `loadCurrencyBoard` reports dead
 * symbols in `board.failures` rather than throwing, and the card shows the rows
 * it got. This returns `ok: false` only when the whole call failed — a bad input,
 * or the fetch layer throwing outright.
 */
export async function loadCurrencyBoardAction(
  input: { codes?: string[] } = {},
): Promise<LoadCurrencyBoardActionResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const parsed = currencyBoardSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid currency request." };
  }

  try {
    return {
      ok: true,
      board: await loadCurrencyBoard(deps.exchangeRateClient, parsed.data.codes),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to load the currency board.",
    };
  }
}
