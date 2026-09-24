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
// the rail width and the first one to drift.
//
// **The compact fork is a different component, not a restyle.** A 48px rail plus
// a 240px panel is 304px of chrome on a 390px phone, so down there both tiers
// collapse into a single bottom bar — the module list and the section list, one
// edge, in whichever arrangement the reader chose (see `useCompactNavStyle`).
// The header keeps a module dropdown only on a page that has no sections at all,
// where no bottom bar renders. That is why this reads `useIsCompact()` rather
// than `max-lg:` — and because the layout can be *pinned*, so a 1400px window
// can legitimately be compact and a media query would still lay it out side by
// side.

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ModuleMenu, UserMenu, type NavLink } from "./nav-menus";
import { AppHeader, type Breadcrumb } from "./app-header";
import { ModuleRail } from "./module-rail";
import { SectionPanel, type SectionNode } from "./section-panel";
import { useCompactNavStyle } from "./nav-style-context";
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
   * icon can be replaced individually from Admin > Display Settings > Icons. Omit it and
   * the icons resolve exactly as they did before slots existed.
   */
  iconNamespace?: string;
  /** The current module, badged in the panel and named in the breadcrumb. */
  module: { name: string; icon: string; href: string };
  currentUser: { id: number; fullName: string; avatarMimeType?: string; updatedAt?: string };
  /**
   * Administrator? Shows the Administration gear in the rail's bottom zone and
   * the Administration row in the user menu. One flag for both, so the two can
   * never disagree about who is allowed there.
   */
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
  /**
   * Drops tier 3 on the **full layout only** — the home screen, whose breadcrumb
   * reads just "Home" and whose bar is therefore an empty rule above the content.
   *
   * Never honoured on compact, and that is load-bearing rather than cautious:
   * the screens that set this are the ones with no sections, so on compact there
   * is no bottom bar either — this header is carrying both `ModuleMenu` and the
   * profile, and obeying the flag would leave the screen with no way out at all,
   * the dead end design.md warns about. A screen that sets this must give the
   * profile menu somewhere else to live on full; `HomeShell` puts it in the rail.
   */
  hideHeader?: boolean;
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
  hideHeader = false,
  children,
}: TwoTierShellProps) {
  const pathname = usePathname();
  const isCompact = useIsCompact();
  // The reader's compact bar arrangement, resolved server-side from their stored
  // preference so the first paint is already the bar they picked. Meaningless on
  // full, where both styles are the same 240px panel.
  const navStyle = useCompactNavStyle();
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

  // Shared by the two places the menu can render — the header and, on the home
  // screen's full layout, the rail. One object so the two can never disagree
  // about who may see Administration.
  const userMenuProps = {
    currentUser,
    showAdmin,
    logoutAction,
    viewportPinned,
    isAdminRoute: pathname.startsWith("/admin"),
  };

  const crumbs: Breadcrumb[] = [
    { label: module.name, href: module.href, icon: module.icon },
    ...(activeSection ? [{ label: activeSection.label, href: activeSection.href }] : []),
    ...(extraCrumbs ?? []),
  ];

  return (
    <>
      {/* Tier 1. Renders only on the full layout — on compact the same list
          lives in the bottom bar `SectionPanel` draws, on every screen including
          the sectionless ones. `showAdmin` puts the Administration gear in the
          rail's bottom zone; on compact it only reaches the user menu. */}
      {!isCompact && (
        <ModuleRail
          links={links}
          isActive={isActive}
          showAdmin={showAdmin}
          // Only when tier 3 is gone: otherwise the avatar would appear twice.
          profile={hideHeader ? <UserMenu {...userMenuProps} placement="rail" /> : undefined}
          // Same condition, same reason. `hideHeader` drops the bar these
          // normally live on, and design.md rule 6 says a screen that hides a
          // surface rehomes what was on it — losing the unread badge on the home
          // screen would hide it exactly where a reader starts.
          utility={hideHeader ? headerActions : undefined}
        />
      )}

      {/* Tier 2. Owns its own fork: a fixed column on full, and on compact a
          bottom bar that carries tier 1 as well — see `navStyle` below. */}
      <SectionPanel
        sections={sections}
        iconNamespace={iconNamespace}
        module={module}
        activeHref={pathname}
        isCompact={isCompact}
        isOpen={panelOpen}
        onOpenChange={setPanelOpen}
        // Tier 1, for compact's bottom bar to switch between. Passed at every
        // layout; the desktop panel ignores it, because there the rail is tier 1.
        moduleLinks={links}
        navStyle={navStyle}
      />

      {/* Tier 3, plus the page. Both sit in the content column, which
          `.app-main`'s padding-left has already offset past the tiers — so the
          header starts where the panel ends without re-deriving the width. */}
      {/* `isCompact ||` first, and deliberately. The module switcher has moved to
          the bottom bar, but this bar still carries the **profile menu** — and
          therefore logout — which on compact has nowhere else to go: the rail
          that holds it on the home screen's full layout doesn't render here.
          Honouring `hideHeader` on compact would leave the reader unable to log
          out. */}
      {(isCompact || !hideHeader) && (
        <AppHeader
          crumbs={crumbs}
          // Never on compact: the bottom bar owns the module list on *every*
          // screen, including the sectionless ones (home, account), where it
          // renders module-only. A switcher up here would be a second way to do
          // the same thing at the opposite edge — the split this shell exists to
          // remove.
          //
          // The one case that still needs it is a compact page with no sections
          // AND no modules to offer — a reader granted access to nothing. Keyed
          // off `links.length` rather than a flag so it can't drift from what
          // `SectionPanel` actually decided to draw.
          moduleSwitcher={
            isCompact && sections.length === 0 && links.length === 0 ? (
              <ModuleMenu links={links} isActive={isActive} />
            ) : undefined
          }
          actions={headerActions}
          profile={<UserMenu {...userMenuProps} />}
          // Only when there's something to bring back: compact has the bottom
          // trigger instead, and an open panel has its own `«`.
          // An empty `sections` means there is no tier 2 to bring back — the
          // home and account screens sit outside every module.
          onExpandPanel={
            !isCompact && !panelOpen && sections.length > 0 ? () => setPanelOpen(true) : undefined
          }
        />
      )}

      {children}
    </>
  );
}
