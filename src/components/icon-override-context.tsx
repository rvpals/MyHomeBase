"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { IconOverrideMap } from "@/lib/icons";

// Empty by default, so a `SlotIcon` rendered outside a provider (a test, a stray
// preview) still draws its slot's default glyph rather than nothing.
const IconOverrideContext = createContext<IconOverrideMap>({});

/**
 * Supplies the per-slot icon overrides for the *active* icon set.
 *
 * Mounted once in the root layout beside `IconSetProvider`, from a server read scoped to
 * the selected set — so the map holds only overrides that can actually apply, and
 * switching sets swaps the whole map rather than filtering it per render.
 */
export function IconOverrideProvider({
  value,
  children,
}: {
  value: IconOverrideMap;
  children: ReactNode;
}) {
  return <IconOverrideContext.Provider value={value}>{children}</IconOverrideContext.Provider>;
}

export function useIconOverrides(): IconOverrideMap {
  return useContext(IconOverrideContext);
}
