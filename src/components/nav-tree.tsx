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
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from "react";
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

// Where the tree's scroll offset is parked across navigations.
//
// The tree is rendered by `TwoTierShell`, which each module's own shell mounts —
// so it lives *under* the route, not in the `(protected)` layout above it. Every
// link therefore unmounts this component and mounts a fresh one, and a fresh
// scroll container starts at 0: click a row near the bottom and the column snaps
// back to Home while the page you asked for loads. Storing the offset is what
// makes the tree hold still.
//
// `localStorage`, matching the section panel and the collapsible cards. One key
// for the whole tree rather than one per route: the question it answers is "where
// was this column", and that has a single answer regardless of which page is open.
const SCROLL_STORAGE_KEY = "myhomebase:nav-tree-scroll";

// `useLayoutEffect` runs before the browser paints, so the restored offset is the
// first thing drawn rather than a visible jump one frame in. It warns when run
// during SSR, though, and this component is server-rendered despite "use client" —
// so on the server it falls back to `useEffect`, which never runs there anyway.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

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
 * A module's sections: grouped ones as nested boxes, ungrouped ones on a spine.
 *
 * Administration is the only module that declares groups, and its headings are a
 * real second level — `Configuration`, `Display Settings`, `Daily Quote` each own
 * their screens. They are drawn as containers, not as captions between rows, so the
 * heading reads as the level it is. Still no second accordion: the boxes are always
 * open, so nothing costs an extra click.
 *
 * `grouped={false}` turns the boxes off for the filtered view — see below.
 */
function SectionList({
  module,
  sections,
  activeHref,
  matches,
  grouped = true,
}: {
  module: TreeModule;
  sections: TreeSection[];
  activeHref: string;
  matches?: Map<string, [number, number]>;
  /**
   * Whether to draw group boxes. False while filtering: hits arrive ranked by
   * match quality rather than in `adminNav` order, so a query matching two
   * sections of one group with another group's hit between them would break the
   * run in two and draw the same heading twice. A ranked list is flat by nature —
   * boxing it would impose an order the ranking has deliberately discarded.
   */
  grouped?: boolean;
}) {
  const runs = grouped ? groupSections(sections) : [{ sections }];

  return (
    <ul className="flex flex-col gap-1.5 py-1.5 pl-4 pr-1.5">
      {runs.map((run) =>
        run.group ? (
          <SectionGroupBox
            key={`group-${run.group}`}
            module={module}
            run={run}
            activeHref={activeHref}
            matches={matches}
          />
        ) : (
          // Ungrouped sections — every module but Administration. Unchanged: a
          // spine down the left with an elbow out to each row.
          run.sections.map((section, index) => (
            <SpinedRow
              key={section.id}
              module={module}
              section={section}
              isLast={index === run.sections.length - 1}
              activeHref={activeHref}
              matches={matches}
            />
          ))
        ),
      )}
    </ul>
  );
}

/** A run of adjacent sections sharing a `group` (or a run of ungrouped ones). */
interface SectionRun {
  group?: string;
  groupHref?: string;
  groupIcon?: string;
  sections: TreeSection[];
}

/**
 * Splits a module's sections into consecutive runs by `group`.
 *
 * Adjacency is the rule, not identity: a group interrupted by another and resumed
 * draws as two boxes rather than one box with a hole in it. `TreeSection` documents
 * that expectation, and `adminNav`'s order satisfies it.
 */
function groupSections(sections: TreeSection[]): SectionRun[] {
  const runs: SectionRun[] = [];
  for (const section of sections) {
    const current = runs[runs.length - 1];
    if (current && current.group === section.group) {
      current.sections.push(section);
      continue;
    }
    runs.push({
      group: section.group,
      groupHref: section.groupHref,
      groupIcon: section.groupIcon,
      sections: [section],
    });
  }
  return runs;
}

/** One section row on the module's spine, with its elbow. The ungrouped shape. */
function SpinedRow({
  module,
  section,
  isLast,
  activeHref,
  matches,
}: {
  module: TreeModule;
  section: TreeSection;
  isLast: boolean;
  activeHref: string;
  matches?: Map<string, [number, number]>;
}) {
  return (
    <li className="relative pl-4">
      {/* The trunk linking every section back up to the module heading. Stops
          halfway down the last row, where its elbow leaves the trunk, so the
          line never dangles below the final item. */}
      <span
        aria-hidden
        className={`absolute left-0 w-px bg-line ${isLast ? "top-0 h-[1.125rem]" : "inset-y-0"}`}
      />
      {/* The elbow out to this row. `top-[1.125rem]` lands on the row's vertical
          centre: `py-1.5` (6px) above a 20px line box. */}
      <span aria-hidden className="absolute left-0 top-[1.125rem] h-px w-2.5 bg-line" />
      <SectionRow
        moduleSlug={module.slug}
        section={section}
        active={section.href === activeHref}
        match={matches?.get(`${module.slug}:${section.id}`)}
      />
    </li>
  );
}

