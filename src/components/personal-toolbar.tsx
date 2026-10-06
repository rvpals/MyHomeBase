"use client";

// A personal toolbar: an admin-configured bar of shortcuts docked to a screen edge.
//
// **This does not replace any navigation tier.** The navigation tree (full layout)
// and the two-tier bottom bar (compact) render exactly as they did; a toolbar is an
// additional surface beside them, and a reader with none sees no change. Nothing
// about *where you are* belongs here — that is a navigation tier's job, per
// `design.md` → *Adding a UI element to the shell*. These are shortcuts.
//
// Presentation only: it receives resolved toolbars as props and renders them. Which
// bars a reader should see, which rows still resolve, and which edges are occupied
// are all decided in `src/lib/toolbars` so they are testable without a browser.
//
// The geometry lives in `globals.css` under `.personal-toolbar`, composing with
// `--nav-tree-width`, `--section-trigger-height` and `--music-player-height` rather
// than writing a new `fixed inset-x-0`. `lib` owns which edge; CSS owns the pixels.

import { useEffect, useMemo, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { TreeIcon } from "@/components/tree-icons";
import { SlotIcon } from "@/components/slot-icon";
import { useIsCompact } from "@/components/viewport-context";
import { getIconSlot } from "@/lib/icons";
import type { ResolvedToolbar, ResolvedToolbarItem } from "@/lib/toolbars";

/**
 * One row's glyph.
 *
 * A menu item's id **is** its icon slot id, so an uploaded override shows here
 * automatically and a toolbar shortcut matches the same screen's icon in the
 * navigation tree. `getIconSlot` is a lookup over a static array, not I/O.
 *
 * Falls back to a bare `TreeIcon` when the id resolves to no registered slot —
 * which should not happen for a real menu item, but is better than rendering a
 * hole if one is ever missed.
 */
function ItemIcon({ item }: { item: ResolvedToolbarItem }) {
  const slot = item.menuItemId ? getIconSlot(item.menuItemId) : undefined;
  if (slot) return <SlotIcon slot={slot} className="h-5 w-5" />;
  if (item.icon) return <TreeIcon name={item.icon} className="h-5 w-5" />;
  return null;
}

function ToolbarRow({ item, isActive }: { item: ResolvedToolbarItem; isActive: boolean }) {
  // Flexible empty space — pushes everything after it to the far end of the bar.
  if (item.kind === "spacer") {
    return <span aria-hidden className="personal-toolbar-spacer" />;
  }

  // A drawn dividing line. `role="separator"` rather than `aria-hidden`, unlike the
  // spacer above: this one is real structure a screen reader should announce, and
  // it is the standard role for a divider inside a toolbar. The orientation is set
  // by CSS per edge, so it is not restated here.
  if (item.kind === "separator") {
    return <span role="separator" className="personal-toolbar-separator" />;
  }


  return (
    <Link
      href={item.href ?? "#"}
      // The label is the tooltip as well as the accessible name: the bar is
      // 44px thick, so a row is its glyph alone and nothing on screen names it.
      title={item.label}
      aria-label={item.label}
      aria-current={isActive ? "page" : undefined}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors ${
        isActive ? "bg-black/15 ring-1 ring-current/30" : "hover:bg-black/10 active:bg-black/20"
      }`}
    >
      <ItemIcon item={item} />
    </Link>
  );
}

/**
 * One docked bar.
 *
 * The three colours arrive as inline styles because they are user-authored values
 * rather than theme tokens — the deliberate exception `design.md` would otherwise
 * forbid, recorded in migration 0125. Each is omitted when unset, so the CSS
 * fallback (`--paper-raised`, `--ink`, `--line`) applies and an unconfigured bar
 * stays themed through a theme change.
 *
 * ## Border weight and chrome style come from the admin settings
 *
 * Neither is set here. The bar's edge takes its width from
 * `--chrome-outline-width` (Border Weight) and its bevel from the
 * `[data-chrome-style="…"] .personal-toolbar[data-edge="…"]` rules (Chrome
 * Style), both in `globals.css`. So a toolbar thickens and bevels with the header
 * and the navigation column, because it is part of the same frame.
 *
 * Two consequences worth not undoing:
 *
 * - **No `nav-raised-*` class.** This used to carry one, which hardcoded an
 *   elevation that then fought whichever bevel the admin had chosen — two cast
 *   shadows on one edge. The chrome style owns the elevation now.
 * - **The background goes to `--toolbar-surface`, not `background`.** The
 *   embossed style's gradient mixes against that variable, which is what lets it
 *   *tint* a chosen colour rather than paint over it. Setting `background`
 *   (the shorthand) would also wipe `background-image` and kill the gradient
 *   outright — the same trap `globals.css` records for the chrome surfaces.
 *
 * ## The texture is a pseudo-element, for the same reason
 *
 * An optional picture from the app texture library draws behind the glyphs
 * (migration 0130). It goes to `--toolbar-texture-*`, read by
 * `.personal-toolbar::before` — **never** to `background-image` on the bar,
 * which the embossed style already owns. The URL arrives fully built from
 * `resolveToolbar`, cache-buster included; this component never assembles one.
 */
function Toolbar({
  toolbar,
  pathname,
  canEdit,
}: {
  toolbar: ResolvedToolbar;
  pathname: string;
  canEdit: boolean;
}) {
  return (
    <nav
      aria-label={toolbar.name}
      data-edge={toolbar.edge}
      className="personal-toolbar"
      // `data-textured` gates the `::before` layer, so a bar with no picture
      // emits no pseudo-element at all rather than one at opacity 0 — an
      // always-on layer costs a paint for nothing. Same reasoning
      // `ResolvedAppTexture` records for leaving its `vars` undefined.
      data-textured={toolbar.texture ? "" : undefined}
      style={
        {
          "--toolbar-surface": toolbar.backgroundColor,
          // The texture goes to custom properties read by
          // `.personal-toolbar::before`, NOT to `background-image` on the bar
          // itself: the `emboss` chrome style paints its bevel gradient into
          // that exact property, so a picture set there is wiped by whichever
          // chrome style is active. Undefined when there is no texture, which
          // drops the declarations entirely.
          "--toolbar-texture-image": toolbar.texture?.image,
          "--toolbar-texture-opacity": toolbar.texture?.opacity,
          color: toolbar.textColor,
          // Inline, so this beats the `outset` style's
          // `border-*-color: transparent` — which that style sets to stop its
          // cast shadow doubling against the hairline. The trade is deliberate:
          // an admin who picked a border colour gets it, and on `outset`
          // accepts a slightly heavier edge as the cost. Leave the colour unset
          // (the default) and the bevel reads exactly as the header's does.
          borderColor: toolbar.borderColor,
        } as CSSProperties
      }
    >
      {toolbar.items.map((item) => (
        <ToolbarRow
          key={item.id}
          item={item}
          // Prefix matching, like the tree's: a record page under a section keeps
          // that section's shortcut lit rather than dropping the highlight.
          isActive={
            item.href !== undefined &&
            item.href !== "#" &&
            (pathname === item.href || pathname.startsWith(`${item.href}/`))
          }
        />
      ))}

      {canEdit ? <EditToolbarButton toolbar={toolbar} /> : null}
    </nav>
  );
}

/**
 * The ✎ that opens this bar's editor.
 *
 * **Admins only** — the caller gates it. The screen it opens already calls
 * `requireAdmin()`, so showing this to everyone would be a control that looks
 * available and then redirects; the guard here is only about not offering it.
 *
 * It is deliberately **not** a floating component. `design.md` closes that list —
 * a new floating thing registers in `FLOATING_COMPONENTS` and renders in
 * `FloatingLayer` — but this is not a floating thing: it is a control *on* an
 * existing surface, scoped to the bar it sits on, the same way the navigation
 * tree's filter box is part of the tree. Registering it would make it a fifth
 * surface with a reader-facing on/off switch, which is wrong for an admin
 * affordance that belongs to one toolbar.
 *
 * It is pushed to the far end of the bar by an `auto` margin, set per edge in
 * `globals.css` — `margin-left` on a horizontal bar, `margin-top` on a vertical
 * one. A Tailwind `ml-auto` here would be wrong on the side bars: those are flex
 * *columns*, where `margin-left` does not push along the main axis at all and the
 * button would simply trail the last shortcut.
 *
 * If a spacer already claimed the slack, the spacer wins and this follows the last
 * item instead — the right outcome either way, since both land at the end.
 */
function EditToolbarButton({ toolbar }: { toolbar: ResolvedToolbar }) {
  return (
    <Link
      href={`/admin/display-settings/toolbars?edit=${toolbar.id}`}
      // Named for the bar, because a reader with several toolbars gets several of
      // these and "Edit toolbar" alone would not say which.
      title={`Edit the “${toolbar.name}” toolbar`}
      aria-label={`Edit the ${toolbar.name} toolbar`}
      className="personal-toolbar-edit flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-opacity hover:bg-black/10 active:bg-black/20"
    >
      {/* A pencil, inline rather than through `TreeIcon`: this is a row ACTION, and
          `coding-guide.md` keeps those hand-drawn and out of the slot registry so a
          themed set cannot turn an edit control into full-colour artwork. */}
      <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    </Link>
  );
}

/**
 * Every toolbar on screen, plus the `<html>` attributes that reserve their space.
 *
 * Mounted once, in the protected layout — the same place `FloatingLayerProvider`
 * mounts, and for the same reason: these are app-wide chrome, not a page's.
 *
 * The attributes are mirrored from here rather than rendered as inline styles
 * because `.app-main` belongs to a **server** layout that cannot see a reader's own
 * hide list. Same seam `data-music-player` and `data-sectionpanel` already use.
 */
export function PersonalToolbars({
  toolbars,
  canEdit = false,
}: {
  toolbars: ResolvedToolbar[];
  /**
   * Whether to offer the ✎ edit shortcut on each bar. **Admins only.**
   *
   * Defaults to `false`, so a caller that forgets it shows no admin affordance
   * rather than showing one to everybody — the safe direction to fail. This is a
   * convenience, never a permission: the screen it links to calls `requireAdmin()`
   * itself, so passing `true` to a non-admin would offer a link that redirects, not
   * grant any access.
   */
  canEdit?: boolean;
}) {
  const pathname = usePathname();
  const isCompact = useIsCompact();

  // `fullModeOnly` is applied here rather than on the server, because the reader can
  // *pin* the compact layout on a wide window — the server resolves the viewport from
  // a cookie, but this context is the one value the whole app agrees on, so filtering
  // anywhere else could disagree with what the rest of the shell is doing.
  //
  // Every other visibility rule (the admin's switch, this reader's hide list, stale
  // rows) is already applied in `resolveToolbarsFor` on the server, where it belongs.
  const visible = useMemo(
    () => toolbars.filter((toolbar) => !(toolbar.fullModeOnly && isCompact)),
    [toolbars, isCompact],
  );

  // Serialised so the effect re-runs when the set of occupied edges changes, not on
  // every render — an array literal would be a new reference each time.
  const edges = [...new Set(visible.map((toolbar) => toolbar.edge))].sort().join(",");

  useEffect(() => {
    const root = document.documentElement;
    const occupied = edges ? edges.split(",") : [];
    const all = ["top", "bottom", "left", "right"];

    for (const edge of all) {
      if (occupied.includes(edge)) root.setAttribute(`data-toolbar-${edge}`, "");
      else root.removeAttribute(`data-toolbar-${edge}`);
    }

    return () => {
      for (const edge of all) root.removeAttribute(`data-toolbar-${edge}`);
    };
  }, [edges]);

  if (visible.length === 0) return null;

  return (
    <>
      {visible.map((toolbar) => (
        <Toolbar
          key={toolbar.id}
          toolbar={toolbar}
          pathname={pathname}
          canEdit={canEdit}
        />
      ))}
    </>
  );
}
