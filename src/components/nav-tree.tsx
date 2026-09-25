"use client";

// The navigation tree: the whole app's navigation in one column.
//
// Replaces the 48px module rail *and* the 240px section panel on the full layout
// — see design.md, "Navigation: the tree". Every module the reader can reach is a
// collapsible heading; its sections are the rows underneath; Home is a leaf on top.
//
// **Full layout only.** Compact keeps the two-tier bottom bar `SectionPanel` draws,
// unchanged. That is a deliberate split rather than an oversight: a tree is a
// pointer-and-vertical-space shape, and the ~70 rows that make it useful on a
// monitor are exactly what makes it useless in a 74%-tall sheet. `TwoTierShell`
// picks; this component renders nothing on compact rather than restyling itself,
// the same way `ModuleRail` always has.
//
// The width is `--nav-tree-width` from globals.css, never a literal: `.app-main`
// belongs to a server layout that reserves the same space, and two places agreeing
// on a number by hand is how the two drift.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  filterTree,
  findActiveModule,
  findActiveSection,
  groupHitsByModule,
  resolveInitialExpanded,
  toggleExpandedModule,
  type NavigationTree,
  type TreeModule,
  type TreeSection,
} from "@/lib/navigation";
import { getIconSlot, sectionSlotId } from "@/lib/icons";
import { ModuleIcon } from "./module-icons";
import { SlotIcon } from "./slot-icon";
import { TreeIcon } from "./tree-icons";

// Resolved at module scope: `ICON_SLOTS` is a static array, so these are lookups
// rather than I/O. Non-null because both ids are registered in slots.ts and a test
// asserts every wired slot exists.
const HOME_SLOT = getIconSlot("chrome_tree_home")!;
const FILTER_SLOT = getIconSlot("chrome_tree_filter")!;

