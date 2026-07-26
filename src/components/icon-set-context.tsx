"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ModuleIconSetId } from "./module-icon-sets.generated";

export interface ActiveIconSet {
  /** The selected icon-set id (matches ICON_SETS in lib/settings). */
  id: ModuleIconSetId;
  /** True for full-color sets that can't be tinted — callers drop the accent tile. */
  colorful: boolean;
}

// Default matches the "classic" fallback so anything rendered outside a provider
// still shows a valid (theme-tinted) icon.
const IconSetContext = createContext<ActiveIconSet>({ id: "classic", colorful: false });

/**
 * Supplies the active module icon set to `ModuleIcon` and the card/sidebar badge.
 * Mounted once in the root layout with the server-read `icon_set` setting; changing
 * the setting + refreshing re-renders the layout with the new value.
 */
export function IconSetProvider({ value, children }: { value: ActiveIconSet; children: ReactNode }) {
  return <IconSetContext.Provider value={value}>{children}</IconSetContext.Provider>;
}

export function useIconSet(): ActiveIconSet {
  return useContext(IconSetContext);
}
