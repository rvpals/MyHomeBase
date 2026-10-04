import { getHouseholdSettings, type HsaReceiptFiles } from "@/lib/household";
import { deps } from "@/lib/wiring";

// The HSA receipt folder, for every server-side caller that touches a receipt (the
// actions, the serving route, the section page). One answer to "which folder", the same
// shape as journal-photo-root.ts.
//
// A plain module rather than part of the `"use server"` actions file, which may only
// export async functions.

/** The configured folder, `""` when unset. Read per call so a change applies at once. */
export function configuredHsaReceiptRoot(): string {
  return getHouseholdSettings(deps.moduleRepo, deps.moduleSettingsRepo).hsaReceiptRoot;
}

/** The store plus the folder, as every receipt use-case takes them. */
export function hsaReceiptFiles(): HsaReceiptFiles {
  return { store: deps.receiptFileStore, root: configuredHsaReceiptRoot() };
}
