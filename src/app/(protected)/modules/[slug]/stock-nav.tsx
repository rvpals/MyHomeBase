"use client";

// The Stocks & ETFs module's section tree. Uses the shared TreeNav, which
// highlights the active node by comparing href to the pathname — so each section
// is a real route rather than client-side state, and stays bookmarkable.
//
// Only the component lives here. The section list and its metadata are in
// stock-sections.ts so server components can read them as real values.

import { TreeNav, type TreeNode } from "@/components/tree-nav";
import {
  STOCK_SECTIONS,
  STOCK_SECTION_ICONS,
  STOCK_SECTION_INFO,
  stockSectionHref,
} from "./stock-sections";

export function StockNav() {
  const nodes: TreeNode[] = STOCK_SECTIONS.map((section) => ({
    id: section,
    label: STOCK_SECTION_INFO[section].label,
    href: stockSectionHref(section),
    hint: STOCK_SECTION_INFO[section].description,
    icon: STOCK_SECTION_ICONS[section],
  }));

  // Its own storageKey: the collapsed state is per-tree, so folding this one away
  // doesn't fold the Expense or Administration trees too.
  return (
    <TreeNav
      nodes={nodes}
      collapsible
      storageKey="myhomebase:stock-nav-collapsed"
      className="rounded-xl border border-line bg-paper-raised"
    />
  );
}
