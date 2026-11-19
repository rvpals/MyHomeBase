"use client";

// One shared lock on the page's scroll, held by every overlay that must stop the
// page behind it from moving (`Modal`, `PhotoViewer`).
//
// Why a counter and not "save the old value, restore it on close" in each
// overlay: that pattern breaks as soon as two overlays overlap and don't close
// in exactly reverse order. When a dialog and a dialog inside it unmount
// together, React runs the outer cleanup first — it restores "" — and then the
// inner one restores the "hidden" it saw when it opened. The page is left with
// no scrollbar until a reload. This happened on the Journal entry editor.
//
// With a count, scroll is switched off when the first holder arrives and back on
// only when the last one leaves, whatever order they leave in.

import { useEffect } from "react";

let holders = 0;
let previousOverflow = "";

function lock(): void {
  if (holders === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  holders += 1;
}

function unlock(): void {
  holders = Math.max(0, holders - 1);
  if (holders === 0) document.body.style.overflow = previousOverflow;
}

/**
 * Stops the page behind from scrolling while the calling component is mounted
 * and `active` is true. Safe to nest and to unmount in any order.
 */
export function useBodyScrollLock(active = true): void {
  useEffect(() => {
    if (!active) return;
    lock();
    return unlock;
  }, [active]);
}
