"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { TreeIcon } from "./tree-icons";

const COLLAPSED_STORAGE_KEY = "myhomebase:tree-nav-collapsed";

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
  /** Show a collapse toggle; collapsed state shows one icon-only row per node (flattened). */
  collapsible?: boolean;
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

export function TreeNav({ nodes, collapsible = false, className = "" }: TreeNavProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!collapsible) return;
    const stored = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
    // Syncing from an external system (localStorage) on mount, not reacting to React state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored !== null) setCollapsed(stored === "true");
  }, [collapsible]);

  useEffect(() => {
    if (!collapsible) return;
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(collapsed));
  }, [collapsible, collapsed]);

  return (
    <nav
      className={`flex flex-col transition-[width] motion-reduce:transition-none ${
        collapsible ? (collapsed ? "w-16" : "w-64") : ""
      } ${className}`}
    >
      {collapsible && (
        <div className="flex items-center justify-end border-b border-line p-2">
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand panel" : "Collapse panel"}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-line/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          >
            {collapsed ? "»" : "«"}
          </button>
        </div>
      )}
      {collapsible && collapsed ? (
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
