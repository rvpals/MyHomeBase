"use client";

// The My Journal module's section tree. Uses the shared TreeNav, which
// highlights the active node by comparing href to the pathname — so each section
// is a real route rather than client-side state, and stays bookmarkable.
//
// Only the component lives here. The section list and its metadata are in
// journal-sections.ts so server components can read them as real values.

import { TreeNav, type TreeNavState, type TreeNode } from "@/components/tree-nav";
import {
  JOURNAL_SECTIONS,
  JOURNAL_SECTION_ICONS,
  JOURNAL_SECTION_INFO,
  journalSectionHref,
} from "./journal-sections";

export function JournalNav({
  onStateChange,
  module,
}: {
  onStateChange?: (state: TreeNavState) => void;
  module?: { name: string; icon: string };
}) {
  const nodes: TreeNode[] = JOURNAL_SECTIONS.map((section) => ({
    id: section,
    label: JOURNAL_SECTION_INFO[section].label,
    href: journalSectionHref(section),
    hint: JOURNAL_SECTION_INFO[section].description,
    icon: JOURNAL_SECTION_ICONS[section],
  }));

  // Its own storageKey: the collapsed state is per-tree, so folding this one away
  // doesn't fold the Stock, Expense or Administration trees too.
  return (
    <TreeNav
      nodes={nodes}
      module={module}
      collapsible
      storageKey="myhomebase:journal-nav-collapsed"
      onStateChange={onStateChange}
      // The rail's card surface. TreeNav drops it for either bar, where
      // rounded corners on a full-width strip read wrong.
      className="rounded-xl border border-line bg-paper-raised"
    />
  );
}