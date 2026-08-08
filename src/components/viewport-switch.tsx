"use client";

// The global compact/full switch, in the top bar.
//
// **This is the one control that drives the whole UI's layout.** `full` is the
// original desktop treatment; `compact` swaps in the components customised for
// a narrow screen (`DataGridCompact`, the bottom module bar, tighter artwork).
//
// Choosing here **pins** the layout: the width corrector stops second-guessing
// it, so the choice sticks across devices and sessions until it is changed. That
// is what makes it an override rather than a suggestion — automatic detection is
// wrong for iPads (Safari reports them as a Mac) and for phones in
// desktop-request mode.
//
// A single toggling button rather than two: there are only two states, so
// overshooting is impossible and one control is less top-bar clutter.

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  VIEWPORT_COOKIE,
  VIEWPORT_PINNED_COOKIE,
  viewportForWidth,
} from "@/lib/viewport";
import { useViewport } from "./viewport-context";

const YEAR = 60 * 60 * 24 * 365;

function writeCookie(name: string, value: string, maxAge: number) {
  document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; samesite=lax`;
}

export function ViewportSwitch({ pinned }: { pinned: boolean }) {
  const current = useViewport();
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);

  const next = current === "compact" ? "full" : "compact";
  const label = `Switch to the ${next} layout`;

  function toggle() {
    setIsBusy(true);
    writeCookie(VIEWPORT_COOKIE, next, YEAR);
    writeCookie(VIEWPORT_PINNED_COOKIE, "1", YEAR);
    router.refresh();
    setIsBusy(false);
  }

  function unpin() {
    setIsBusy(true);
    writeCookie(VIEWPORT_PINNED_COOKIE, "", 0);
    // Measured here rather than left to `ViewportCorrector`: that runs its
    // effect on mount, and `router.refresh()` re-renders server components
    // without remounting client ones, so unpinning alone would appear to do
    // nothing until the next full page load.
    writeCookie(VIEWPORT_COOKIE, viewportForWidth(window.innerWidth), YEAR);
    router.refresh();
    setIsBusy(false);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      // Right-click / long-press isn't discoverable, so unpinning gets its own
      // affordance rather than a hidden gesture: shift-click. Explained in the
      // tooltip, and the Account page keeps a plain description of the state.
      onContextMenu={(event) => {
        if (!pinned) return;
        event.preventDefault();
        unpin();
      }}
      disabled={isBusy}
      aria-label={label}
      title={`${label}${pinned ? " — right-click to go back to matching your screen" : ""}`}
      className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted transition-colors hover:bg-brass-soft hover:text-brass-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass disabled:opacity-50"
    >
      {current === "compact" ? (
        // A phone outline: the layout you are in now.
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden>
          <rect x="7" y="2" width="10" height="20" rx="2" />
          <path d="M11 18h2" strokeLinecap="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden>
          <rect x="2" y="4" width="20" height="13" rx="2" />
          <path d="M8 21h8M12 17v4" strokeLinecap="round" />
        </svg>
      )}
      <span className="max-lg:hidden">{current === "compact" ? "Compact" : "Full"}</span>
      {pinned && <span className="text-brass-dark" aria-hidden title="Pinned">•</span>}
    </button>
  );
}
