"use client";

// Tier 2 of the horizontal shell: the current module's sections, as a chip strip.
//
// The full layout's `horizontal` navigation shape (see design.md, "The full
// layout's two shapes") splits navigation the way compact already does — modules
// on one tier, sections on another — rather than nesting sections inside modules
// the way the tree does. This is that second tier.
//
// **Full layout only**, like `NavTree`. Compact keeps `SectionPanel`'s bottom bar
// untouched: a horizontal strip of 23 chips on a 390px phone is a scroller at the
// top edge competing with the bar that already owns sections at the bottom edge.
// `TwoTierShell` decides; this component is never rendered on compact.
//
// **It does not position itself.** `TwoTierShell` renders this inside
// `.shell-topnav`, the sticky wrapper it shares with `NavTabs`, so the two bands
// dock to the top edge together and the current section stays named on screen
// however far the page scrolls. Giving this component its own `sticky` would mean
// hardcoding the tab row's height here — see the rule's note in globals.css.
//
// **Grouped sections collapse into one dropdown per group.** Journal has 23
// sections and Classroom 19, which no single row holds; its seven ungrouped
// sections fit, and "Data Management" and "Configuration" become two menus. That
// is the whole reason the strip is viable, and it is why `group` runs must stay
// adjacent in a module's `*-sections.ts` — same requirement the tree has.

import { useEffect, useRef, useState } from "react";
import { getIconSlot, sectionSlotId } from "@/lib/icons";
import type { TreeSection } from "@/lib/navigation";
import { slotNamespaceFor } from "./nav-slot-namespaces";
import { NavLinkRow, NavRowPending } from "./nav-pending";
import { SlotIcon } from "./slot-icon";
import { TreeIcon } from "./tree-icons";

/** A section's icon, resolved through its module's slot namespace. */
function SectionIcon({
  moduleSlug,
  section,
  className,
}: {
  moduleSlug: string;
  section: TreeSection;
  className?: string;
}) {
  const slot = getIconSlot(sectionSlotId(slotNamespaceFor(moduleSlug), section.id));
  if (slot) return <SlotIcon slot={slot} className={className} />;
  return <TreeIcon name={section.icon} className={className} />;
}

/**
 * A run of sections sharing one `group`, as the strip's own model.
 *
 * `undefined` label means the ungrouped run — the chips drawn inline. Built by
 * walking the array once rather than grouping by key, because adjacency is what
 * defines a group here (see `TreeSection.group`), and `groupBy` would silently
 * merge a group that was interrupted and resumed.
 */
interface SectionRun {
  label?: string;
  href?: string;
  icon?: string;
  sections: TreeSection[];
}

function buildRuns(sections: TreeSection[]): SectionRun[] {
  const runs: SectionRun[] = [];
  sections.forEach((section) => {
    const previous = runs[runs.length - 1];
    if (previous && previous.label === section.group) {
      previous.sections.push(section);
      return;
    }
    runs.push({
      label: section.group,
      href: section.groupHref,
      icon: section.groupIcon,
      sections: [section],
    });
  });
  return runs;
}

