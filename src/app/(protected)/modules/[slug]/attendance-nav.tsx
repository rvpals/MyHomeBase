"use client";

// The Attendance module's section tree. Uses the shared TreeNav, which
// highlights the active node by comparing href to the pathname — so each section
// is a real route rather than client-side state, and stays bookmarkable.
//
// Only the component lives here. The section list and its metadata are in
// attendance-sections.ts so server components can read them as real values.

import { TreeNav, type TreeNavState, type TreeNode } from "@/components/tree-nav";
import {
  ATTENDANCE_SECTIONS,
  ATTENDANCE_SECTION_ICONS,
  ATTENDANCE_SECTION_INFO,
  attendanceSectionHref,
} from "./attendance-sections";

export function AttendanceNav({
  onStateChange,
  module,
}: {
  onStateChange?: (state: TreeNavState) => void;
  module?: { name: string; icon: string };
}) {
  const nodes: TreeNode[] = ATTENDANCE_SECTIONS.map((section) => ({
    id: section,
    label: ATTENDANCE_SECTION_INFO[section].label,
    href: attendanceSectionHref(section),
    hint: ATTENDANCE_SECTION_INFO[section].description,
    icon: ATTENDANCE_SECTION_ICONS[section],
  }));

  // Its own storageKey: the collapsed state is per-tree, so folding this one away
  // doesn't fold the Journal, Stock, Expense or Administration trees too.
  return (
    <TreeNav
      nodes={nodes}
      module={module}
      collapsible
      storageKey="myhomebase:attendance-nav-collapsed"
      onStateChange={onStateChange}
      // The rail's card surface. TreeNav drops it for either bar, where
      // rounded corners on a full-width strip read wrong.
      className="rounded-xl border border-line bg-paper-raised"
    />
  );
}
