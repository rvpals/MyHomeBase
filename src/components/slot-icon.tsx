"use client";

import type { ReactNode } from "react";
import type { IconSlot } from "@/lib/icons";
import { useIconOverrides } from "./icon-override-context";
import { TreeIcon } from "./tree-icons";
import { ModuleIcon } from "./module-icons";

/**
 * The icon for one named *place* in the app, honouring any per-slot override.
 *
 * Use this instead of `TreeIcon`/`ModuleIcon` wherever the icon marks a location a user
 * might reasonably want to re-skin — a home-screen card, a nav section, an admin page.
 * Keep using `TreeIcon` directly for row actions (pencil, trash) and for state glyphs
 * (`star` vs `star-filled`), which are buttons and states rather than places.
 *
 * Resolution order:
 *   1. the user's override for this slot under the active icon set,
 *   2. the active set's glyph for the slot's default concept,
 *   3. the hand-drawn fallback.
 *
 * Steps 2 and 3 are just what `TreeIcon`/`ModuleIcon` already do, so **a slot with no
 * override renders identically to the call site it replaced.** That is what makes it safe
 * to convert call sites one at a time.
 */
export function SlotIcon({
  slot,
  className = "",
  fallback,
}: {
  /** The slot definition from `ICON_SLOTS` — passed whole so this stays presentation-only. */
  slot: IconSlot;
  className?: string;
  /**
   * What to render when nothing is overridden, instead of the slot's default concept.
   *
   * Only for positions whose original icon is bespoke artwork rather than a glyph from
   * either table — currently just the app mark on the module rail, which is a multi-colour
   * brass badge that no `defaultConcept` can express. Without this the promise that "an
   * un-overridden slot renders exactly what the call site rendered before" would be false
   * for that one position: it would quietly become a flat line-art house.
   *
   * Leave it unset everywhere else. A slot reaching for it is usually a sign the glyph
   * belongs in the icon tables instead, where every set can draw its own version.
   */
  fallback?: ReactNode;
}) {
  const overrides = useIconOverrides();
  const override = overrides[slot.id];

  if (override?.svgBody) {
    return (
      <svg
        viewBox={`0 0 ${override.svgWidth ?? 24} ${override.svgHeight ?? 24}`}
        className={className}
        aria-hidden="true"
        // Sanitized on write by `sanitizeSvg` — an allowlist of drawing elements and
        // presentation attributes, so there is no script or external reference left to
        // inline. Inlining (rather than an <img>) is the whole point: the markup inherits
        // `currentColor`, so a custom glyph still tints to the theme accent.
        dangerouslySetInnerHTML={{ __html: override.svgBody }}
      />
    );
  }

  if (override?.imageMimeType) {
    return (
      // Raster can't inherit `currentColor`, so this never tints — the admin screen warns
      // about that when the upload isn't an SVG. `?v=` busts the route's cache when the
      // icon is replaced.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/icons/slots/${slot.id}?v=${encodeURIComponent(override.updatedAt)}`}
        alt=""
        aria-hidden="true"
        className={`object-contain ${className}`}
      />
    );
  }

  if (fallback !== undefined) return <>{fallback}</>;

  if (slot.namespace === "module") {
    return <ModuleIcon name={slot.defaultConcept} className={className} />;
  }
  return <TreeIcon name={slot.defaultConcept} className={className} />;
}
