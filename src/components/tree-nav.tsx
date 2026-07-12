"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export interface TreeNode {
  id: string;
  label: string;
  /** If set, the node is a clickable link. If omitted, it's a group heading only. */
  href?: string;
  /** Hover tooltip text. */
  hint?: string;
  children?: TreeNode[];
}

export interface TreeNavProps {
  nodes: TreeNode[];
  className?: string;
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

export function TreeNav({ nodes, className = "" }: TreeNavProps) {
  const pathname = usePathname();

  return (
    <nav className={className}>
      <ul className="flex flex-col gap-0.5 p-2">
        {nodes.map((node) => (
          <TreeItem key={node.id} node={node} depth={0} pathname={pathname} />
        ))}
      </ul>
    </nav>
  );
}
