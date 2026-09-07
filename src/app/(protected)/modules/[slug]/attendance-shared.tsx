// Small pieces shared across the Attendance sections. Kept here rather than in
// one of the section views so importing a helper never drags a whole screen
// with it. Mirrors expense-shared.tsx and journal-shared.tsx.

import type { StudentAction } from "@/lib/attendance";

/**
 * Where an action's uploaded icon is served from, or undefined when it has none
 * — in which case the caller draws the built-in glyph from `action.icon`.
 *
 * Bytes come from a route, not the page payload; `updatedAt` busts the cache when
 * the icon is replaced.
 */
export function studentActionIconUrl(
  action: Pick<StudentAction, "id" | "iconMimeType" | "updatedAt">,
): string | undefined {
  if (!action.iconMimeType) return undefined;
  return `/api/attendance/actions/${action.id}/icon?v=${encodeURIComponent(action.updatedAt)}`;
}

/**
 * Whether an action has any mark at all — an upload or a known built-in glyph.
 *
 * The picker and the chip both fall back to the bare code when it has neither, so
 * they need one question answered rather than two checks kept in step.
 */
export function hasStudentActionMark(
  action: Pick<StudentAction, "icon" | "iconMimeType">,
): boolean {
  return Boolean(action.iconMimeType) || action.icon !== "";
}
