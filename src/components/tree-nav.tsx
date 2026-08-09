"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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
 */
export type TreeNavState = "full" | "rail" | "strip";

const WIDTH_CLASS: Record<TreeNavState, string> = {
  full: "w-64",
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
      className={`flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
        active ? "bg-brass-soft font-medium text-brass-dark" : "text-muted hover:bg-line/60"
      }`}
    >
      <TreeIcon name={node.icon} className="h-4 w-4 shrink-0" />
      {active && <span className="truncate">{node.label}</span>}
    </Link>
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
  className = "",
}: TreeNavProps) {
  const pathname = usePathname();
  // Same reasoning as `Sidebar`: at 256px the full tree leaves a 390px screen
  // 134px of content, less than the admin shell's own padding. Compact starts
  // at the rail; a stored preference still wins, in the effect below.
  const isCompact = useIsCompact();
  const [state, setState] = useState<TreeNavState>(isCompact ? "rail" : "full");
  const isRail = state === "rail";

  // Below `lg` the section wrappers stack, so the tree sits *above* the content
  // rather than beside it. A vertical rail there is a 64px-wide column burning
  // ~350px of height for eight icons; turned on its side it costs one row.
  //
  // That row is then a *bar*, not a card in the content flow: `tree-nav-bleed`
  // cancels the page gutter so it runs edge to edge, and the wrapper each shell
  // gives it (`tree-nav-sticky`, in globals.css) pins it under the app bar. It
  // costs the same row either way — what it buys is a switcher that's still
  // there three screens down, instead of one that scrolled away.
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

  // The bar owns its own surface, so the caller's `className` — a rounded card
  // border for the desktop panel — is deliberately *not* applied to it. Rounded
  // corners and a left border read wrong on something spanning the full width,
  // and with no `tailwind-merge` here an override would come down to which rule
  // Tailwind happened to emit last.
  const surface = isCompactRail ? "" : className;

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
          // Under AppChrome's z-40 bars, and clear of both their pucks
          // (top-left, bottom-right). `tree-nav-puck` tracks the top bar.
          position="tree-nav-puck right-3 z-30"
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
        isCompactRail
          ? // No `w-full` — `width: 100%` would resolve against the wrapper and
            // then the negative margins would just shift the box left instead of
            // widening it, leaving the bar a gutter short on the right. Letting
            // width stay `auto` is what makes the bleed actually bleed.
            "tree-nav-bleed flex-row items-stretch border-y border-line bg-paper-raised"
          : `flex-col ${collapsible ? WIDTH_CLASS[state] : ""}`
      } ${surface}`}
    >
      {collapsible && (
        <div
          className={`flex items-center ${
            isCompactRail
              ? "shrink-0 gap-0.5 border-r border-line px-1.5"
              : `border-b border-line p-2 ${isRail ? "flex-col gap-0.5" : "justify-end gap-0.5"}`
          }`}
        >
          {/* Desktop keeps two controls, each reversible on its own: the chevron
              moves between full and rail, and « drops to the strip. Same split
              as Sidebar — a single control cycling three states can only go one
              way, so overshooting would mean going all the way round.

              The bar has one, because it only has somewhere to go. Three states
              in a row of chips was two controls answering a question compact
              doesn't ask: `full` is a 256px column on a 390px screen, and the
              chips already reach every leaf the nested tree does. */}
          {!isCompactRail && (
            <button
              type="button"
              onClick={() => setState(isRail ? "full" : "rail")}
              aria-label={isRail ? "Expand the section tree" : "Collapse the section tree to icons"}
              aria-expanded={!isRail}
              title={isRail ? "Expand the section tree" : "Collapse the section tree to icons"}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-line/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
            >
              {/* The same chevron the node rows, CollapsibleCard and Sidebar use. */}
              <span
                className={`inline-block transition-transform motion-reduce:transition-none ${
                  isRail ? "" : "rotate-180"
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
            aria-label={isCompactRail ? "Hide the section bar" : "Hide the section tree"}
            title={
              isCompactRail
                ? "Hide the section bar"
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
              chip it's a dead target taking room from seven real ones. */}
          {flatten(nodes)
            .filter((node) => node.href)
            .map((node) => (
              <li key={node.id} className="shrink-0">
                <CompactChip node={node} active={node.href === pathname} />
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
