"use client";

// Shared wording for transient feedback. Every call site funnels through here so
// success/error toasts read the same across modules. Toasts sit ALONGSIDE the
// existing error handling (inline messages, BusyOverlay); they never replace it.

import { toast } from "sonner";

const ERROR_MS = 5000;

/** A server action's usual return shape (`ActionResult` and its cousins). */
export interface ToastResult {
  ok?: boolean;
  error?: string;
  message?: string;
}

/** Green-path toast. Use a specific noun: "Exam saved", not "Saved". */
export function notifySuccess(message: string): void {
  toast.success(message);
}

export function notifyWarning(message: string): void {
  toast.warning(message, { duration: ERROR_MS });
}

/** Red-path toast. `what` is the verb phrase: "save the exam". */
export function notifyError(what: string, error?: unknown): void {
  const detail =
    typeof error === "string" ? error : error instanceof Error ? error.message : undefined;
  toast.error(detail ? `Failed to ${what}: ${detail}` : `Failed to ${what}`, {
    duration: ERROR_MS,
  });
}

/**
 * Toast the outcome of a server action. Returns true when it succeeded so the
 * caller can keep its own `if (!ok)` branching untouched.
 *
 * @param result  What the action returned (`void`/undefined counts as success).
 * @param success Toast text on success — specific noun, e.g. "Exam deleted".
 * @param what    Verb phrase for the failure toast, e.g. "delete the exam".
 */
export function notifyResult(
  result: ToastResult | undefined | void,
  success: string,
  what: string,
): boolean {
  if (result && (result.ok === false || result.error)) {
    notifyError(what, result.error);
    return false;
  }
  notifySuccess(result?.message ?? success);
  return true;
}