/**
 * A group of sections as a nested box inside the module's slab.
 *
 * The second level Administration actually has — `Configuration`, `Display
 * Settings`, `Daily Quote` — drawn as a container rather than the caption it used
 * to be, so the heading reads as a level of its own. Only Administration declares
 * groups today, so this is the only place it appears.
 *
 * Inset and quieter than the module slab above it: `bg-paper`, a plain border and
 * no `card-embossed`. A nested box with the same weight as its parent competes
 * with it, and the module heading has to stay the loudest thing in the column.
 *
 * No spine or elbows inside. The box's own border is the containment signal, and
 * running a second trunk down a bordered box is two answers to one question.
 */
function SectionGroupBox({
  module,
  run,
  activeHref,
  matches,
}: {
  module: TreeModule;
  run: SectionRun;
  activeHref: string;
  matches?: Map<string, [number, number]>;
}) {
  // The header links only when the heading is itself a page. Most are not:
  // "Configuration" has no route, and a header that navigates on some groups and
  // not others is honest here precisely because it looks different — a link is
  // styled as one, a label is not.
  const headerContent = (
    <>
      {run.groupIcon && <TreeIcon name={run.groupIcon} className="h-3.5 w-3.5 shrink-0" />}
      <span className="truncate">{run.group}</span>
    </>
  );
  const headerClass =
    "flex w-full items-center gap-1.5 px-2 py-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider";
  const isHeaderActive = run.groupHref !== undefined && run.groupHref === activeHref;

  return (
    <li className="nav-group overflow-hidden rounded-md border-line bg-paper">
      {run.groupHref ? (
        <Link
          href={run.groupHref}
          aria-current={isHeaderActive ? "page" : undefined}
          className={`${headerClass} nav-group-head border-line transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brass ${
            isHeaderActive
              ? "bg-brass-soft text-brass-dark"
              : "text-muted hover:bg-line/50 hover:text-ink"
          }`}
        >
          {headerContent}
        </Link>
      ) : (
        <span className={`${headerClass} nav-group-head border-line text-muted`}>{headerContent}</span>
      )}
      <ul className="flex flex-col p-1">
        {run.sections.map((section) => (
          <li key={section.id}>
            <SectionRow
              moduleSlug={module.slug}
              section={section}
              active={section.href === activeHref}
              match={matches?.get(`${module.slug}:${section.id}`)}
            />
          </li>
        ))}
      </ul>
    </li>
  );
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
    // The slab. `card-embossed` + `card-raised-hover` is design.md's sanctioned pair
    // for "a card that should read as a thick slab" — the same treatment the old
    // section panel gave its accordion groups, and for the same reason: a heading and
    // its children separated only by indentation is the weakest signal available in a
    // column this narrow. `overflow-hidden` clips the children's spine to the box, so
    // the focus ring on the header below is `ring-inset` or it would be cut off.
    //
    // `chrome-slab` is a pure styling hook carrying no geometry — globals.css
    // selects on it under `[data-chrome-style="…"]` for the admin's chosen bevel
    // (migrations/0121). It sits BESIDE `card-embossed` rather than replacing it:
    // that class is shared with cards across the app, and `current` is defined as
    // the look you get with no chrome override at all.
    <li className="chrome-slab card-embossed card-raised-hover overflow-hidden rounded-lg border-line bg-paper-raised">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        title={module.hint ?? module.name}
        // `font-display` and `text-base`: a module name is a heading, and design.md
        // sends headings and module names to the display face. It is the one thing
        // in this column that names a *place you own* rather than a page inside one,
        // so it is deliberately a step up in both size and face from its sections'
        // `text-sm` body font.
        className={`flex w-full items-center gap-2 px-2.5 py-2 text-left font-display text-base tracking-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brass ${
          expanded ? "nav-divider border-line" : ""
        } ${containsActive ? "font-semibold text-brass-dark" : "text-ink hover:bg-line/40"}`}
      >
        {/* No chevron. The slab says it already: expanded, it has a divider under
            the heading and its sections below; collapsed, it is a closed box. A
            glyph repeating that is a second answer to a question already answered,
            and `aria-expanded` above carries it for anyone not reading the shape. */}
        <ModuleIcon name={module.icon} className="h-[1.125rem] w-[1.125rem] shrink-0" />
        <span className="flex-1 truncate">{module.name}</span>
      </button>
      {expanded && sections.length > 0 && (
        <SectionList
          module={module}
          sections={sections}
          activeHref={activeHref}
          matches={matches}
          // `matches` is passed only while filtering, so its presence is the
          // filtering flag the boxes key off — see `SectionList`'s `grouped`.
          grouped={matches === undefined}
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
  const scrollRef = useRef<HTMLDivElement>(null);

  // Put the column back where the reader left it, before the first paint.
  //
  // Runs on mount only: this component is remounted by every navigation (see
  // `SCROLL_STORAGE_KEY`), so "on mount" *is* "on each navigation" here. Skipped
  // while the tree is collapsed, when there is no scroll container to restore.
  useIsomorphicLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    try {
      const stored = Number(window.localStorage.getItem(SCROLL_STORAGE_KEY));
      // Clamped rather than assigned blind: the stored offset was measured against
      // whatever the tree looked like last time, and a module collapsed or a filter
      // typed since then can leave it taller than the column now is. The browser
      // would clamp anyway — doing it here keeps what we write back honest.
      if (Number.isFinite(stored) && stored > 0) {
        node.scrollTop = Math.min(stored, node.scrollHeight - node.clientHeight);
      }
    } catch {
      // A browser with storage disabled gets a tree that starts at the top. That is
      // the old behaviour, not a broken one, so there is nothing to report.
    }
  }, []);

  // Written on scroll rather than on click: the reader can also get here with the
  // wheel, a drag, or keyboard focus, and all of those should survive the next
  // navigation too. No throttle — this is one small synchronous write against a
  // key that is overwritten anyway, and debouncing it would risk losing the last
  // position to the unmount that follows a click.
  function handleScroll(event: UIEvent<HTMLDivElement>) {
    try {
      window.localStorage.setItem(SCROLL_STORAGE_KEY, String(event.currentTarget.scrollTop));
    } catch {
      // Storage disabled or full. The tree still scrolls; it just won't remember.
    }
  }

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

  // Home's href carries a query string (`/?home=1` — see `HOME_SECTION`), but
  // `activeHref` is a `usePathname()` value and never has one. Comparing the two
  // directly would leave the row unhighlighted on the very screen it points at,
  // so the path is compared on its own. Only Home needs this: every other row's
  // href is a bare path.
  const isHomeActive = activeHref === tree.home.href.split("?")[0];

  // Collapsed: a strip, not a rail. Deliberately too narrow to navigate from —
  // it holds one control, and that control's whole job is to bring the tree back.
  // See design.md: a 48px glyph column mixing modules and sections is the thing
  // `TreeNav` did and the two-tier shell was built to stop. Nothing is read here,
  // so 28px is enough, and the content gets the other 232px.
  if (!isOpen) {
    return (
      <nav
        aria-label="Main navigation"
        className={`shell-tree chrome-frame flex flex-col items-center border-line bg-paper-raised ${className}`}
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
      // Two classes doing two different jobs, and the split matters: `shell-tree`
      // is the LAYOUT (fixed, full height, `--nav-tree-width`) and `chrome-frame`
      // is a geometry-free styling hook for the admin's chrome bevel. Anything
      // that wants the bevel without becoming a fixed column — the admin picker's
      // preview thumbnails — wears `chrome-frame` alone. Never move the bevel
      // rules onto `shell-tree`; see globals.css's chrome-style block for the
      // failure that caused.
      className={`shell-tree chrome-frame flex flex-col border-line bg-paper-raised ${className}`}
    >
      <div className="nav-divider flex items-center gap-1 border-line p-2">
        <label className="nav-field flex min-w-0 flex-1 items-center gap-2 rounded-lg border-line bg-paper px-2 py-1.5 text-sm focus-within:border-brass focus-within:ring-2 focus-within:ring-brass-soft">
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

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-2">
        {/* Home sits above the modules and outside the filter: it is one row that
            every reader knows by position, and dropping it on a non-matching query
            would move the one fixed landmark in the column. */}
        <Link
          href={tree.home.href}
          title={tree.home.hint ?? tree.home.label}
          aria-current={isHomeActive ? "page" : undefined}
          // Sized and faced like a module heading, because that is what it is at
          // this level — a top-level destination, not a section. Left as a plain row
          // rather than a slab: a slab is a container for children, and Home has
          // none, so an empty one would promise something that never opens.
          className={`mb-2 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 font-display text-base tracking-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
            isHomeActive
              ? "bg-brass-soft font-semibold text-brass-dark"
              : "text-ink hover:bg-line/60"
          }`}
        >
          <SlotIcon slot={HOME_SLOT} className="h-[1.125rem] w-[1.125rem] shrink-0" />
          <span className="truncate">{tree.home.label}</span>
        </Link>

        {/* `gap-2`, not `gap-0.5`: each module is now a raised slab with its own
            cast shadow, and slabs stacked flush read as one box with lines across
            it. The gap is what makes them separate objects. */}
        <ul className="flex flex-col gap-2">
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
