"use client";

// Corrects the server's User-Agent guess with the actual viewport width.
//
// This is the piece that makes UA sniffing acceptable. The server has to guess
// before any JavaScript runs; this measures once on mount and, only when the
// guess was wrong, rewrites the cookie and re-renders. After that first visit
// the cookie is right and this does nothing.
//
// It exists mainly for the two cases the User-Agent cannot get right:
// iPadOS Safari, which reports itself as a Mac, and a phone in
// "Request Desktop Website" mode.
//
// Renders nothing.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  VIEWPORT_COOKIE,
  correctionForWidth,
  type Viewport,
} from "@/lib/viewport";

export function ViewportCorrector({
  current,
  pinned,
}: {
  current: Viewport;
  pinned: boolean;
}) {
  const router = useRouter();

  useEffect(() => {
    const corrected = correctionForWidth({
      current,
      width: window.innerWidth,
      pinned,
    });
    if (!corrected) return;

    document.cookie = `${VIEWPORT_COOKIE}=${corrected}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    // Re-render the server components with the corrected value. `refresh`
    // rather than a reload so form state and scroll position survive.
    router.refresh();
    // Mount only, deliberately. Re-running on resize would re-render the whole
    // tree while someone drags a window edge, and would fight a reader who
    // pinned a layout. A resize past the boundary takes effect on next load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
