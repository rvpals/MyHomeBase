"use client";

// Tier 2 of the two-tier shell: which section of the current module.
//
// Two genuinely different components behind one export, picked by layout:
//
//   full     a 240px fixed column, open or closed
//   compact  one bottom bar carrying BOTH tiers, which opens a sheet
//
// A fork rather than a restyle because 240px of side panel is most of a 390px
// phone — see design.md, "Fork a component only when restyling genuinely can't
// do it". The caller doesn't choose; `TwoTierShell` passes `isCompact` down.
//
// **Open or closed — there is no middle state.** Deliberately not `TreeNav`'s
// three-state full/rail/strip model: a 48px icon rail for *sections* sitting
// next to the 48px icon rail for *modules* is two ambiguous glyph columns side
// by side, which reads worse than either extreme.

import Link from "next/link";
import { createContext, useContext, useEffect, useId, useState } from "react";
import { getIconSlot, sectionSlotId } from "@/lib/icons";
import type { CompactNavStyle } from "@/lib/user-preferences";
import { ModuleIcon } from "./module-icons";
import { SlotIcon } from "./slot-icon";
import { TreeIcon } from "./tree-icons";

/**
 * The module's slot namespace ("expense", "journal", …), supplied once by `SectionPanel`
 * rather than threaded through `SectionRow` and `SectionGroup` as a prop.
 *
 * A context because this panel renders every module's nav from *data*: there is no call
 * site to name a slot at, and the alternative is a prop on four render sites plus two
 * internal components, all to carry one string that never changes within a render.
 */
const SectionNamespaceContext = createContext<string | undefined>(undefined);

/**
 * A section's icon, as an override-aware slot when the module declares a namespace.
 *
 * Falls straight back to `TreeIcon` when it doesn't, or when the derived id isn't a
 * registered slot — so a module whose sections predate the registry keeps working
 * unchanged, and a typo'd id degrades to the old behaviour instead of rendering nothing.
 */
/**
 * The module-identity glyph at the head of the panel and the sheet.
 *
 * Normally this is the module's OWN icon — already user-editable under Module
 * Configuration — so it is left alone; a slot here would be a second, competing way to set
 * one value. Administration is the exception: it has no row in `sys_modules`, so its glyph
 * is a hardcoded constant with no other way to change it, and it gets a slot.
 */
function ModuleIdentityIcon({ icon, className }: { icon: string; className?: string }) {
  const namespace = useContext(SectionNamespaceContext);
  const slot = namespace === "admin" ? getIconSlot("chrome_admin_identity") : undefined;
  if (slot) return <SlotIcon slot={slot} className={className} />;
  return <ModuleIcon name={icon} className={className} />;
}

function SectionIcon({ icon, id, className }: { icon?: string; id?: string; className?: string }) {
  const namespace = useContext(SectionNamespaceContext);
  const slot = namespace && id ? getIconSlot(sectionSlotId(namespace, id)) : undefined;
  if (slot) return <SlotIcon slot={slot} className={className} />;
  return <TreeIcon name={icon} className={className} />;
}

/**
 * One destination in the panel. `children` renders as an accordion group on
 * desktop and is flattened away on compact — see `flattenSections`.
 */
export interface SectionNode {
  id: string;
  label: string;
  /**
   * Omit for a group that is only a heading. Administration's `Configuration`
   * is the case: it parents four screens but isn't a destination itself, so a
   * row linking to it would be a dead target.
   */
  href?: string;
  hint?: string;
  icon?: string;
  children?: SectionNode[];
}

export interface SectionPanelProps {
  sections: SectionNode[];
  /**
   * The module's icon-slot namespace ("expense", "journal", "stock", "attendance",
   * "music", "admin"), used to derive a slot id per section via `sectionSlotId`.
   *
   * Optional: omit it and every section icon resolves exactly as it did before slots
   * existed. Supplying it is what makes a module's nav icons individually replaceable
   * from Admin > Display Settings > Icons.
   */
  iconNamespace?: string;
  /** Badged at the head of the panel and the sheet — it's what keeps the icon-only rail honest. */
  module: { name: string; icon: string };
  /** Which href is currently open, for the active state. */
  activeHref: string;
  isCompact: boolean;
  /** Desktop only. The header's `»` control is the way back, so the shell owns this. */
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The module list, for compact's bottom bar. On compact this bar owns tier 1
   * as well as tier 2 — the header has no module switcher — so without these
   * there is no way to leave the module. Desktop ignores it: the rail is tier 1
   * there.
   */
  moduleLinks?: CompactModuleLink[];
  /**
   * Which compact arrangement to draw. Desktop ignores it — both styles render
   * the identical 240px panel, which is why this is called *compact* nav style.
   */
  navStyle?: CompactNavStyle;
  className?: string;
}

