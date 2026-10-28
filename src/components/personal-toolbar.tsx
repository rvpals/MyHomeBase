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

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { TreeIcon } from "@/components/tree-icons";
import { SlotIcon } from "@/components/slot-icon";
import { useIsCompact } from "@/components/viewport-context";
import { getIconSlot } from "@/lib/icons";
import {
  clampToolbarPosition,
  isFloatingEdge,
  type ResolvedToolbar,
  type ResolvedToolbarItem,
  type ToolbarPosition,
} from "@/lib/toolbars";

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


  // A new-tab shortcut (migration 0158) leaves the current screen where it is, so
  // it is never "where you are" — highlighting it as the current page would be a
  // lie even when an already-open tab happens to be on that route. Folded into one
  // flag rather than tested twice, so the ring and the `aria-current` cannot drift.
  const marksCurrentPage = isActive && !item.opensNewTab;

  return (
    <Link
      href={item.href ?? "#"}
      // The label is the tooltip as well as the accessible name: the bar is
      // 44px thick, so a row is its glyph alone and nothing on screen names it.
      // A new-tab row says so in the tooltip, because nothing else on a 9x9 button
      // distinguishes it from one that navigates in place.
      title={item.opensNewTab && item.label ? `${item.label} (opens in a new tab)` : item.label}
      aria-label={
        item.opensNewTab && item.label ? `${item.label} (opens in a new tab)` : item.label
      }
      aria-current={marksCurrentPage ? "page" : undefined}
      // `rel` alongside `target`: `noopener` is the one that matters, since without
      // it the opened tab gets a handle on this one through `window.opener`. These
      // are same-origin app routes, so it is hygiene rather than a fix for a live
      // hole -- but it is the default a new `target="_blank"` ships with here,
      // rather than something added after someone notices.
      target={item.opensNewTab ? "_blank" : undefined}
      rel={item.opensNewTab ? "noopener noreferrer" : undefined}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors ${
        marksCurrentPage
          ? "bg-black/15 ring-1 ring-current/30"
          : "hover:bg-black/10 active:bg-black/20"
      }`}
    >
      <ItemIcon item={item} />
    </Link>
  );
}

/**
 * The grip a reader drags a floating bar by (migration 0153).
 *
 * **Floating bars only** — `Toolbar` renders it on no other placement, because a
 * docked bar has nowhere to be dragged to. It sits at the START of the bar, which
 * is the opposite end from the ✎, so the two admin-ish affordances do not crowd
 * each other on a short bar.
 *
 * A `<span>`, not a `<button>`: it performs no action on click, and announcing a
 * button that does nothing when pressed would be a worse experience than the
 * `aria-hidden` here. The bar is already reachable and operable by keyboard — every
 * shortcut on it is a link — and a reader who cannot drag it keeps a bar at its
 * default position rather than losing access to anything.
 *
 * The dots are hand-drawn inline rather than going through `TreeIcon`: this is a row
 * AFFORDANCE, the same category `coding-guide.md` keeps out of the slot registry so
 * that a themed icon set cannot turn a drag handle into full-colour artwork. Same
 * call `EditToolbarButton`'s pencil already documents.
 */
function DragGrip() {
  return (
    <span
      aria-hidden
      // `touch-none` is load-bearing on a touchscreen: without it the browser
      // claims the gesture for page scrolling and the pointer events never
      // arrive. Scoped to the grip rather than the whole bar, so a bar with more
      // shortcuts than fit can still be scrolled with a finger.
      className="personal-toolbar-grip flex h-9 w-4 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
    >
      <svg viewBox="0 0 6 16" className="h-4 w-1.5" fill="currentColor">
        <circle cx="1.5" cy="2" r="1.1" />
        <circle cx="4.5" cy="2" r="1.1" />
        <circle cx="1.5" cy="6" r="1.1" />
        <circle cx="4.5" cy="6" r="1.1" />
        <circle cx="1.5" cy="10" r="1.1" />
        <circle cx="4.5" cy="10" r="1.1" />
        <circle cx="1.5" cy="14" r="1.1" />
        <circle cx="4.5" cy="14" r="1.1" />
      </svg>
    </span>
  );
}

/**
 * The drag, for a floating toolbar.
 *
 * Modelled directly on `Modal`'s drag — pointer capture, the grab point captured
 * once per drag, a clamp on every move — because that one is proven and a second
 * parallel implementation is what `components.md` warns against. It is not *shared*
 * with it for one honest reason: `Modal` drags a transform offset from a centred
 * panel and resets to centre on resize, while a toolbar owns an absolute position
 * that must persist across page loads. Extracting a hook that serves both would
 * have to carry both policies as options, which is more surface than either one has.
 *
 * What this adds over `Modal`'s is persistence: `onCommit` fires once on release,
 * never on move. A save per pointer move would be a server action per frame.
 *
 * The clamp itself lives in `lib` (`clampToolbarPosition`) and is tested there —
 * this hook only measures the DOM and hands it numbers.
 */
function useToolbarDrag({
  enabled,
  position,
  onCommit,
}: {
  enabled: boolean;
  position: ToolbarPosition;
  onCommit: (position: ToolbarPosition) => void;
}) {
  const barRef = useRef<HTMLElement>(null);
  const [dragged, setDragged] = useState<ToolbarPosition | null>(null);
  // State and not just the ref below, because this drives `data-dragging` in the
  // markup — and a ref read does not re-render, so the attribute would never
  // appear and the bar would keep easing along behind the pointer for the whole
  // gesture. The ref stays as the synchronous guard inside the handlers; this is
  // only what the DOM is told.
  const [isDragging, setIsDragging] = useState(false);

  /**
   * The position this reader last *committed* from this component.
   *
   * Why this exists rather than comparing `dragged` to the prop directly: after a
   * drop the two necessarily disagree. `saveToolbarPositionAction` deliberately does
   * not revalidate — the bar is already where the reader dropped it, and re-rendering
   * the whole layout per drop would make it jump — so the prop keeps the OLD position
   * for the rest of the page's life. "They differ, therefore the server has something
   * newer" is simply false here, and acting on it would snap the bar back on the next
   * unrelated revalidation.
   *
   * Tracking what *we* wrote makes the question answerable: a prop that matches
   * neither the local position nor our own last write is genuinely new — a reset from
   * the Account screen, or another tab — and only then is the local value dropped.
   */
  const committed = useRef<ToolbarPosition | null>(null);

  /** Captured once per drag: re-reading the rect mid-drag compounds the move. */
  const drag = useRef<{
    pointerId: number;
    pointerX: number;
    pointerY: number;
    originX: number;
    originY: number;
    width: number;
    height: number;
  } | null>(null);

  // The live position: what the pointer is doing right now if a drag is in flight,
  // otherwise the saved one. Keeping the in-flight value in its own state rather
  // than writing through to the saved one is what lets the commit happen once.
  const current = dragged ?? position;

  const clampHere = useCallback((point: ToolbarPosition, width: number, height: number) => {
    return clampToolbarPosition(
      point,
      { width, height },
      { width: window.innerWidth, height: window.innerHeight },
    );
  }, []);

  function handlePointerDown(event: React.PointerEvent<HTMLElement>) {
    if (!enabled) return;
    // Only the grip starts a drag. A press anywhere else on the bar is a press on a
    // shortcut, and a bar that moved when you went to tap a link would be unusable.
    if (!(event.target as HTMLElement).closest(".personal-toolbar-grip")) return;

    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return;

    drag.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      originX: current.x,
      originY: current.y,
      width: rect.width,
      height: rect.height,
    };
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLElement>) {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;

    setDragged(
      clampHere(
        {
          x: state.originX + (event.clientX - state.pointerX),
          y: state.originY + (event.clientY - state.pointerY),
        },
        state.width,
        state.height,
      ),
    );
  }

  function handlePointerUp(event: React.PointerEvent<HTMLElement>) {
    const state = drag.current;
    if (state?.pointerId !== event.pointerId) return;
    drag.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    // Once, on release — not per move, which would be a server action per frame.
    // `setDragged(null)` is NOT called here: the dropped position is what the reader
    // is looking at, and falling back to the prop before the save lands would snap
    // the bar to where it started. The local value is released in the effect below,
    // and only once the server's own value agrees with it.
    if (dragged) {
      committed.current = dragged;
      onCommit(dragged);
    }
  }

  useEffect(() => {
    // Mid-gesture, nothing from the server may move the bar.
    if (drag.current) return;

    const mine = committed.current;
    const isOurOwnEcho =
      mine !== null && mine.x === position.x && mine.y === position.y;
    if (isOurOwnEcho) {
      // The server caught up with what we already drew. Clear the local override so
      // the prop drives from here on; the pixels do not change.
      committed.current = null;
      setDragged(null);
      return;
    }

    // A position we did not write — a reset, another tab, a fresh load. It wins.
    if (mine === null) {
      setDragged(null);
    }
  }, [position.x, position.y]);

  // A bar parked near an edge can end up off-screen when the window shrinks or the
  // device rotates. Clamped back rather than re-centred — unlike `Modal`, which has
  // a natural home to return to, a toolbar's whole value is being where it was put,
  // so the smallest correction that makes it reachable is the right one.
  //
  // Deliberately NOT committed to the server: a reader who narrows a window for a
  // moment should not have their desktop position permanently rewritten.
  useEffect(() => {
    if (!enabled) return;

    function pullBack() {
      const rect = barRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDragged((previous) => {
        const from = previous ?? position;
        const next = clampToolbarPosition(
          from,
          { width: rect.width, height: rect.height },
          { width: window.innerWidth, height: window.innerHeight },
        );
        return next.x === from.x && next.y === from.y ? previous : next;
      });
    }

    window.addEventListener("resize", pullBack);
    pullBack();
    return () => window.removeEventListener("resize", pullBack);
    // On the COORDINATES, not the `position` object: `Toolbar` builds that object
    // during render (saved spot, else default), so it is a new reference every
    // time and depending on it would tear down and re-add the listener on every
    // render of the shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, position.x, position.y]);

  return {
    barRef,
    position: current,
    isDragging,
    handlers: enabled
      ? {
          onPointerDown: handlePointerDown,
          onPointerMove: handlePointerMove,
          onPointerUp: handlePointerUp,
          onPointerCancel: handlePointerUp,
        }
      : {},
  };
}

/**
 * One bar — docked to an edge, or floating over the page.
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
 *
 * ## A floating bar is the same element, placed differently
 *
 * `edge: "floating"` (migration 0153) gets a grip, pointer handlers and a position
 * written to `--toolbar-x`/`--toolbar-y`; everything above still applies unchanged.
 * The position goes to custom properties rather than `left`/`top` here for the same
 * reason the texture goes to its own: the pixel geometry belongs in `globals.css`
 * beside every other placement's, and `lib` owns only *which* placement it is.
 */
function Toolbar({
  toolbar,
  pathname,
  canEdit,
  position,
  onMove,
}: {
  toolbar: ResolvedToolbar;
  pathname: string;
  canEdit: boolean;
  /** This reader's saved spot for a floating bar, or its default. */
  position: ToolbarPosition;
  onMove: (toolbarId: number, position: ToolbarPosition) => void;
}) {
  const isFloating = isFloatingEdge(toolbar.edge);

  const onCommit = useCallback(
    (next: ToolbarPosition) => onMove(toolbar.id, next),
    [onMove, toolbar.id],
  );

  const drag = useToolbarDrag({ enabled: isFloating, position, onCommit });

  return (
    <nav
      ref={drag.barRef}
      aria-label={toolbar.name}
      data-edge={toolbar.edge}
      // Suppresses the bar's own transition while a drag is in flight, so it
      // tracks the pointer exactly instead of easing along behind it.
      data-dragging={drag.isDragging ? "" : undefined}
      className="personal-toolbar"
      {...drag.handlers}
      // `data-textured` gates the `::before` layer, so a bar with no picture
      // emits no pseudo-element at all rather than one at opacity 0 — an
      // always-on layer costs a paint for nothing. Same reasoning
      // `ResolvedAppTexture` records for leaving its `vars` undefined.
      data-textured={toolbar.texture ? "" : undefined}
      style={
        {
          // Where a floating bar sits, as custom properties rather than `left`/`top`
          // directly: `.personal-toolbar[data-edge="floating"]` reads them, which
          // keeps the pixel geometry in CSS beside every other placement's. Undefined
          // on a docked bar, so the declarations drop out entirely and that bar's own
          // edge rule is untouched.
          "--toolbar-x": isFloating ? `${drag.position.x}px` : undefined,
          "--toolbar-y": isFloating ? `${drag.position.y}px` : undefined,
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
      {/* The grip leads a floating bar, at the opposite end from the ✎ so the two
          affordances never crowd each other on a short bar. A docked bar has
          nowhere to be dragged to, so it gets none. */}
      {isFloating ? <DragGrip /> : null}

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
  positions,
  onMoveToolbar,
}: {
  toolbars: ResolvedToolbar[];
  /**
   * This reader's saved spot for each floating bar, by toolbar id (migration 0153).
   *
   * Optional, and absent means "every floating bar opens at its default" — which
   * keeps a caller that has not been taught about positions rendering correctly
   * rather than crashing, the same way `ResolveToolbarOptions.textures` is optional.
   */
  positions?: Record<number, ToolbarPosition>;
  /**
   * Persists a drag. Absent means a drag still *works* for the session but is not
   * remembered, which is the honest degradation for a caller with no action wired.
   *
   * The signature **mirrors `saveToolbarPositionAction` exactly**, including the
   * `null` that clears a position and the `Promise` it returns, rather than offering
   * the tidier `(id, position) => void` this component would prefer. That is not
   * fussiness: a `"use server"` function can be handed to a client component only as
   * *itself*, so the layout must write `onMoveToolbar={saveToolbarPositionAction}`
   * and never `onMoveToolbar={(id, p) => action(id, p)}` — the arrow is an ordinary
   * closure and serialising it fails at request time. The same rule the layout
   * records for the floating and queue action props.
   */
  onMoveToolbar?: (
    toolbarId: number,
    position: { x: number; y: number } | null,
  ) => Promise<unknown>;
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

  /**
   * Where a floating bar opens when this reader has never dragged it.
   *
   * Top-left of the content area with a small inset, rather than centred: a bar that
   * opens over the middle of the page covers whatever the reader came to read, and
   * the top-left is the one region every layout keeps free of the shell's own
   * controls. The reader moves it once and it stays moved.
   *
   * The compact default is different, and deliberately so: there the bottom edge is
   * already claimed by the section trigger and the music player, so a bar opening at
   * a y measured from the bottom could land underneath the player — i.e. behind the
   * one thing you would need to touch to drag it out. Opening near the top avoids
   * that without needing to know either control's height.
   */
  const defaultPosition = useCallback(
    (index: number): ToolbarPosition => ({
      // Cascaded, so two floating bars do not open exactly on top of each other
      // and look like one bar.
      x: (isCompact ? 12 : 24) + index * 16,
      y: (isCompact ? 12 : 24) + index * 16,
    }),
    [isCompact],
  );

  // Dropped when no handler was supplied: the drag still works for the session, it
  // is simply not remembered. `useCallback` so `Toolbar`'s own memo of it is stable.
  //
  // Fire-and-forget, deliberately. The bar is ALREADY where the reader dropped it —
  // this call only persists that for the next page load, so there is nothing to wait
  // for and nothing to roll back to that would not be a worse surprise than the
  // position silently not sticking. A failure is swallowed rather than thrown: a
  // rejected promise here would be an unhandled rejection in the shell on every
  // page, and a dropped save costs the reader one re-drag.
  const handleMove = useCallback(
    (toolbarId: number, position: ToolbarPosition) => {
      void onMoveToolbar?.(toolbarId, position)?.catch(() => {});
    },
    [onMoveToolbar],
  );

  // Serialised so the effect re-runs when the set of occupied edges changes, not on
  // every render — an array literal would be a new reference each time.
  //
  // `floating` is filtered out here for the same reason `occupiedEdges` filters it
  // in `lib`: a floating bar sits over the content and reserves no page space, so
  // there is no `data-toolbar-floating` to set. This mirror has to agree with that
  // function, or the shell would pad for an edge the server never reserved.
  const edges = [
    ...new Set(visible.map((toolbar) => toolbar.edge).filter((edge) => !isFloatingEdge(edge))),
  ]
    .sort()
    .join(",");

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
      {visible.map((toolbar, index) => (
        <Toolbar
          key={toolbar.id}
          toolbar={toolbar}
          pathname={pathname}
          canEdit={canEdit}
          position={positions?.[toolbar.id] ?? defaultPosition(index)}
          onMove={handleMove}
        />
      ))}
    </>
  );
}
