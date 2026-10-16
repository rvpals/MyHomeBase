"use client";

import { createContext, useContext, type ReactNode } from "react";

/** What a renderer needs to draw one module's uploaded icon, with no payload. */
export interface ModuleCustomIconEntry {
  /** `"svg"` is inlined from the markup below; `"image"` comes from the route. */
  kind: "svg" | "image";
  /** Sanitized inner markup. Present only for `kind: "svg"`. */
  svgBody?: string;
  svgWidth?: number;
  svgHeight?: number;
  /** The module's `updatedAt`, as the image URL's `?v=` cache-buster. */
  version?: string;
}

export type ModuleCustomIconMap = Record<string, ModuleCustomIconEntry>;

// Empty by default, so a `ModuleIcon` rendered outside a provider (a test, the
// admin icon-set preview) still draws its glyph rather than nothing.
const ModuleCustomIconContext = createContext<ModuleCustomIconMap>({});

/**
 * Supplies the uploaded icons for every module, keyed by slug.
 *
 * Mounted once in the root layout beside `IconOverrideProvider`, which is the
 * same shape of problem solved the same way — and the reason this is a context
 * rather than a prop.
 *
 * A module's icon is drawn in nine places: the nav tree, the module rail, the
 * modules menu, the breadcrumb, the compact section panel, the home grid, the
 * carousel's no-artwork fallback, the Daily Glance and Today in History card
 * badges, and the SQL Explorer's group header. Those are fed by eleven module
 * shells plus the home and admin layouts, each building its own link shape.
 * Threading two more fields through all of them would have been ~25 edits to
 * carry one value that is already identical everywhere — and every future nav
 * would have to remember to carry it too, with a silently-missing icon as the
 * failure mode.
 *
 * Keyed by slug because that is the one identifier every one of those shapes
 * already has.
 *
 * **The payload is not in here.** SVG markup is (it is a few KB and has to be
 * inlined to tint), but raster bytes are fetched by the browser from
 * `/api/modules/<slug>/icon` — `sys_modules` is read on every authenticated
 * page, and this map is built from that read.
 */
export function ModuleCustomIconProvider({
  value,
  children,
}: {
  value: ModuleCustomIconMap;
  children: ReactNode;
}) {
  return (
    <ModuleCustomIconContext.Provider value={value}>{children}</ModuleCustomIconContext.Provider>
  );
}

export function useModuleCustomIcons(): ModuleCustomIconMap {
  return useContext(ModuleCustomIconContext);
}
