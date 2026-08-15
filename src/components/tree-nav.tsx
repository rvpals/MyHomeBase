"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Puck } from "./puck";
import { hasTreeIcon, TreeIcon } from "./tree-icons";
import { useIsCompact } from "./viewport-context";

const DEFAULT_COLLAPSED_STORAGE_KEY = "myhomebase:tree-nav-collapsed";

/**
 * How much of the tree is showing.
 *
 * The same three steps the `Sidebar` uses, for the same reason: a section tree
 * is useful, then useful-but-in-the-way, then in-the-way. `strip` is the accent
 * edge on its own — the panel is gone and the section content gets the width
 * back. It stays clickable and returns to `rail`.
 *
 * **`full` is a horizontal bar, not a column.** It runs across the top of the
 * section as labelled chips; `rail` and `strip` are still columns down the
 * side. So the *orientation* changes with the state, which is why a shell has
 * to be told about it — see `onStateChange`.
 */
export type TreeNavState = "full" | "rail" | "strip";

/**
 * Only the column states have a width. `full` is a bar and sizes itself from
 * the row it bleeds across, so pinning a width on it would fight the bleed —
 * the same reason the compact bar has none.
 */
const WIDTH_CLASS: Record<Exclude<TreeNavState, "full">, string> = {
  rail: "w-16",
  strip: "w-3",
};

function isTreeNavState(value: string | null): value is TreeNavState {
  return value === "full" || value === "rail" || value === "strip";
}

export interface TreeNode {
  id: string;
  label: string;
  /** If set, the node is a clickable link. If omitted, it's a group heading only. */
  href?: string;
  /** Hover tooltip text. */
  hint?: string;
  /** Icon key rendered via TreeIcon, e.g. "palette". Omit for no icon. */
  icon?: string;
  children?: TreeNode[];
}

export interface TreeNavProps {
  nodes: TreeNode[];
  /**
   * Show the collapse controls. The tree then has three states — full (icon +
   * label), rail (icons only, flattened) and strip (an accent edge you click to
   * bring it back).
   */
  collapsible?: boolean;
  /**
   * Where the state is remembered. Two collapsible trees on different screens
   * need different keys, or collapsing one collapses the other.
   */
  storageKey?: string;
  /**
   * Raised whenever the state changes, and once on mount after the stored
   * preference is read.
   *
   * A shell needs this because the nav changes *orientation*, not just width:
   * `full` is a bar across the top, `rail`/`strip` are columns down the side. A
   * shell laying both out in one flex row would squash the bar against the
   * content beside it, so it has to stack for `full` and go side-by-side
   * otherwise — and only the nav knows which it currently is.
   */
  onStateChange?: (state: TreeNavState) => void;
  className?: string;
}

function flatten(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) => [node, ...(node.children ? flatten(node.children) : [])]);
}

/**
 * One section in the compact bar.
 *
 * Only the current section is named. Eight labelled chips is ~900px of row on a
 * 390px phone, so most of the tree would start offscreen; naming the active one
 * alone keeps the row near-fitting *and* answers the question an icon row
 * can't — "where am I?". The rest still carry `title`, and widen when reached.
 */
function CompactChip({ node, active }: { node: TreeNode; active: boolean }) {
  return (
    <Link
      href={node.href!}
      title={node.hint ?? node.label}
      aria-label={node.label}
      aria-current={active ? "page" : undefined}
      className={chipClass(active)}
    >
      <TreeIcon name={node.icon} className="h-4 w-4 shrink-0" />
      {active && <span className="truncate">{node.label}</span>}
    </Link>
  );
}

/**
 * Shared chip shape, so `CompactChip` and `FullChip` can't drift apart.
 * `active` carries the accent; everything else is the resting state.
 */
function chipClass(active: boolean): string {
  return `flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
    active ? "bg-brass-soft font-medium text-brass-dark" : "text-muted hover:bg-line/60"
  }`;
}

/**
 * One destination in the full bar — icon *and* label, always.
 *
 * The difference from `CompactChip` is the whole point of the state: desktop
 * has the width to name every section, so it does. Nothing is hidden behind a
 * tooltip that a pointer has to find.
 */
