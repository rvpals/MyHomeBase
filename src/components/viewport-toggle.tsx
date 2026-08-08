"use client";

// Lets a reader override the detected layout.
//
// Not decoration — it's the escape hatch that makes automatic detection safe to
// ship. The User-Agent is wrong for iPads and desktop-mode browsers, and the
// width measurement is right but not always what someone wants (a tablet user
// may prefer the dense layout). Without a manual override, a wrong guess is a
// dead end.
//
// Choosing here **pins** the value: the width corrector stops second-guessing
// it, so the choice sticks until it is changed or reset.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/button";
import {
  VIEWPORT_COOKIE,
  VIEWPORT_PINNED_COOKIE,
  viewportForWidth,
  type Viewport,
} from "@/lib/viewport";

const YEAR = 60 * 60 * 24 * 365;

function writeCookie(name: string, value: string, maxAge: number) {
  document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; samesite=lax`;
}

export function ViewportToggle({
  current,
  pinned,
}: {
  current: Viewport;
  pinned: boolean;
}) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);

  function choose(next: Viewport) {
    setIsBusy(true);
    writeCookie(VIEWPORT_COOKIE, next, YEAR);
    writeCookie(VIEWPORT_PINNED_COOKIE, "1", YEAR);
    router.refresh();
    setIsBusy(false);
  }

  function reset() {
    setIsBusy(true);
    writeCookie(VIEWPORT_PINNED_COOKIE, "", 0);
    // Measure here rather than leaving it to `ViewportCorrector`. That runs its
    // effect on mount, and `router.refresh()` re-renders server components
    // without remounting client ones — so unpinning alone left the old value in
    // place and the button appeared to do nothing.
    writeCookie(VIEWPORT_COOKIE, viewportForWidth(window.innerWidth), YEAR);
    router.refresh();
    setIsBusy(false);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={current === "full" ? "primary" : "secondary"}
          onClick={() => choose("full")}
          disabled={isBusy}
        >
          Desktop layout
        </Button>
        <Button
          size="sm"
          variant={current === "compact" ? "primary" : "secondary"}
          onClick={() => choose("compact")}
          disabled={isBusy}
        >
          Compact layout
        </Button>
        {pinned && (
          <Button size="sm" variant="secondary" onClick={reset} disabled={isBusy}>
            Match my screen
          </Button>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">
        {pinned
          ? "Pinned by you — this choice is kept whatever screen you open the app on."
          : "Chosen automatically from your screen width. Pick one to override it."}
      </p>
    </div>
  );
}
