"use client";

// The Music Library module's section tree. Uses the shared TreeNav, which highlights
// the active node by comparing href to the pathname -- so each section is a real route
// rather than client-side state, and stays bookmarkable.
//
// Only the component lives here. The section list and its metadata are in
// music-sections.ts so server components can read them as real values.

import { TreeNav, type TreeNavState, type TreeNode } from "@/components/tree-nav";
import {
  MUSIC_SECTIONS,
  MUSIC_SECTION_ICONS,
  MUSIC_SECTION_INFO,
  musicSectionHref,
} from "./music-sections";

export function MusicNav({
  onStateChange,
  module,
}: {
  onStateChange?: (state: TreeNavState) => void;
  module?: { name: string; icon: string };
}) {
  const nodes: TreeNode[] = MUSIC_SECTIONS.map((section) => ({
    id: section,
    label: MUSIC_SECTION_INFO[section].label,
    href: musicSectionHref(section),
    hint: MUSIC_SECTION_INFO[section].description,
    icon: MUSIC_SECTION_ICONS[section],
  }));

  // Its own storageKey, so folding this tree away doesn't fold the Journal, Stock,
  // Expense, Attendance or Administration trees too.
  return (
    <TreeNav
      nodes={nodes}
      module={module}
      collapsible
      storageKey="myhomebase:music-nav-collapsed"
      onStateChange={onStateChange}
      className="rounded-xl border border-line bg-paper-raised"
    />
  );
}
