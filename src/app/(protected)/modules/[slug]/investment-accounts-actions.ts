"use server";

import { revalidatePath } from "next/cache";
import {
  addPerformanceRecord,
  clearAccountIcon,
  createAccount,
  deleteAccount,
  deletePerformanceRecord,
  setAccountIcon,
  updateAccount,
} from "@/lib/investment-accounts";
import { dollarsToCents } from "@/lib/shared/money";
import { deps } from "@/lib/wiring";

const STOCK_ETFS_MODULE_PATH = "/modules/stock-etfs";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface AccountFormInput {
  name: string;
  description?: string;
  initialValue: string;
}

export interface PerformanceRecordFormInput {
  recordDate: string;
  totalValue: string;
  note?: string;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

export async function createAccountAction(input: AccountFormInput): Promise<ActionResult> {
  try {
    createAccount(deps.investmentAccountRepo, {
      name: input.name,
      description: input.description ?? "",
      initialValueCents: dollarsToCents(input.initialValue || "0"),
    });
  } catch (error) {
    return toErrorResult(error, "Failed to add account.");
  }
  revalidatePath(STOCK_ETFS_MODULE_PATH);
  return { ok: true };
}

export async function updateAccountAction(
  accountId: number,
  input: AccountFormInput,
): Promise<ActionResult> {
  try {
    updateAccount(deps.investmentAccountRepo, accountId, {
      name: input.name,
      description: input.description ?? "",
      initialValueCents: dollarsToCents(input.initialValue || "0"),
    });
  } catch (error) {
    return toErrorResult(error, "Failed to update account.");
  }
  revalidatePath(STOCK_ETFS_MODULE_PATH);
  return { ok: true };
}

export async function deleteAccountAction(accountId: number): Promise<ActionResult> {
  try {
    deleteAccount(deps.investmentAccountRepo, accountId);
  } catch (error) {
    return toErrorResult(error, "Failed to delete account.");
  }
  revalidatePath(STOCK_ETFS_MODULE_PATH);
  return { ok: true };
}

export async function addPerformanceRecordAction(
  accountId: number,
  input: PerformanceRecordFormInput,
): Promise<ActionResult> {
  try {
    addPerformanceRecord(deps.investmentAccountRepo, {
      accountId,
      totalValueCents: dollarsToCents(input.totalValue || "0"),
      recordDate: input.recordDate,
      note: input.note ?? "",
    });
  } catch (error) {
    return toErrorResult(error, "Failed to add performance record.");
  }
  revalidatePath(STOCK_ETFS_MODULE_PATH);
  return { ok: true };
}

export async function deletePerformanceRecordAction(recordId: number): Promise<ActionResult> {
  try {
    deletePerformanceRecord(deps.investmentAccountRepo, recordId);
  } catch (error) {
    return toErrorResult(error, "Failed to delete performance record.");
  }
  revalidatePath(STOCK_ETFS_MODULE_PATH);
  return { ok: true };
}

/**
 * Stores an account's icon. The browser sends bare base64 plus the file's own
 * mime type; the lib validates both — this adapter never inspects the bytes.
 */
export async function saveAccountIconAction(
  accountId: number,
  mimeType: string,
  base64Data: string,
): Promise<ActionResult> {
  try {
    setAccountIcon(deps.investmentAccountRepo, accountId, {
      // Cast because the value came off a File and is unvalidated until the lib
      // schema narrows it to the allowed set.
      mimeType: mimeType as never,
      base64Data,
    });
  } catch (error) {
    return toErrorResult(error, "Failed to save the icon.");
  }
  revalidatePath(STOCK_ETFS_MODULE_PATH);
  return { ok: true };
}

export async function clearAccountIconAction(accountId: number): Promise<ActionResult> {
  try {
    clearAccountIcon(deps.investmentAccountRepo, accountId);
  } catch (error) {
    return toErrorResult(error, "Failed to remove the icon.");
  }
  revalidatePath(STOCK_ETFS_MODULE_PATH);
  return { ok: true };
}
