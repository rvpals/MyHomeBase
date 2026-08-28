"use client";

// The two-tier navigation shell: module rail, section panel, utility header.
//
// The navigation shell for every module and for Administration — see design.md,
// "Navigation: the two-tier shell".
//
// A module shell hands this `links`, `sections` and `module` and gets the three
// tiers placed for it. It does **not** position them itself: the widths are
// published in globals.css and `.app-main`'s padding is derived from them, so a
// caller placing a tier by hand would be the fourth thing that has to agree on
// 64px and the first one to drift.
//
// **The compact fork is a different component, not a restyle.** A 64px rail plus
// a 240px panel is 304px of chrome on a 390px phone, so down there the rail
// becomes a dropdown in the header and the panel becomes a bottom sheet. That's
// why this reads `useIsCompact()` rather than `max-lg:` — and because the layout
// can be *pinned*, so a 1400px window can legitimately be compact and a media
// query would still lay it out side by side.

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ModuleMenu, UserMenu, type NavLink } from "./nav-menus";
import { AppHeader, type Breadcrumb } from "./app-header";
import { ModuleRail } from "./module-rail";
import { SectionPanel, type SectionNode } from "./section-panel";
import { useIsCompact } from "./viewport-context";

const PANEL_KEY = "myhomebase:section-panel";

export interface TwoTierShellProps {
  /** Every module the reader can reach — tier 1. */
  links: NavLink[];
  /**
   * The current module's sections — tier 2. Empty means no panel at all: the
   * home and account screens are inside the shell for the rail and the header,
   * but belong to no module and so have nothing to list.
   */
  sections: SectionNode[];
  /**
   * The module's icon-slot namespace, passed through to `SectionPanel` so each section
   * icon can be replaced individually from Admin > Configuration > Icons. Omit it and
   * the icons resolve exactly as they did before slots existed.
   */
  iconNamespace?: string;
  /** The current module, badged in the panel and named in the breadcrumb. */
  module: { name: string; icon: string; href: string };
  currentUser: { id: number; fullName: string; avatarMimeType?: string; updatedAt?: string };
  showAdmin: boolean;
  logoutAction: () => Promise<void>;
  viewportPinned: boolean;
  /**
   * Appended after `[Module] › [Section]` — a record's own name, say. Optional
   * and unused by most screens; the two-level path is the normal case.
   */
  extraCrumbs?: Breadcrumb[];
  /** Whole-app actions for the header. Page actions belong on the page. */
  headerActions?: ReactNode;
  children: ReactNode;
}

export function TwoTierShell({
  links,
  sections,
  iconNamespace,
  module,
  currentUser,
  showAdmin,
  logoutAction,
  viewportPinned,
  extraCrumbs,
  headerActions,
  children,
}: TwoTierShellProps) {
  const pathname = usePathname();
  const isCompact = useIsCompact();
  const [panelOpen, setPanelOpen] = useState(true);

  useEffect(() => {
    // Syncing from an external system (localStorage) on mount, not reacting to
    // React state.
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setPanelOpen(window.localStorage.getItem(PANEL_KEY) !== "closed");
  }, []);

  useEffect(() => {
    window.localStorage.setItem(PANEL_KEY, panelOpen ? "open" : "closed");
  }, [panelOpen]);

  // Mirrored onto <html> so globals.css can pad `.app-main` for whichever tiers
  // are showing. `.app-main` belongs to a server layout that cannot see this
  // state, so the attribute is the seam.
  //
  // `data-shell` scopes the padding rule to pages that actually have the tiers —
  // the home grid and the account screen render outside any shell.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.shell = "two-tier";
    root.dataset.sectionpanel =
      panelOpen && !isCompact && sections.length > 0 ? "open" : "closed";
    return () => {
      delete root.dataset.shell;
      delete root.dataset.sectionpanel;
    };
  }, [panelOpen, isCompact, sections.length]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  // The breadcrumb: module, then whichever section matches the current path,
  // then anything the page adds. The module crumb links back to the module root;
  // the last crumb is the current page and never a link.
  const activeSection = sections
    .flatMap((section) => [section, ...(section.children ?? [])])
    .find((section) => section.href === pathname);

  const crumbs: Breadcrumb[] = [
    { label: module.name, href: module.href, icon: module.icon },
    ...(activeSection ? [{ label: activeSection.label, href: activeSection.href }] : []),
    ...(extraCrumbs ?? []),
  ];

  return (
    <>
      {/* Tier 1. Renders only on the full layout — on compact the same list is
          the header's dropdown, below. */}
      {!isCompact && <ModuleRail links={links} isActive={isActive} />}

      {/* Tier 2. Owns its own fork: a fixed column on full, a bottom trigger
          and sheet on compact. */}
      <SectionPanel
        sections={sections}
        iconNamespace={iconNamespace}
        module={module}
        activeHref={pathname}
        isCompact={isCompact}
        isOpen={panelOpen}
        onOpenChange={setPanelOpen}
      />

      {/* Tier 3, plus the page. Both sit in the content column, which
          `.app-main`'s padding-left has already offset past the tiers — so the
          header starts where the panel ends without re-deriving the width. */}
      <AppHeader
        crumbs={crumbs}
        moduleSwitcher={isCompact ? <ModuleMenu links={links} isActive={isActive} /> : undefined}
        actions={headerActions}
        profile={
          <UserMenu
            currentUser={currentUser}
            showAdmin={showAdmin}
            logoutAction={logoutAction}
            viewportPinned={viewportPinned}
            isAdminRoute={pathname.startsWith("/admin")}
          />
        }
        // Only when there's something to bring back: compact has the bottom
        // trigger instead, and an open panel has its own `«`.
        // An empty `sections` means there is no tier 2 to bring back — the
        // home and account screens sit outside every module.
        onExpandPanel={
          !isCompact && !panelOpen && sections.length > 0 ? () => setPanelOpen(true) : undefined
        }
      />

      {children}
    </>
  );
}
