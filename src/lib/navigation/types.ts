// The navigation tree's data shapes — the whole app's navigation as plain data.
//
// Deliberately independent of `SectionNode` in `src/components/section-panel.tsx`.
// That type is a *component prop*: it carries `icon` strings the panel resolves and
// it is shaped for one module at a time. This one is the tree's own model, owns the
// module level `SectionNode` has no concept of, and lives under `src/lib/` where a
// CLI command can read it without importing a React component.

/** A section inside a module — a leaf of the tree, and always a destination. */
export interface TreeSection {
  /** The section slug. Unique within its module, not across the app. */
  id: string;
  label: string;
  href: string;
  /** The one-line description from the module's `*-sections.ts`, used as the row title. */
  hint?: string;
  /** Glyph name for `TreeIcon`, or the concept a registered icon slot falls back to. */
  icon?: string;
  /**
   * The heading this section sits under *within* its module ("Configuration",
   * "Data Management"), or `undefined` for an ungrouped section.
   *
   * A string rather than nesting, because the tree has already spent its one level
   * of nesting on the module. A module's own groups become labels between rows —
   * the same trade `CompactSectionList` already makes, and for the same reason: a
   * heading is a label, not a level, so nothing costs an extra click.
   */
  group?: string;
}

/** A module — a collapsible heading, and never itself a destination. */
export interface TreeModule {
  slug: string;
  /** The module's short name, as the heading reads. */
  name: string;
  /** Where the heading's own module root lives, for the breadcrumb to link back to. */
  href: string;
  /** The module's icon from `sys_modules`, already admin-editable. Not slotted. */
  icon: string;
  hint?: string;
  sections: TreeSection[];
}

/**
 * The whole tree: Home, then every module the reader can reach.
 *
 * Home is modelled as its own field rather than as a module with one section,
 * because it is a leaf at the top level and nothing else in the tree is. Giving
 * it a fake module row would make every consumer filter it back out.
 */
export interface NavigationTree {
  home: TreeSection;
  modules: TreeModule[];
}