/** A module the compact bar can switch to. Plain data, from the shell. */
export interface CompactModuleLink {
  slug: string;
  name: string;
  href: string;
  icon: string;
  hint?: string;
}

/**
 * Every leaf, with group headings dropped.
 *
 * Used to find the *active* section for the compact bar's label, where the group
 * a section sits in doesn't matter. The compact sheet itself keeps its headings —
 * see `CompactSectionList`.
 */
export function flattenSections(sections: SectionNode[]): SectionNode[] {
  return sections.flatMap((section) => [
    section,
    ...(section.children ? flattenSections(section.children) : []),
  ]);
}

/** A leaf row, shared by the desktop panel and the compact sheet. */
function SectionRow({
  section,
  active,
  compact,
  nested,
  onNavigate,
}: {
  section: SectionNode;
  active: boolean;
  compact: boolean;
  nested?: boolean;
  onNavigate?: () => void;
}) {
  // A heading with no destination. Rendered as a label rather than a link so it
  // isn't a dead target, and skipped entirely by the compact sheet.
  if (!section.href) {
    return (
      <div
        title={section.hint ?? section.label}
        className={`flex w-full items-center gap-2 px-2 text-left text-sm font-medium text-muted ${
          compact ? "gap-2.5 px-3 py-2.5" : "py-1.5"
        }`}
      >
        {!compact && !nested && <span className="w-3 shrink-0" aria-hidden />}
        <SectionIcon icon={section.icon} id={section.id} className="h-4 w-4 shrink-0" />
        <span className="truncate">{section.label}</span>
      </div>
    );
  }

  return (
    <Link
      href={section.href}
      title={section.hint ?? section.label}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      // `py-2.5` on compact is a ~44px touch target; the desktop panel's
      // `py-1.5` is tighter because a pointer doesn't need the slack.
      className={`flex w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
        compact ? "gap-2.5 px-3 py-2.5" : "py-1.5"
      } ${
        active
          ? `bg-brass-soft font-medium ${compact ? "shell-accent-text" : "text-brass-dark"}`
          : "text-ink hover:bg-line/60"
      }`}
    >
      {/* Lines a leaf up with the chevron column on a group row. Only on
          desktop, where groups exist at all. */}
      {!compact && !nested && <span className="w-3 shrink-0" aria-hidden />}
      <SectionIcon icon={section.icon} id={section.id} className="h-4 w-4 shrink-0" />
      <span className="truncate">{section.label}</span>
    </Link>
  );
}

/**
 * The sheet's section list: every leaf, under its group heading.
 *
 * Headings are *kept* here, unlike the flat list this replaced. Flattening was a
 * deliberate choice once — "a phone has no room for a second level" — and it was
 * wrong for the modules that need help most: Stocks has ten sections in three
 * groups, and as one undifferentiated scroll inside a 74%-tall sheet it was the
 * hardest module to navigate on the smallest screen. A heading is a 20px label,
 * not a second level of interaction: nothing becomes an extra tap, because these
 * are not accordions. The desktop panel still uses `SectionGroup` accordions,
 * where collapsing earns its keep against a 240px column.
 */