/** One section, as a chip. */
function SectionChip({
  moduleSlug,
  section,
  active,
}: {
  moduleSlug: string;
  section: TreeSection;
  active: boolean;
}) {
  return (
    <NavLinkRow
      href={section.href}
      title={section.hint ?? section.label}
      active={active}
      // `NavLinkRow`'s anchor is `block w-full` by default, which would make each
      // chip a full-width row. `wrapperClassName` is the documented seam for
      // positioning the row *within its parent* — here, shrinking it to its content
      // so the chips sit side by side.
      wrapperClassName="!w-auto shrink-0"
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
        active
          ? "border-brass bg-brass-soft font-medium text-brass-dark"
          : "border-line bg-paper-raised text-muted hover:text-ink"
      }`}
    >
      <NavRowPending id={section.href} className="h-3.5 w-3.5 shrink-0">
        <SectionIcon moduleSlug={moduleSlug} section={section} className="h-3.5 w-3.5 shrink-0" />
      </NavRowPending>
      <span className="truncate">{section.label}</span>
    </NavLinkRow>
  );
}

/**
 * A grouped run, as one chip that opens a menu.
 *
 * Closes on outside click and on Escape, and the trigger keeps the active styling
 * while the menu holds the current section — otherwise navigating into
 * "Configuration > Templates" would leave nothing on the strip marked current, the
 * same lost-your-place failure the tree guards against by force-expanding.
 */
function SectionMenu({
  moduleSlug,
  run,
  activeHref,
}: {
  moduleSlug: string;
  run: SectionRun;
  activeHref: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const holdsActive = run.sections.some((section) => section.href === activeHref);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Navigating closes it: the menu is a sibling of the page it links into, so
  // without this it would still be open behind the new route's first paint.
  useEffect(() => setOpen(false), [activeHref]);

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
          holdsActive
            ? "border-brass bg-brass-soft font-medium text-brass-dark"
            : "border-line bg-paper-raised text-muted hover:text-ink"
        }`}
      >
        {run.icon && <TreeIcon name={run.icon} className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate">{run.label}</span>
        <span aria-hidden className="text-[0.65rem] opacity-70">
          &#9662;
        </span>
      </button>

      {open && (
        // `z-30` keeps this inside the shell's band and below `Modal`'s `z-50`,
        // per design.md's "Stay under z-40".
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+4px)] z-30 min-w-[13rem] rounded-lg border border-line bg-paper-raised p-1 shadow-lg"
        >
          {run.href && (
            <NavLinkRow
              href={run.href}
              active={activeHref === run.href}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                activeHref === run.href
                  ? "bg-brass-soft font-medium text-brass-dark"
                  : "text-ink hover:bg-line/60"
              }`}
            >
              <span className="truncate">{run.label} overview</span>
            </NavLinkRow>
          )}
          {run.sections.map((section) => (
            <NavLinkRow
              key={section.href}
              href={section.href}
              title={section.hint ?? section.label}
              active={section.href === activeHref}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                section.href === activeHref
                  ? "bg-brass-soft font-medium text-brass-dark"
                  : "text-ink hover:bg-line/60"
              }`}
            >
              <NavRowPending id={section.href} className="h-4 w-4 shrink-0">
                <SectionIcon
                  moduleSlug={moduleSlug}
                  section={section}
                  className="h-4 w-4 shrink-0"
                />
              </NavRowPending>
              <span className="truncate">{section.label}</span>
            </NavLinkRow>
          ))}
        </div>
      )}
    </div>
  );
}

export interface SectionStripProps {
  /** The module these sections belong to, for resolving their icon slots. */
  moduleSlug: string;
  /** The module's sections, in declaration order. Groups must be adjacent. */
  sections: TreeSection[];
  /** The current path, for the active chip. */
  activeHref: string;
}

/**
 * The current module's sections as a horizontal strip.
 *
 * Renders nothing when the module has none — Clips, Games, Music and CSV Analysis
 * are all sectionless, and an empty band is a rule across the page that says
 * nothing. The tab row above it still names where you are.
 */
export function SectionStrip({ moduleSlug, sections, activeHref }: SectionStripProps) {
  if (sections.length === 0) return null;
  const runs = buildRuns(sections);

  return (
    // `chrome-bar` is the same styling hook `AppHeader` uses, so the admin's
    // bevel and border-weight settings reach this surface too without it
    // re-deriving either. Geometry is this component's; decoration is the hook's.
    <nav
      aria-label="Sections"
      className="chrome-bar flex flex-wrap items-center gap-1.5 border-line bg-paper px-3 py-2"
    >
      {runs.map((run, index) =>
        run.label === undefined ? (
          run.sections.map((section) => (
            <SectionChip
              key={section.href}
              moduleSlug={moduleSlug}
              section={section}
              active={section.href === activeHref}
            />
          ))
        ) : (
          <SectionMenu
            // Runs are positional, and two runs can share a label if a group is
            // interrupted and resumed — the index is the honest key.
            key={`${run.label}-${index}`}
            moduleSlug={moduleSlug}
            run={run}
            activeHref={activeHref}
          />
        ),
      )}
    </nav>
  );
}
