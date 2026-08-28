"use client";

// Tier 2 of the two-tier shell: which section of the current module.
//
// Two genuinely different components behind one export, picked by layout:
//
//   full     a 240px fixed column, open or closed
//   compact  a bottom trigger row naming the current section, which opens a sheet
//
// A fork rather than a restyle because 240px of side panel is most of a 390px
// phone — see design.md, "Fork a component only when restyling genuinely can't
// do it". The caller doesn't choose; `TwoTierShell` passes `isCompact` down.
//
// **Open or closed — there is no middle state.** Deliberately not `TreeNav`'s
// three-state full/rail/strip model: a 64px icon rail for *sections* sitting
// next to the 64px icon rail for *modules* is two ambiguous glyph columns side
// by side, which reads worse than either extreme.

import Link from "next/link";
import { createContext, useContext, useEffect, useId, useState } from "react";
import { getIconSlot, sectionSlotId } from "@/lib/icons";
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
   * from Admin > Configuration > Icons.
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
  className?: string;
}

/**
 * Every leaf, with group headings dropped.
 *
 * The compact sheet uses this: a phone has no room for a second level, and a
 * dropped heading costs nothing when every child is still one tap away. It's
 * what the legacy compact bar already does, for the same reason.
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
        active ? "bg-brass-soft font-medium text-brass-dark" : "text-ink hover:bg-line/60"
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
    <li>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        title={section.hint ?? section.label}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
          containsActive ? "font-medium text-brass-dark" : "text-ink hover:bg-line/60"
        }`}
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
        <ul id={listId} className="pl-4">
          {children.map((child) => (
            <li key={child.id}>
              <SectionRow
                section={child}
                active={child.href === activeHref}
                compact={false}
                nested
              />
            </li>
          ))}
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
  className = "",
}: Omit<SectionPanelProps, "iconNamespace">) {
  const [sheetOpen, setSheetOpen] = useState(false);

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
  // trigger and park the music player above it. Only compact has a trigger;
  // on desktop the tiers are side columns and the bottom edge is free.
  useEffect(() => {
    const root = document.documentElement;
    if (isCompact && sections.length > 0) {
      root.dataset.sectiontrigger = "bar";
    } else {
      delete root.dataset.sectiontrigger;
    }
    return () => {
      delete root.dataset.sectiontrigger;
    };
  }, [isCompact, sections.length]);

  // No sections means no tier 2 at all. The home screen and the account screen
  // sit outside every module, so there is nothing to list — and an empty panel
  // would be a 240px blank column on the desktop and a bottom trigger naming
  // nothing on a phone. Bailing here rather than at the call site keeps the
  // "does this page get a panel?" question answered in one place.
  if (sections.length === 0) return null;

  // Group headings are dropped, not just flattened in beside their own
  // children: `Configuration` isn't a place you can go, so in a flat list it's a
  // dead row taking a touch target from a real one. The desktop panel keeps them
  // as accordion headers, where they do work.
  const flat = flattenSections(sections).filter((section) => section.href);
  const activeSection = flat.find((section) => section.href === activeHref) ?? flat[0];

  // -------------------------------------------------------------------------
  // Compact: a trigger row on the bottom edge, and a sheet over a scrim.
  // -------------------------------------------------------------------------
  if (isCompact) {
    return (
      <>
        {/* Names the current section while closed, so the bottom edge still
            answers "where am I?" — the job the legacy chip row did by keeping
            the active chip labelled. */}
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          className={`shell-trigger flex items-center gap-2 border-t border-line bg-paper-raised px-4 pt-3 pb-3 text-left transition-colors hover:bg-line/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${className}`}
        >
          <SectionIcon icon={activeSection?.icon} id={activeSection?.id} className="h-5 w-5 shrink-0 text-brass-dark" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
            {activeSection?.label ?? module.name}
          </span>
          <span className="shrink-0 text-xs text-muted">Sections</span>
          <span className="shrink-0 -rotate-90 text-muted" aria-hidden>
            &rsaquo;
          </span>
        </button>

        {sheetOpen && (
          <>
            {/* z-40 pair: above the shell's z-30 surfaces, below `Modal`'s z-50
                so a dialog opened from a section still covers this. */}
            <button
              type="button"
              aria-label="Close the section list"
              onClick={() => setSheetOpen(false)}
              className="fixed inset-0 z-40 bg-black/45"
            />
            <div
              role="dialog"
              aria-label={`${module.name} sections`}
              className="fixed inset-x-0 bottom-0 z-40 max-h-[70%] overflow-y-auto rounded-t-2xl border-t border-line bg-paper-raised pb-[max(1rem,env(safe-area-inset-bottom))]"
            >
              <div className="sticky top-0 flex items-center gap-2 border-b border-line bg-paper-raised px-4 py-3">
                {/* The grab handle. Not draggable — it's the affordance that
                    says "this is a sheet", and the scrim and × both dismiss. */}
                <span
                  className="absolute left-1/2 top-1.5 h-1 w-9 -translate-x-1/2 rounded-full bg-line"
                  aria-hidden
                />
                <ModuleIdentityIcon icon={module.icon} className="h-5 w-5 shrink-0 text-brass-dark" />
                <span className="truncate font-display text-sm font-semibold text-ink">
                  {module.name}
                </span>
                <button
                  type="button"
                  onClick={() => setSheetOpen(false)}
                  aria-label="Close the section list"
                  className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-line/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                >
                  <span aria-hidden>&times;</span>
                </button>
              </div>
              <ul className="p-2">
                {/* Flattened: group headings are dropped rather than nested. */}
                {flat.map((section) => (
                  <li key={section.id}>
                    <SectionRow
                      section={section}
                      active={section.href === activeHref}
                      compact
                      onNavigate={() => setSheetOpen(false)}
                    />
                  </li>
                ))}
              </ul>
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
      className={`shell-panel flex flex-col border-r border-line bg-paper-raised ${className}`}
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

      <ul className="min-h-0 flex-1 overflow-y-auto p-2">
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
