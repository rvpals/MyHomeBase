// What kind of clip a summary is — the rules behind the home screen's Drawing and
// Checklist tabs.
//
// Not exclusive: a clip with both a drawing and a checklist is both, and shows in
// both tabs. A sealed drawing is NOT a drawing here, because the summary never
// carries a sealed clip's `drawingImageId` — the card shows none of its content,
// and "this clip holds a drawing" is content. A sealed checklist still counts: its
// items are carried on the summary regardless of the seal.

import type { ClipSummary } from "./types";

/** True when the clip carries a drawing the card can show. */
export function isDrawingClip(clip: Pick<ClipSummary, "drawingImageId">): boolean {
  return clip.drawingImageId !== undefined;
}

/** True when the clip has at least one checklist line, ticked or not. */
export function isChecklistClip(clip: Pick<ClipSummary, "items">): boolean {
  return clip.items.length > 0;
}
