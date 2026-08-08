"use client";

// Supplies the active layout to client components.
//
// Same shape as `IconSetProvider`: the value is decided on the server (from the
// cookie, see src/lib/viewport) and handed down, so client and server agree on
// the very first render and there is no hydration flip.
//
// **Most UI does not need this.** Reach for `max-lg:` Tailwind variants first —
// they cost nothing and keep the desktop classes untouched. Use this only when
// the compact layout needs a genuinely *different component*, not a restyled
// one. See design.md.

import { createContext, useContext, type ReactNode } from "react";
import type { Viewport } from "@/lib/viewport";

// Defaults to "full" so anything rendered outside a provider — a test, a
// storybook-ish harness — still gets the layout the app was designed at.
const ViewportContext = createContext<Viewport>("full");

export function ViewportProvider({
  value,
  children,
}: {
  value: Viewport;
  children: ReactNode;
}) {
  return <ViewportContext.Provider value={value}>{children}</ViewportContext.Provider>;
}

/** The active layout: `"compact"` below 1024px, `"full"` at or above it. */
export function useViewport(): Viewport {
  return useContext(ViewportContext);
}

/** Convenience for the common check. */
export function useIsCompact(): boolean {
  return useContext(ViewportContext) === "compact";
}
