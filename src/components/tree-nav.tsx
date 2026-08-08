"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { TreeIcon } from "./tree-icons";

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

function CollapsedRow({ node, pathname }: { node: TreeNode; pathname: string }) {
  const active = Boolean(node.href) && node.href === pathname;
  const icon = <TreeIcon name={node.icon} className="h-4 w-4 text-brass" />;

  if (!node.href) {
    return (
      <div title={node.hint ?? node.label} className="flex items-center justify-center py-2 text-muted">
        {icon}
      </div>
    );
  }

  return (
    <Link
      href={node.href}
      title={node.hint ?? node.label}
      className={`flex items-center justify-center rounded-md py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
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
  const [state, setState] = useState<TreeNavState>("full");
  const isRail = state === "rail";

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
    return (
      <nav
        className={`flex min-h-24 ${WIDTH_CLASS.strip} flex-col self-stretch overflow-hidden transition-[width] motion-reduce:transition-none ${className}`}
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
      className={`flex flex-col transition-[width] motion-reduce:transition-none ${
        collapsible ? WIDTH_CLASS[state] : ""
      } ${className}`}
    >
      {collapsible && (
        <div
          className={`flex items-center border-b border-line p-2 ${
            isRail ? "flex-col gap-0.5" : "justify-end gap-0.5"
          }`}
        >
          {/* Two controls, each reversible on its own: the chevron moves between
              full and rail, and « drops to the strip. Same split as Sidebar — a
              single control cycling three states can only go one way, so
              overshooting would mean going all the way round. */}
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
          <button
            type="button"
            onClick={() => setState("strip")}
            aria-label="Hide the section tree"
            title="Hide the section tree — click the edge to bring it back"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-line/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          >
            <span aria-hidden>&laquo;</span>
          </button>
        </div>
      )}
      {collapsible && isRail ? (
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