function FullChip({ node, active }: { node: TreeNode; active: boolean }) {
  return (
    <Link
      href={node.href!}
      title={node.hint ?? node.label}
      aria-current={active ? "page" : undefined}
      className={chipClass(active)}
    >
      <TreeIcon name={node.icon} className="h-4 w-4 shrink-0" />
      <span className="whitespace-nowrap">{node.label}</span>
    </Link>
  );
}

/**
 * A group heading in the full bar: a chip that opens its children beneath it.
 *
 * A bar can't nest, and the two other ways out are both worse. Dropping the
 * heading (what the compact bar does) is fine when the children are leaves you
 * can also reach elsewhere, but Administration's `Configuration` is the *only*
 * route to four screens. Flattening the children in alongside the top-level
 * chips loses the grouping and makes the row half again as long.
 *
 * Closed on outside click, Escape, and on picking a child — a menu that
 * outlived the navigation would hang over the page it just opened.
 */
function GroupChip({ node, pathname }: { node: TreeNode; pathname: string }) {
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const children = node.children ?? [];
  // The heading isn't a destination, so it takes the accent from whichever
  // child is current — otherwise the bar gives no clue which group you're in.
  const active = children.some((child) => child.href === pathname);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    // Only while open — a listener per group chip on every page would be four
    // handlers running on every click in Administration.
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        title={node.hint ?? node.label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        className={chipClass(active)}
      >
        <TreeIcon name={node.icon} className="h-4 w-4 shrink-0" />
        <span className="whitespace-nowrap">{node.label}</span>
        {/* The same chevron as everywhere else, pointing down because the menu
            opens downward rather than the row expanding sideways. */}
        <span
          className={`inline-block transition-transform motion-reduce:transition-none ${
            isOpen ? "-rotate-90" : "rotate-90"
          }`}
          aria-hidden
        >
          &rsaquo;
        </span>
      </button>
      {isOpen && (
        <div
          id={menuId}
          role="menu"
          aria-label={node.label}
          // z-30: under AppChrome's z-40 bars and Modal's z-50, over content.
          className="absolute left-0 top-full z-30 mt-1 min-w-full rounded-lg border border-line bg-paper-raised p-1 shadow-lg"
        >
          {children.map((child) =>
            child.href ? (
              <Link
                key={child.id}
                href={child.href}
                role="menuitem"
                title={child.hint ?? child.label}
                aria-current={child.href === pathname ? "page" : undefined}
                onClick={() => setIsOpen(false)}
                className={`flex items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
                  child.href === pathname
                    ? "bg-brass-soft font-medium text-brass-dark"
                    : "text-ink hover:bg-line/60"
                }`}
              >
                <TreeIcon name={child.icon} className="h-4 w-4 shrink-0 text-brass" />
                {child.label}
              </Link>
            ) : (
              // A heading nested inside a heading. Rare enough that a second
              // level of menu would be gold-plating; it reads as a label.
              <div
                key={child.id}
                className="px-2.5 py-1.5 text-xs font-medium uppercase tracking-wide text-muted"
              >
                {child.label}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function CollapsedRow({ node, pathname }: { node: TreeNode; pathname: string }) {
  const active = Boolean(node.href) && node.href === pathname;
  const icon = <TreeIcon name={node.icon} className="h-4 w-4 text-brass" />;

  if (!node.href) {
    return (
      <div title={node.hint ?? node.label} className="flex items-center justify-center px-3 py-2 text-muted">
        {icon}
      </div>
    );
  }

  return (
    <Link
      href={node.href}
      title={node.hint ?? node.label}
      className={`flex items-center justify-center rounded-md px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
        active ? "bg-brass-soft" : "hover:bg-line/60"
      }`}
    >
      {icon}
    </Link>
  );
}

function TreeItem({
  node,
  depth,
  pathname,
}: {
  node: TreeNode;
  depth: number;
  pathname: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = Boolean(node.children?.length);
  const active = Boolean(node.href) && node.href === pathname;
  const indent = { paddingLeft: `${depth * 14 + 8}px` };

  const row = (
    <span className="flex min-w-0 items-center gap-1.5">
      {hasChildren ? (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            setExpanded((value) => !value);
          }}
          aria-label={expanded ? `Collapse ${node.label}` : `Expand ${node.label}`}
          className="flex h-4 w-4 shrink-0 items-center justify-center text-muted"
        >
          <span className={`inline-block transition-transform ${expanded ? "rotate-90" : ""}`}>
            &rsaquo;
          </span>
        </button>
      ) : (
        <span className="w-4 shrink-0" aria-hidden />
      )}
      <TreeIcon name={node.icon} className="h-4 w-4 shrink-0 text-brass" />
      <span className="truncate">{node.label}</span>
    </span>
  );

  return (
    <li>
      {node.href ? (
        <Link
          href={node.href}
          title={node.hint ?? node.label}
          style={indent}
          className={`flex items-center rounded-md py-1.5 pr-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
            active ? "bg-brass-soft font-medium text-brass-dark" : "text-ink hover:bg-line/60"
          }`}
        >
          {row}
        </Link>
      ) : (
        <div
          title={node.hint ?? node.label}
          style={indent}
          className="flex items-center py-1.5 pr-2 text-sm font-medium text-muted"
        >
          {row}
        </div>
      )}
      {hasChildren && expanded && (
        <ul>
          {node.children!.map((child) => (
            <TreeItem key={child.id} node={child} depth={depth + 1} pathname={pathname} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function TreeNav({
  nodes,
  collapsible = false,
  storageKey = DEFAULT_COLLAPSED_STORAGE_KEY,
  onStateChange,
  className = "",
}: TreeNavProps) {
  const pathname = usePathname();
  // Compact starts at the rail, which down there means the bar. A stored
  // preference still wins, in the effect below.
  const isCompact = useIsCompact();
  const [state, setState] = useState<TreeNavState>(isCompact ? "rail" : "full");
  const isRail = state === "rail";

  // Below `lg` the section wrappers stack, so the tree sits *above or below*
  // the content rather than beside it. A vertical rail there is a 64px-wide
  // column burning ~350px of height for eight icons; turned on its side it
  // costs one row.
  //
  // That row is then a *bar*, not a card in the content flow: `tree-nav-bleed`
  // cancels the page gutter so it runs edge to edge, and the wrapper each shell
  // gives it (`tree-nav-sticky`, in globals.css) pins it to the bottom of the
  // viewport. It costs the same row either way — what it buys is a switcher
  // that's still there three screens down, instead of one that scrolled away.
  //
  // `collapsible` is part of the condition because without it `rail` is just the
  // initial state nobody can leave — the bar's control wouldn't render, and the
  // nested tree would end up inside a bar-styled shell.
  //
  // **Compact has two states, not three: the bar, or the puck.** It deliberately
  // doesn't test `isRail` — the one control minimises, so there's no way to *ask*
  // for `full` down here, and a `full` inherited from the desktop preference
  // would otherwise strand the reader in a 256px column with nothing to press.
  const isCompactRail = collapsible && isCompact && state !== "strip";

  // `full` is a bar on the wide layout too, for the same reason the compact one
  // is: a row of labelled chips across the top reaches every section without
  // taking 256px of width off the content for the whole visit. Unlike compact
  // it has the room to name all of them, so it does — see `FullChip`.
  //
  // Not gated on `collapsible`: a plain tree has no controls and no stored
  // state, so `full` is the only state it will ever be in, and it should read
  // the same there as anywhere else.
  const isFullBar = !isCompact && state === "full";

  // Either bar owns its own surface, so the caller's `className` — a rounded
  // card border for the old side panel, or Admin's `border-r` — is deliberately
  // *not* applied. Rounded corners and a left border read wrong on something
  // spanning the full width, and with no `tailwind-merge` here an override
  // would come down to which rule Tailwind happened to emit last.
  const isBar = isCompactRail || isFullBar;
  const surface = isBar ? "" : className;

  // Whether the bar (or the puck it minimises to) is currently on screen.
  // `strip` on desktop is neither — it's a side edge, not pinned to the bottom.
  const isPuck = collapsible && state === "strip" && isCompact;
  const bottomPinState = isBar ? "bar" : isPuck ? "puck" : null;

  // Mirrored onto <html> so globals.css can pad `.app-main` and position the
  // sticky wrapper — the bar is bottom-pinned now, in both layouts, and only
  // this component knows whether it (or its puck) is actually rendering on the
  // current page. Pages with no TreeNav (the home grid, Administration's side
  // layout) never set the attribute, so they reserve no space for it.
  useEffect(() => {
    const root = document.documentElement;
    if (bottomPinState) {
      root.dataset.treenav = bottomPinState;
    } else {
      delete root.dataset.treenav;
    }
    return () => {
      delete root.dataset.treenav;
    };
  }, [bottomPinState]);

  useEffect(() => {
    if (!collapsible) return;
    const stored = window.localStorage.getItem(storageKey);
    if (stored === null) return;

    // The key used to hold a plain boolean. Reading that legacy value matters:
    // without it, every tree anyone had already collapsed springs open the first
    // time this version loads.
    const restored: TreeNavState = isTreeNavState(stored)
      ? stored
      : stored === "true"
        ? "rail"
        : "full";

    // Syncing from an external system (localStorage) on mount, not reacting to React state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(restored);
  }, [collapsible, storageKey]);

  useEffect(() => {
    if (!collapsible) return;
    window.localStorage.setItem(storageKey, state);
  }, [collapsible, state, storageKey]);

  // Tell the shell which way to lay itself out. In an effect rather than inside
  // the click handlers so it also fires for the state restored from storage on
  // mount — a shell that only heard about *changes* would render side-by-side
  // for one paint and then jump when a stored `full` came back.
  useEffect(() => {
    onStateChange?.(state);
  }, [onStateChange, state]);

  // Hidden: only the accent edge is left, as a target that brings the rail back.
  // Its own branch rather than a zero-width nav so nothing offscreen stays
  // focusable — a hidden tree you can still Tab into is worse than no tree.
  if (collapsible && state === "strip") {
    // Compact minimises to a puck rather than an edge, the same way AppChrome's
    // two bars do — an accent sliver works down the side of a desktop panel, but
    // a 12px band lying across the top of a phone is a target nobody finds.
    //
    // It wears the current section's icon, so the thing that gives the row back
    // also still answers "where am I?" while the row is gone.
    if (isCompact) {
      const active = flatten(nodes).find((node) => node.href === pathname);
      return (
        <Puck
          onClick={() => setState("rail")}
          label="Show the section bar"
          // Under AppChrome's z-40 bar, bottom-left — clear of its top-left
          // puck. `tree-nav-puck` is the fixed position; `data-treenav="puck"`
          // (mirrored above) is what tells `.app-main` to leave room for it.
          position="tree-nav-puck z-30"
        >
          {active && hasTreeIcon(active.icon) ? (
            <TreeIcon name={active.icon} className="h-5 w-5" />
          ) : (
            <span aria-hidden>&rsaquo;</span>
          )}
        </Puck>
      );
    }

    return (
      <nav
        className={`flex min-h-24 overflow-hidden transition-[width] motion-reduce:transition-none ${WIDTH_CLASS.strip} flex-col self-stretch ${className}`}
      >
        <button
          type="button"
          onClick={() => setState("rail")}
          aria-label="Show the section tree"
          aria-expanded={false}
          title="Show the section tree"
          className="w-full flex-1 cursor-pointer bg-brass-dark transition-colors hover:bg-brass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </nav>
    );
  }

  return (
    <nav
      className={`flex transition-[width] motion-reduce:transition-none ${
        isBar
          ? // No `w-full` — `width: 100%` would resolve against the wrapper and
            // then the negative margins would just shift the box left instead of
            // widening it, leaving the bar a gutter short on the right. Letting
            // width stay `auto` is what makes the bleed actually bleed.
            // `nav-raised-bottom`: the bar is pinned to the bottom edge and
            // casts *up* over the section content, so it reads as a layer above
            // it rather than a shadow falling off the bottom of the screen.
            // `bg-app-bar`: the same dark grey surface as the top bar, so the
            // two pinned nav edges read as one chrome layer framing the page.
            "tree-nav-bleed nav-raised-bottom relative z-10 flex-row items-stretch border-y border-line bg-app-bar"
            // The remaining column. For a collapsible tree that's the rail —
            // `strip` returned above and `full` is a bar. A non-collapsible one
            // has no state to be in and no width of its own, so it renders the
            // nested tree at whatever width its wrapper gives it.
          : `flex-col ${collapsible ? WIDTH_CLASS.rail : ""}`
      } ${surface}`}
    >
      {collapsible && (
        <div
          className={`flex items-center ${
            isBar
              ? "shrink-0 gap-0.5 border-r border-line px-1.5"
              : `flex-col gap-0.5 border-b border-line p-2`
          }`}
        >
          {/* Desktop keeps two controls, each reversible on its own: the chevron
              moves between full and rail, and « drops to the strip. Same split
              as Sidebar — a single control cycling three states can only go one
              way, so overshooting would mean going all the way round.

              Compact has one, because it only has somewhere to go. Three states
              in a row of chips was two controls answering a question compact
              doesn't ask: the chips already reach every leaf the tree does, and
              the bar is the widest it can usefully be on a 390px screen. */}
          {!isCompactRail && (
            <button
              type="button"
              onClick={() => setState(isRail ? "full" : "rail")}
              aria-label={isRail ? "Expand the section bar" : "Collapse the section bar to icons"}
              aria-expanded={!isRail}
              title={isRail ? "Expand the section bar" : "Collapse the section bar to icons"}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-line/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
            >
              {/* The same chevron the node rows and CollapsibleCard use. It
                  points the way the nav will go: down from the bar into the
                  side rail, and back up again from the rail. */}
              <span
                className={`inline-block transition-transform motion-reduce:transition-none ${
                  isRail ? "-rotate-90" : "rotate-90"
                }`}
                aria-hidden
              >
                &rsaquo;
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setState("strip")}
            aria-label={isBar ? "Hide the section bar" : "Hide the section tree"}
            title={
              isCompactRail
                ? "Hide the section bar"
                : isFullBar
                  ? "Hide the section bar — click the edge to bring it back"
                  : "Hide the section tree — click the edge to bring it back"
            }
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-line/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          >
            {/* `−` in the bar, matching the minimise on AppChrome's two bars,
                because it does the same thing there — leaves a puck. `«` stays
                on desktop, where what's left really is an edge to push back. */}
            <span aria-hidden>{isCompactRail ? "−" : "«"}</span>
          </button>
        </div>
      )}
      {isCompactRail ? (
        // Scrolls sideways rather than wrapping: a module with a dozen sections
        // would otherwise become three rows and cost back the height this
        // arrangement just saved.
        <ul className="flex flex-1 flex-row items-center gap-1 overflow-x-auto px-2 py-1.5">
          {/* Group headings are dropped rather than flattened in beside their
              own children. `Configuration` isn't a place you can go, so as a
              chip it's a dead target taking room from seven real ones. The full
              bar keeps them, as dropdowns — it has the width for the affordance
              and compact doesn't. */}
          {flatten(nodes)
            .filter((node) => node.href)
            .map((node) => (
              <li key={node.id} className="shrink-0">
                <CompactChip node={node} active={node.href === pathname} />
              </li>
            ))}
        </ul>
      ) : isFullBar ? (
        // **Wraps rather than scrolling sideways, unlike the compact bar.** A
        // scroll container clips in *both* axes — setting `overflow-x` computes
        // `overflow-y` to `auto` too — so a scrolling row would cut the group
        // dropdown off at the bar's bottom edge, which is where it has to hang.
        //
        // Wrapping costs a second row only on a genuinely narrow desktop
        // window; clipping would break the dropdown on every window. Compact
        // has no groups to open, so it keeps the scroll and its saved height.
        <ul className="flex flex-1 flex-row flex-wrap items-center gap-1 px-2 py-1.5">
          {nodes.map((node) => (
            <li key={node.id}>
              {node.children?.length ? (
                <GroupChip node={node} pathname={pathname} />
              ) : node.href ? (
                <FullChip node={node} active={node.href === pathname} />
              ) : (
                // A childless heading: nowhere to go and nothing to open. Kept
                // visible as a label rather than dropped, so a caller who added
                // one can see it's there.
                <span className="px-2.5 text-sm text-muted">{node.label}</span>
              )}
            </li>
          ))}
        </ul>
      ) : collapsible && isRail ? (
        <ul className="flex flex-col gap-0.5 p-2">
          {flatten(nodes).map((node) => (
            <li key={node.id}>
              <CollapsedRow node={node} pathname={pathname} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex flex-col gap-0.5 p-2">
          {nodes.map((node) => (
            <TreeItem key={node.id} node={node} depth={0} pathname={pathname} />
          ))}
        </ul>
      )}
    </nav>
  );
}