function CompactSectionList({
  sections,
  activeHref,
  onNavigate,
}: {
  sections: SectionNode[];
  activeHref: string;
  onNavigate: () => void;
}) {
  return (
    <ul className="p-2">
      {sections.map((section) => {
        const children = (section.children ?? []).filter((child) => child.href);

        // A group: its heading, then its leaves. A heading with no children left
        // renders nothing rather than an empty label.
        if (children.length > 0) {
          return (
            <li key={section.id}>
              <div className="px-3 pb-1 pt-3 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted">
                {section.label}
              </div>
              <ul>
                {children.map((child) => (
                  <li key={child.id}>
                    <SectionRow
                      section={child}
                      active={child.href === activeHref}
                      compact
                      onNavigate={onNavigate}
                    />
                  </li>
                ))}
              </ul>
            </li>
          );
        }

        // A bare heading — a group node whose children are all non-destinations.
        // Nothing to show, and a label with no rows under it reads as a bug.
        if (!section.href) return null;

        return (
          <li key={section.id}>
            <SectionRow
              section={section}
              active={section.href === activeHref}
              compact
              onNavigate={onNavigate}
            />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The sheet's module list — compact's tier 1.
 *
 * Only reachable on compact, where the 48px rail doesn't render. The active
 * module gets the same tint the rail's active link gets, minus the edge bar:
 * this is a full-width row with a label, so a tint isn't easy to miss the way it
 * is in a 48px icon column.
 */
function CompactModuleList({
  links,
  activeSlug,
  onNavigate,
}: {
  links: CompactModuleLink[];
  activeSlug?: string;
  onNavigate: () => void;
}) {
  return (
    <ul className="p-2">
      {links.map((link) => {
        const active = link.slug === activeSlug;
        return (
          <li key={link.slug}>
            <Link
              href={link.href}
              title={link.hint ?? link.name}
              aria-current={active ? "page" : undefined}
              onClick={onNavigate}
              className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
                active
                  ? "bg-brass-soft font-medium shell-accent-text"
                  : "text-ink hover:bg-line/60"
              }`}
            >
              <ModuleIcon name={link.icon} className="h-4 w-4 shrink-0" />
              <span className="truncate">{link.name}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** A group heading and its children, desktop only. */
function SectionGroup({
  section,
  activeHref,
}: {
  section: SectionNode;
  activeHref: string;
}) {
  const children = section.children ?? [];
  const containsActive = flattenSections(children).some((child) => child.href === activeHref);
  // Open if the current page is inside it — a group hiding the active section
  // would leave the panel with nothing highlighted.
  const [isOpen, setIsOpen] = useState(containsActive);
  const listId = useId();

  return (
    // The group reads as its own card. Without the box, a heading and its children
    // were distinguished only by indentation, which is the weakest signal available
    // on a panel this narrow -- Administration's Configuration group is six rows
    // that looked like six unrelated links.
    <li className="card-embossed overflow-hidden rounded-lg border border-line bg-paper-raised">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        title={section.hint ?? section.label}
        // `ring-inset`, unlike the flat rows: a focus ring on a child of a clipped
        // card is cut off by `overflow-hidden` if it sits outside the edge.
        className={`flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brass ${
          isOpen ? "border-b border-line" : ""
        } ${containsActive ? "font-medium text-brass-dark" : "text-ink hover:bg-line/40"}`}
      >
        <span
          className={`inline-block w-3 shrink-0 text-muted transition-transform motion-reduce:transition-none ${
            isOpen ? "rotate-90" : ""
          }`}
          aria-hidden
        >
          &rsaquo;
        </span>
        <SectionIcon icon={section.icon} id={section.id} className="h-4 w-4 shrink-0" />
        <span className="truncate">{section.label}</span>
      </button>
      {isOpen && (
        <ul id={listId} className="flex flex-col py-1.5 pl-4 pr-1.5">
          {children.map((child, index) => {
            const isLast = index === children.length - 1;

            return (
              <li key={child.id} className="relative pl-4">
                {/* The spine linking every child back up to the group row. Stops
                    halfway down the last one, where its elbow leaves the trunk,
                    so the line never dangles past the final item. */}
                <span
                  aria-hidden
                  className={`absolute left-0 w-px bg-line ${isLast ? "top-0 h-[1.125rem]" : "inset-y-0"}`}
                />
                {/* The elbow out to this child. */}
                <span aria-hidden className="absolute left-0 top-[1.125rem] h-px w-2.5 bg-line" />
                <SectionRow
                  section={child}
                  active={child.href === activeHref}
                  compact={false}
                  nested
                />
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

/**
 * Supplies the slot namespace, then renders the panel.
 *
 * Split from the body rather than wrapping each branch: `SectionPanelBody` returns from
 * two places (compact sheet, desktop column) and a provider added per-branch is one a
 * future branch can forget.
 */
export function SectionPanel({ iconNamespace, ...props }: SectionPanelProps) {
  return (
    <SectionNamespaceContext.Provider value={iconNamespace}>
      <SectionPanelBody {...props} />
    </SectionNamespaceContext.Provider>
  );
}

function SectionPanelBody({
  sections,
  module,
  activeHref,
  isCompact,
  isOpen,
  onOpenChange,
  moduleLinks = [],
  navStyle = "drill-in",
  className = "",
}: Omit<SectionPanelProps, "iconNamespace">) {
  const [sheetOpen, setSheetOpen] = useState(false);
  // Which tier the open sheet is showing. Both styles use one sheet and one
  // piece of state: "drill-in" moves between the two levels with a back arrow,
  // "segmented" jumps straight to the level its half of the bar names. Keeping
  // it as one value rather than two booleans makes "the sheet is showing exactly
  // one tier" true by construction.
  const [sheetTier, setSheetTier] = useState<"sections" | "modules">("sections");

  // Escape closes the sheet — the same affordance `AppChrome`'s dropdowns give,
  // and the only keyboard way out of a modal surface.
  useEffect(() => {
    if (!sheetOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSheetOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [sheetOpen]);

  // Mirrored onto <html> so globals.css can reserve the bottom edge for the
  // bar and park the music player above it. Only compact has a bar; on desktop
  // the tiers are side columns and the bottom edge is free.
  //
  // Keyed off `moduleLinks` too, not just sections: a sectionless page (home,
  // account) still draws a module-only bar, and without this its content would
  // run underneath it.
  useEffect(() => {
    const root = document.documentElement;
    if (isCompact && (sections.length > 0 || moduleLinks.length > 0)) {
      root.dataset.sectiontrigger = "bar";
    } else {
      delete root.dataset.sectiontrigger;
    }
    return () => {
      delete root.dataset.sectiontrigger;
    };
  }, [isCompact, sections.length, moduleLinks.length]);

  // A page with no sections still gets the compact bar, because on compact this
  // bar is tier *1* as well — the home and account screens belong to no module,
  // but they still need a module switcher, and putting theirs in the header while
  // every other screen's sits at the bottom is the split this shell exists to
  // remove. With no sections it renders module-only: the section half is dropped
  // and tapping it opens the module list directly.
  //
  // On the desktop the original reasoning stands unchanged — an empty tier 2
  // would be a 240px blank column, and the 48px rail is already tier 1 there.
  const sectionless = sections.length === 0;
  if (sectionless && (!isCompact || moduleLinks.length === 0)) return null;

  // Still flattened for *finding the active section* — which group a section
  // sits in doesn't matter when all we want is its label for the bar. The
  // sheet's list keeps the groups; see `CompactSectionList`.
  const flat = flattenSections(sections).filter((section) => section.href);
  const activeSection = flat.find((section) => section.href === activeHref) ?? flat[0];
  const activeModule = moduleLinks.find((link) => link.href === activeHref)
    ?? moduleLinks.find((link) => activeHref.startsWith(link.href));

  // -------------------------------------------------------------------------
  // Compact: one bar on the bottom edge carrying *both* tiers, and a sheet.
  //
  // The bar owns tier 1 as well as tier 2 — `TwoTierShell` drops the header's
  // module dropdown on compact — so all navigation lives on one edge instead of
  // the module switcher sitting at the top and the section trigger at the
  // bottom. Two arrangements of that one bar, chosen per reader in Account >
  // Preferences (`src/lib/user-preferences/nav-style.ts`):
  //
  //   drill-in   one full-width bar naming "Module › Section"; the sheet opens
  //              on sections and a back arrow steps up to the modules
  //   segmented  the bar is split, each half opening its own tier directly
  //
  // Both are the same height as the single trigger they replaced, so the bottom
  // edge is no taller than before and `--section-trigger-height` is unchanged.
  // -------------------------------------------------------------------------
  if (isCompact) {
    const showingModules = sheetTier === "modules";
    // `moduleLinks` can legitimately be empty — a shell that passes none keeps a
    // sections-only bar rather than offering a dead module control.
    const canSwitchModule = moduleLinks.length > 0;

    // Always sets the tier, so reopening the bar lands on the tier the control
    // names rather than wherever the reader drilled to last time. Without this,
    // tapping the drill-in bar after having browsed modules would reopen on the
    // module list — a bar labelled with a section that opens something else.
    function openSheet(tier: "sections" | "modules") {
      setSheetTier(tier);
      setSheetOpen(true);
    }

    const sectionLabel = activeSection?.label ?? module.name;

    // A sectionless page (home, account) has only tier 1 to offer, so both styles
    // collapse to the same thing: one full-width bar naming the page, opening the
    // module list. Rendered here rather than as a third `navStyle` because it is
    // not a preference — there is no second tier to arrange, so the choice has
    // nothing to choose between.
    if (sectionless) {
      return (
        <>
          <button
            type="button"
            onClick={() => openSheet("modules")}
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            className={`shell-trigger flex items-center gap-2 border-t border-line bg-paper-raised px-4 py-3 text-left transition-colors hover:bg-line/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${className}`}
          >
            <ModuleIdentityIcon icon={module.icon} className="h-5 w-5 shrink-0 shell-accent-text" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
              {module.name}
            </span>
            <span className="shrink-0 text-xs text-muted">Modules</span>
            <span className="shrink-0 text-[0.625rem] text-muted" aria-hidden>
              &#9650;
            </span>
          </button>
          {sheetOpen && (
            <>
              <button
                type="button"
                aria-label="Close the module list"
                onClick={() => setSheetOpen(false)}
                className="fixed inset-0 z-40 bg-black/45"
              />
              <div
                role="dialog"
                aria-label="Modules"
                className="fixed inset-x-0 bottom-0 z-40 flex max-h-[74%] flex-col rounded-t-2xl border-t border-line bg-paper-raised pb-[max(1rem,env(safe-area-inset-bottom))]"
              >
                <div className="relative flex shrink-0 items-center gap-2 border-b border-line px-4 pb-3 pt-4">
                  <span
                    className="absolute left-1/2 top-1.5 h-1 w-9 -translate-x-1/2 rounded-full bg-line"
                    aria-hidden
                  />
                  <span className="truncate font-display text-sm font-semibold text-ink">
                    Switch module
                  </span>
                  <button
                    type="button"
                    onClick={() => setSheetOpen(false)}
                    aria-label="Close the module list"
                    className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-line/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                  >
                    <span aria-hidden>&times;</span>
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <CompactModuleList
                    links={moduleLinks}
                    activeSlug={activeModule?.slug}
                    onNavigate={() => setSheetOpen(false)}
                  />
                </div>
              </div>
            </>
          )}
        </>
      );
    }

    return (
      <>
        {navStyle === "segmented" ? (
          // Split bar: each tier is one tap, at the cost of a narrower target
          // for the module half and a glyph rather than a name for the module.
          <div
            className={`shell-trigger flex items-stretch border-t border-line bg-paper-raised ${className}`}
          >
            {canSwitchModule && (
              <button
                type="button"
                onClick={() => openSheet("modules")}
                aria-haspopup="dialog"
                aria-expanded={sheetOpen && showingModules}
                // The module name is in the header breadcrumb and repeated at the
                // head of the sheet, so the glyph here is never the only thing
                // naming the module — the same bargain the desktop rail strikes.
                title={`${module.name} — switch module`}
                aria-label={`${module.name} — switch module`}
                className="flex shrink-0 items-center gap-1.5 border-r border-line px-4 transition-colors hover:bg-line/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brass"
              >
                <ModuleIdentityIcon icon={module.icon} className="h-5 w-5 shell-accent-text" />
                <span className="text-[0.625rem] text-muted" aria-hidden>
                  &#9650;
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => openSheet("sections")}
              aria-haspopup="dialog"
              aria-expanded={sheetOpen && !showingModules}
              className="flex min-w-0 flex-1 items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-line/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brass"
            >
              <SectionIcon
                icon={activeSection?.icon}
                id={activeSection?.id}
                className="h-5 w-5 shrink-0 shell-accent-text"
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                {sectionLabel}
              </span>
              <span className="shrink-0 text-[0.625rem] text-muted" aria-hidden>
                &#9650;
              </span>
            </button>
          </div>
        ) : (
          // Drill-in bar: one target spanning the width, naming both tiers in
          // words. The module name is truncation-tolerant — it gives up its
          // width to the section, which is the more specific answer to
          // "where am I?".
          <button
            type="button"
            onClick={() => openSheet("sections")}
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            className={`shell-trigger flex items-center gap-2 border-t border-line bg-paper-raised px-4 py-3 text-left transition-colors hover:bg-line/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${className}`}
          >
            <ModuleIdentityIcon icon={module.icon} className="h-5 w-5 shrink-0 shell-accent-text" />
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
              <span className="max-w-[40%] shrink truncate text-muted">{module.name}</span>
              <span className="shrink-0 text-muted" aria-hidden>
                &rsaquo;
              </span>
              <span className="min-w-0 flex-1 truncate font-medium text-ink">{sectionLabel}</span>
            </span>
            <span className="shrink-0 text-[0.625rem] text-muted" aria-hidden>
              &#9650;
            </span>
          </button>
        )}

        {sheetOpen && (
          <>
            {/* z-40 pair: above the shell's z-30 surfaces, below `Modal`'s z-50
                so a dialog opened from a section still covers this. */}
            <button
              type="button"
              aria-label="Close the navigation list"
              onClick={() => setSheetOpen(false)}
              className="fixed inset-0 z-40 bg-black/45"
            />
            <div
              role="dialog"
              aria-label={showingModules ? "Modules" : `${module.name} sections`}
              className="fixed inset-x-0 bottom-0 z-40 flex max-h-[74%] flex-col rounded-t-2xl border-t border-line bg-paper-raised pb-[max(1rem,env(safe-area-inset-bottom))]"
            >
              <div className="relative flex shrink-0 items-center gap-2 border-b border-line px-4 pb-3 pt-4">
                {/* The grab handle. Not draggable — it's the affordance that
                    says "this is a sheet", and the scrim and × both dismiss. */}
                <span
                  className="absolute left-1/2 top-1.5 h-1 w-9 -translate-x-1/2 rounded-full bg-line"
                  aria-hidden
                />

                {/* The back arrow is drill-in's way up to tier 1, and only
                    appears there: in the split bar each tier has its own half of
                    the bar, so a level to go "back" to would be a level the
                    reader never descended through. */}
                {navStyle === "drill-in" && canSwitchModule && !showingModules ? (
                  <button
                    type="button"
                    onClick={() => setSheetTier("modules")}
                    className="-ml-1.5 flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-sm font-medium shell-accent-text transition-colors hover:bg-brass-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                  >
                    <span aria-hidden>&lsaquo;</span>
                    <span>Modules</span>
                  </button>
                ) : null}

                {showingModules ? (
                  <span className="truncate font-display text-sm font-semibold text-ink">
                    Switch module
                  </span>
                ) : (
                  <>
                    <ModuleIdentityIcon
                      icon={module.icon}
                      className="h-5 w-5 shrink-0 shell-accent-text"
                    />
                    <span className="truncate font-display text-sm font-semibold text-ink">
                      {module.name}
                    </span>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => setSheetOpen(false)}
                  aria-label="Close the navigation list"
                  className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-line/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                >
                  <span aria-hidden>&times;</span>
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {showingModules ? (
                  <CompactModuleList
                    links={moduleLinks}
                    activeSlug={activeModule?.slug}
                    onNavigate={() => setSheetOpen(false)}
                  />
                ) : (
                  <CompactSectionList
                    sections={sections}
                    activeHref={activeHref}
                    onNavigate={() => setSheetOpen(false)}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </>
    );
  }

  // -------------------------------------------------------------------------
  // Full: a fixed 240px column. Closed renders nothing — `AppHeader`'s `»`
  // is the way back, so there's no edge strip to leave behind.
  // -------------------------------------------------------------------------
  if (!isOpen) return null;

  return (
    <nav
      aria-label={`${module.name} sections`}
      className={`shell-panel shell-slab-raised flex flex-col border-r border-line bg-paper-raised ${className}`}
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        {/* The module named in words. This is what makes the icon-only rail
            defensible — the glyph is never the only thing saying where you are. */}
        <ModuleIdentityIcon icon={module.icon} className="h-5 w-5 shrink-0 text-brass-dark" />
        <span className="truncate font-display text-sm font-semibold text-ink">
          {module.name}
        </span>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          title="Collapse the section panel"
          aria-label="Collapse the section panel"
          className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-line/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        >
          <span aria-hidden>&laquo;</span>
        </button>
      </div>

      {/* `gap-2.5` so the group cards read as separate objects; a bare list would
          butt their borders together into one undivided block. */}
      <ul className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-2">
        {sections.map((section) =>
          section.children?.length ? (
            <SectionGroup key={section.id} section={section} activeHref={activeHref} />
          ) : (
            <li key={section.id}>
              <SectionRow
                section={section}
                active={section.href === activeHref}
                compact={false}
              />
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}