export interface NavTreeProps {
  tree: NavigationTree;
  /** The current path, for the active row and for which module opens by default. */
  activeHref: string;
  /**
   * Module slugs expanded on first paint, from the reader's stored preference.
   * Resolved server-side, so the tree's first render is already the shape they left
   * it in — navigation is the worst surface on which to rearrange itself one frame
   * after hydration.
   */
  expandedModules: string[];
  /**
   * Persists the expanded set. Fire-and-forget: the tree has already moved by the
   * time this is called, and a failed write costs a preference, not a navigation.
   */
  onExpandedChange?: (slugs: string[]) => void;
  /** Administration, when the reader is an admin. Rendered as a final heading. */
  adminModule?: TreeModule;
  /**
   * Open, or collapsed to a strip. Owned by `TwoTierShell` — the same state and the
   * same stored key the section panel's `«`/`»` used, so a reader who collapses
   * navigation has collapsed it, not collapsed one of two shapes of it.
   */
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/**
 * Module slug to icon-slot namespace, for the four that differ.
 *
 * A module's slug and its slot namespace are **not** the same string. Each shell
 * passes its own `iconNamespace` to `SectionPanel`, and four of them predate — or
 * simply never matched — the slug in `sys_modules`: Investments' slots were
 * registered under "stock" before migration 0108 renamed the module, and the other
 * three were shortened by hand. Slot ids are permanent once a reader has uploaded
 * an override, so this maps rather than renames. Anything absent uses its slug.
 *
 * Keep in step with the `iconNamespace` prop in the `*-shell.tsx` files — they are
 * the other half of this fact, and a module whose namespace changes here but not
 * there silently loses its uploaded icons in one of the two places.
 */
const SLOT_NAMESPACES: Record<string, string> = {
  investments: "stock",
  "csv-analysis": "csv",
  "music-library": "music",
  "picture-gallery": "gallery",
};

/** A section's icon, as an override-aware slot when its module has a namespace. */
function SectionIcon({
  moduleSlug,
  section,
  className,
}: {
  moduleSlug: string;
  section: TreeSection;
  className?: string;
}) {
  const namespace = SLOT_NAMESPACES[moduleSlug] ?? moduleSlug;
  const slot = getIconSlot(sectionSlotId(namespace, section.id));
  if (slot) return <SlotIcon slot={slot} className={className} />;
  return <TreeIcon name={section.icon} className={className} />;
}

/** One section row. Shared by the tree and its filtered form. */
function SectionRow({
  moduleSlug,
  section,
  active,
  match,
}: {
  moduleSlug: string;
  section: TreeSection;
  active: boolean;
  /** `[start, length]` of the filter match in the label, for the highlight. */
  match?: [number, number];
}) {
  return (
    <Link
      href={section.href}
      title={section.hint ?? section.label}
      aria-current={active ? "page" : undefined}
      className={`flex w-full items-center gap-2 rounded-md py-1.5 pl-2 pr-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
        active ? "bg-brass-soft font-medium text-brass-dark" : "text-ink hover:bg-line/60"
      }`}
    >
      <SectionIcon moduleSlug={moduleSlug} section={section} className="h-4 w-4 shrink-0" />
      <span className="truncate">
        {match ? (
          <>
            {section.label.slice(0, match[0])}
            <mark className="rounded-sm bg-brass/30 text-inherit">
              {section.label.slice(match[0], match[0] + match[1])}
            </mark>
            {section.label.slice(match[0] + match[1])}
          </>
        ) : (
          section.label
        )}
      </span>
    </Link>
  );
}

/**
 * A module's sections, with its own group headings as labels between rows.
 *
 * The tree spends its one level of nesting on the module, so a module's internal
 * groups are *labels*, not a second accordion — the same trade `CompactSectionList`
 * makes, and for the same reason: a heading is a 20px label, and collapsing one
 * inside an already-collapsible module would be two chevrons deep for six rows.
 */
function SectionList({
  module,
  sections,
  activeHref,
  matches,
}: {
  module: TreeModule;
  sections: TreeSection[];
  activeHref: string;
  matches?: Map<string, [number, number]>;
}) {
  const rendered: ReactNode[] = [];
  let lastGroup: string | undefined;

  for (const section of sections) {
    if (section.group && section.group !== lastGroup) {
      rendered.push(
        <li
          key={`group-${section.group}`}
          className="px-2 pb-0.5 pt-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted"
        >
          {section.group}
        </li>,
      );
    }
    lastGroup = section.group;

    rendered.push(
      <li key={section.id}>
        <SectionRow
          moduleSlug={module.slug}
          section={section}
          active={section.href === activeHref}
          match={matches?.get(`${module.slug}:${section.id}`)}
        />
      </li>,
    );
  }

  return <ul className="flex flex-col py-1 pl-4 pr-1">{rendered}</ul>;
}

/** One module heading and, when expanded, its sections. */
function ModuleGroup({
  module,
  sections,
  activeHref,
  expanded,
  containsActive,
  onToggle,
  matches,
}: {
  module: TreeModule;
  sections: TreeSection[];
  activeHref: string;
  expanded: boolean;
  containsActive: boolean;
  onToggle: () => void;
  matches?: Map<string, [number, number]>;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        title={module.hint ?? module.name}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
          containsActive ? "font-medium text-brass-dark" : "text-ink hover:bg-line/40"
        }`}
      >
        <span
          className={`inline-block w-3 shrink-0 text-muted transition-transform motion-reduce:transition-none ${
            expanded ? "rotate-90" : ""
          }`}
          aria-hidden
        >
          &rsaquo;
        </span>
        <ModuleIcon name={module.icon} className="h-4 w-4 shrink-0" />
        <span className="flex-1 truncate">{module.name}</span>
      </button>
      {expanded && sections.length > 0 && (
        <SectionList
          module={module}
          sections={sections}
          activeHref={activeHref}
          matches={matches}
        />
      )}
    </li>
  );
}

export function NavTree({
  tree,
  activeHref,
  expandedModules,
  onExpandedChange,
  adminModule,
  isOpen = true,
  onOpenChange,
  className = "",
}: NavTreeProps) {
  const activeModule = findActiveModule(tree, activeHref);
  const activeSection = findActiveSection(tree, activeHref);

  // The active module is always expanded on top of what's stored — a tree whose
  // current section is hidden inside a collapsed heading has nothing highlighted
  // and reads as though navigation has lost track of where you are.
  const [expanded, setExpanded] = useState(() =>
    resolveInitialExpanded(new Set(expandedModules), activeModule?.slug),
  );
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Navigating to another module expands it, without disturbing anything the
  // reader has collapsed. Keyed on the slug rather than the path so moving
  // between two sections of one module doesn't re-run it.
  const activeSlug = activeModule?.slug;
  useEffect(() => {
    if (!activeSlug) return;
    setExpanded((current) => (current.has(activeSlug) ? current : new Set(current).add(activeSlug)));
  }, [activeSlug]);

  // Administration is appended rather than living in `tree.modules`: it has no
  // `sys_modules` row, so it isn't a module the tree can be built from, but it is
  // a destination with sections and it belongs in the same column.
  const allModules = useMemo(
    () => (adminModule ? [...tree.modules, adminModule] : tree.modules),
    [tree.modules, adminModule],
  );
  const searchTree = useMemo<NavigationTree>(
    () => ({ home: tree.home, modules: allModules }),
    [tree.home, allModules],
  );

  const filtering = query.trim().length > 0;
  const hits = useMemo(
    () => (filtering ? filterTree(searchTree, query) : []),
    [filtering, searchTree, query],
  );
  const grouped = useMemo(
    () => (filtering ? groupHitsByModule(searchTree, hits) : []),
    [filtering, searchTree, hits],
  );

  // Where to paint the highlight on each hit, keyed by module:section. Built once
  // per query rather than re-derived per row.
  const matches = useMemo(() => {
    const map = new Map<string, [number, number]>();
    for (const hit of hits) {
      if (hit.matchIndex >= 0) {
        map.set(`${hit.module.slug}:${hit.section.id}`, [hit.matchIndex, query.trim().length]);
      }
    }
    return map;
  }, [hits, query]);

  function handleToggle(slug: string) {
    const next = toggleExpandedModule(expanded, slug);
    setExpanded(next);
    onExpandedChange?.([...next]);
  }

  // The rows to draw: every module when idle, only modules with hits when filtering.
  // While filtering every shown module is open regardless of `expanded` — a match
  // hidden behind a collapsed heading is a filter that looks broken.
  const rows = filtering
    ? grouped.map(({ module, sections }) => ({ module, sections, open: true }))
    : allModules.map((module) => ({
        module,
        sections: module.sections,
        open: expanded.has(module.slug),
      }));

  // Collapsed: a strip, not a rail. Deliberately too narrow to navigate from —
  // it holds one control, and that control's whole job is to bring the tree back.
  // See design.md: a 48px glyph column mixing modules and sections is the thing
  // `TreeNav` did and the two-tier shell was built to stop. Nothing is read here,
  // so 28px is enough, and the content gets the other 232px.
  if (!isOpen) {
    return (
      <nav
        aria-label="Main navigation"
        className={`shell-tree flex flex-col items-center border-r border-line bg-paper-raised ${className}`}
      >
        <button
          type="button"
          onClick={() => onOpenChange?.(true)}
          title="Show navigation"
          aria-label="Show navigation"
          aria-expanded={false}
          // Full height, so the entire strip is the target rather than a 28px
          // square at the top — at this width a small button is a hard thing to
          // hit, and there is nothing else here to compete with it.
          className="flex w-full flex-1 items-start justify-center pt-3 text-muted transition-colors hover:bg-line/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brass"
        >
          <span aria-hidden>&raquo;</span>
        </button>
      </nav>
    );
  }

  return (
    <nav
      aria-label="Main navigation"
      className={`shell-tree flex flex-col border-r border-line bg-paper-raised ${className}`}
    >
      <div className="flex items-center gap-1 border-b border-line p-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-paper px-2 py-1.5 text-sm focus-within:border-brass focus-within:ring-2 focus-within:ring-brass-soft">
          <SlotIcon slot={FILTER_SLOT} className="h-4 w-4 shrink-0 text-muted" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");
            }}
            placeholder="Filter"
            aria-label="Filter navigation"
            // `[&::-webkit-search-cancel-button]:hidden` — the native clear button
            // sits on the theme's own paper and can't be restyled to match.
            className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
          />
          {filtering && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label="Clear filter"
              className="shrink-0 rounded px-1 text-muted hover:text-ink"
            >
              &times;
            </button>
          )}
        </label>

        {/* Collapse. Beside the filter rather than in a header of its own: the
            tree has no module-identity row to hang one on — it belongs to no
            module — so this is the only chrome it has. The `»` that reopens it
            lives in `AppHeader`, the same pairing the section panel used. */}
        {onOpenChange && (
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            title="Hide navigation"
            aria-label="Hide navigation"
            aria-expanded
            className="flex h-7 w-6 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-line/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          >
            <span aria-hidden>&laquo;</span>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {/* Home sits above the modules and outside the filter: it is one row that
            every reader knows by position, and dropping it on a non-matching query
            would move the one fixed landmark in the column. */}
        <Link
          href={tree.home.href}
          title={tree.home.hint ?? tree.home.label}
          aria-current={activeHref === tree.home.href ? "page" : undefined}
          className={`mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
            activeHref === tree.home.href
              ? "bg-brass-soft font-medium text-brass-dark"
              : "text-ink hover:bg-line/60"
          }`}
        >
          <span className="w-3 shrink-0" aria-hidden />
          <SlotIcon slot={HOME_SLOT} className="h-4 w-4 shrink-0" />
          <span className="truncate">{tree.home.label}</span>
        </Link>

        <ul className="flex flex-col gap-0.5">
          {rows.map(({ module, sections, open }) => (
            <ModuleGroup
              key={module.slug}
              module={module}
              sections={sections}
              activeHref={activeHref}
              expanded={open}
              containsActive={module.slug === activeSection?.module.slug}
              onToggle={() => handleToggle(module.slug)}
              matches={filtering ? matches : undefined}
            />
          ))}
        </ul>

        {filtering && grouped.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-muted">
            No section matches &ldquo;{query.trim()}&rdquo;
          </p>
        )}
      </div>
    </nav>
  );
}
