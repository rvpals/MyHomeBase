"use client";

import { useState, type ReactNode } from "react";

export interface TreeNavNode {
  /** Unique across the whole tree — this is what selection is keyed on. */
  id: string;
  label: string;
  /** Shown right-aligned, dimmed. Typically a child count. */
  badge?: ReactNode;
  /** Told to the reader when the group is empty. */
  emptyMessage?: string;
  children: TreeNavLeaf[];
}

export interface TreeNavLeaf {
  id: string;
  label: string;
  /** Second line under the label, truncated to one line. */
  detail?: string;
}

export interface TreeNavProps {
  nodes: TreeNavNode[];
  /** Id of the selected leaf, or undefined for none. */
  selectedId?: string;
  onSelect: (leafId: string, nodeId: string) => void;
  /** Node ids expanded on first render. Defaults to the first node. */
  defaultExpandedIds?: string[];
  className?: string;
}

/**
 * A two-level tree: expandable groups, selectable leaves.
 *
 * Deliberately two levels, not arbitrary depth — the one caller needs exactly
 * that, and a recursive version costs indentation maths and keyboard handling
 * nothing is asking for yet. Selection is controlled; expansion is not, since
 * no caller has needed to drive which groups are open.
 */
export function TreeNav({
  nodes,
  selectedId,
  onSelect,
  defaultExpandedIds,
  className = "",
}: TreeNavProps) {
  const [expandedIds, setExpandedIds] = useState<string[]>(
    defaultExpandedIds ?? (nodes[0] ? [nodes[0].id] : []),
  );

  function toggle(nodeId: string) {
    setExpandedIds((current) =>
      current.includes(nodeId) ? current.filter((id) => id !== nodeId) : [...current, nodeId],
    );
  }

  return (
    <div className={`flex flex-col gap-2.5 ${className}`} role="tree">
      {nodes.map((node) => {
        const isExpanded = expandedIds.includes(node.id);

        return (
          <div
            key={node.id}
            className="card-embossed overflow-hidden rounded-lg border border-line bg-paper-raised"
          >
            <button
              type="button"
              role="treeitem"
              aria-expanded={isExpanded}
              aria-selected={false}
              onClick={() => toggle(node.id)}
              className={`flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm font-medium text-ink transition-colors hover:bg-line/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brass ${
                isExpanded ? "border-b border-line" : ""
              }`}
            >
              <span
                aria-hidden
                className={`shrink-0 text-xs text-muted transition-transform ${isExpanded ? "rotate-90" : ""}`}
              >
                ▶
              </span>
              <span className="min-w-0 flex-1 truncate">{node.label}</span>
              {node.badge !== undefined && (
                <span className="shrink-0 font-mono text-xs font-normal text-muted">{node.badge}</span>
              )}
            </button>

            {isExpanded && (
              <div role="group" className="flex flex-col py-1.5 pl-4 pr-1.5">
                {node.children.length === 0 ? (
                  <p className="px-2 py-1 text-xs italic text-muted">
                    {node.emptyMessage ?? "Nothing here."}
                  </p>
                ) : (
                  node.children.map((leaf, index) => {
                    const isSelected = leaf.id === selectedId;
                    const isLast = index === node.children.length - 1;

                    return (
                      <div key={leaf.id} className="relative pl-4">
                        {/* The spine linking every leaf back up to the group row.
                            Stops halfway down the last leaf, where its elbow
                            leaves the trunk, so the line never dangles. */}
                        <span
                          aria-hidden
                          className={`absolute left-0 w-px bg-line ${isLast ? "top-0 h-[1.125rem]" : "inset-y-0"}`}
                        />
                        {/* The elbow out to this leaf. */}
                        <span
                          aria-hidden
                          className="absolute left-0 top-[1.125rem] h-px w-3 bg-line"
                        />
                        <button
                          type="button"
                          role="treeitem"
                          aria-selected={isSelected}
                          onClick={() => onSelect(leaf.id, node.id)}
                          className={`w-full rounded-md px-2 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
                            isSelected
                              ? "bg-brass-soft font-medium text-brass-dark"
                              : "text-ink hover:bg-line/60"
                          }`}
                        >
                          <span className="block truncate font-mono text-xs">{leaf.label}</span>
                          {leaf.detail && (
                            <span className="block truncate text-xs text-muted">{leaf.detail}</span>
                          )}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
