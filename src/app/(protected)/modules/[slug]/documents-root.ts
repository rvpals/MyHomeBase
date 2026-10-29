import { getDocumentLimits, getDocumentSettings, type DocumentFiles } from "@/lib/documents";
import { deps } from "@/lib/wiring";

// The document folder and the upload ceiling, for every server-side caller that
// touches a document's files (the actions, the upload route, the serving route, the
// section page). One answer to "which folder" and "how big", the same shape as
// household-receipt-root.ts.
//
// A plain module rather than part of the `"use server"` actions file, which may only
// export async functions.

/** The configured folder, `""` when unset. Read per call so a change applies at once. */
export function configuredDocumentRoot(): string {
  return getDocumentSettings(deps.moduleRepo, deps.moduleSettingsRepo).documentRoot;
}

/** The store plus the folder, as every file-touching use-case takes them. */
export function documentFiles(): DocumentFiles {
  return { store: deps.documentFileStore, root: configuredDocumentRoot() };
}

/** The limits in force, from Admin → Configuration. Read per call, like the folder. */
export function documentLimits() {
  return getDocumentLimits(deps.moduleRepo, deps.moduleSettingsRepo);
}
