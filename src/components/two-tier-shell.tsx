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
import { NavPendingProvider, NavProgressBar } from "./nav-pending";
import { NavTabs } from "./nav-tabs";
import { NavTree } from "./nav-tree";
import { SectionStrip } from "./section-strip";
import { SectionPanel, type SectionNode } from "./section-panel";
import { findActiveModule, type NavigationTree, type TreeModule } from "@/lib/navigation";
import type { ResolvedNavTexture } from "@/lib/nav-texture";
import { useCompactNavStyle, useDesktopNavStyle } from "./nav-style-context";
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
  /**
   * The current module, badged in the panel and named in the breadcrumb.
   *
   * `slug` is what lets the badge show an icon uploaded under Module
   * Configuration. Optional because Administration has no row in `sys_modules`
   * — its badge goes through the `chrome_admin_identity` icon slot instead.
   */
  module: { name: string; icon: string; href: string; slug?: string };
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
   * The whole app's navigation as data. Supplied → the **full layout** renders one
   * `NavTree` column instead of the rail and the panel; omitted → the original two
   * tiers, unchanged.
   *
   * **Compact ignores this entirely.** The bottom bar keeps both tiers exactly as it
   * always has: a tree is a pointer-and-vertical-space shape, and the ~70 rows that
   * make it worth having on a monitor are what make it unusable in a 74%-tall sheet.
   * So `sections` is still required and still the compact bar's source — the tree
   * does not replace it, it replaces how the *desktop* draws it.
   */
  tree?: NavigationTree;
  /** The reader's stored expanded set, resolved server-side. Tree only. */
  expandedModules?: string[];
  /** Persists the expanded set. Tree only. */
  onExpandedChange?: (slugs: string[]) => void;
  /** Administration as a tree heading, for an admin. Tree only. */
  adminTreeModule?: TreeModule;
  /**
   * The navigation's optional background picture, resolved server-side by
   * `@/lib/nav-texture` and threaded through to whichever navigation surface
   * this shell ends up drawing -- the desktop tree or the compact bar.
   *
   * Unlike `tree` and its three companions above, this is NOT tree-only: the
   * setting is one app-wide choice, and a reader on a phone should see the
   * picture they picked. Shells pass it the same way they pass `tree`, from
   * `getNavTreeData`.
   */
  navTexture?: ResolvedNavTexture;
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
  tree,
  expandedModules = [],
  onExpandedChange,
  adminTreeModule,
  navTexture,
  children,
}: TwoTierShellProps) {
  const pathname = usePathname();
  const isCompact = useIsCompact();
  // The reader's compact bar arrangement, resolved server-side from their stored
  // preference so the first paint is already the bar they picked. Meaningless on
  // full, where both styles are the same 240px panel.
  const navStyle = useCompactNavStyle();
  // The reader's full-layout shape, resolved the same way and for the same
  // reason. **`isCompact` is folded in here deliberately**: every use below is a
  // full-layout question, and a phone must keep its bottom bar whatever is
  // stored — a 1400px *pinned-compact* window included, which is exactly why
  // this reads `useIsCompact()` rather than a `lg:` media query.
  const desktopNavStyle = useDesktopNavStyle();
  const isHorizontal = desktopNavStyle === "horizontal" && !isCompact;
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
    // `tree` on the full layout when a tree was supplied, `two-tier` otherwise.
    // Two values rather than one, because the reservations are mutually exclusive:
    // the tree *replaces* both columns, so a shell that reserved rail + panel +
    // tree would indent the content by all three.
    // Three values now: `horizontal` reserves no side column at all, so it must
    // not fall through to `tree`'s 260px padding — the page would be indented
    // past a column that isn't drawn.
    root.dataset.shell = isHorizontal ? "horizontal" : tree && !isCompact ? "tree" : "two-tier";
    root.dataset.sectionpanel =
      panelOpen && !isCompact && !tree && sections.length > 0 ? "open" : "closed";
    // The tree's own collapse, on the same `panelOpen` state the section panel
    // used — one preference, because a reader who collapsed navigation on a
    // module page means it collapsed, not "collapsed until the shape changes".
    // Not set under `horizontal`: there is no column to collapse, and leaving the
    // attribute off keeps the reader's stored collapse intact for when they
    // switch back to the tree.
    if (tree && !isCompact && !isHorizontal) root.dataset.navtree = panelOpen ? "open" : "closed";
    else delete root.dataset.navtree;
    return () => {
      delete root.dataset.shell;
      delete root.dataset.sectionpanel;
      delete root.dataset.navtree;
    };
  }, [panelOpen, isCompact, sections.length, tree, isHorizontal]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  // The breadcrumb: module, then whichever section matches the current path,
  // then anything the page adds. The module crumb links back to the module root;
  // the last crumb is the current page and never a link.
  const activeSection = sections
    .flatMap((section) => [section, ...(section.children ?? [])])
    .find((section) => section.href === pathname);

  // Which module the tab row should highlight, and whose sections the strip draws.
  // Resolved from the tree by path rather than taken from `module`, because
  // Administration has no row in `sys_modules` and would otherwise match nothing.
  // Resolved from the tree by path rather than taken from `module`, because
  // Administration has no row in `sys_modules` and so appears in no tree module.
  // Matched on its own href for the same reason — `module.slug` is undefined on
  // the admin shell, and Home (`/`) deliberately matches neither, so the strip
  // draws nothing there.
  const activeModule = tree ? findActiveModule(tree, pathname) : undefined;
  const onAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/");
  const stripModule =
    activeModule ?? (showAdmin && onAdminRoute ? adminTreeModule : undefined);

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
    { label: module.name, href: module.href, icon: module.icon, slug: module.slug },
    ...(activeSection ? [{ label: activeSection.label, href: activeSection.href }] : []),
    ...(extraCrumbs ?? []),
  ];

  return (
    // Every nav surface below links to a server-rendered route, so a click shows
    // nothing until the payload lands. The provider lets each row report that it
    // is loading and lets `NavProgressBar` draw one bar for all of them — see
    // `nav-pending.tsx`. It wraps `children` too, so the bar outlives the compact
    // sheet that closes the moment the row is tapped.
    <NavPendingProvider>
      <NavProgressBar />
      {/* Tier 1. Renders only on the full layout — on compact the same list
          lives in the bottom bar `SectionPanel` draws, on every screen including
          the sectionless ones. `showAdmin` puts the Administration gear in the
          rail's bottom zone; on compact it only reaches the user menu. */}
      {/* The tree, when one was supplied. Replaces the rail *and* the panel — it
          carries both questions in one column, which is why neither renders below
          when this does. Full layout only: the `!isCompact` guard is what keeps the
          phone on its two-tier bottom bar. */}
      {/* ...unless the reader chose the horizontal shape, which replaces the
          column with a tab row and a section strip in the content band below.
          Both are full-layout-only; `isHorizontal` already folds in `!isCompact`. */}
      {tree && !isCompact && !isHorizontal && (
        <NavTree
          tree={tree}
          activeHref={pathname}
          expandedModules={expandedModules}
          onExpandedChange={onExpandedChange}
          adminModule={showAdmin ? adminTreeModule : undefined}
          isOpen={panelOpen}
          onOpenChange={setPanelOpen}
          texture={navTexture}
        />
      )}

      {/* The horizontal shape's tier 1. Carries the utility cluster itself: this
          shape drops tier 3 on the full layout, so the bell and the profile menu
          would otherwise have nowhere to live — design.md rule 6, the same
          accounting `hideHeader` owes on the home screen. */}
      {isHorizontal && tree && (
        <NavTabs
          modules={tree.modules}
          home={tree.home}
          activeHref={pathname}
          // `stripModule`, not `module.slug`: it already resolves Administration
          // by path, and leaves Home matching no tab at all, which is correct —
          // Home is its own leading tab and highlights via `activeHref`.
          activeModuleSlug={stripModule?.slug}
          adminModule={showAdmin ? adminTreeModule : undefined}
          utility={
            <>
              {headerActions}
              <UserMenu {...userMenuProps} />
            </>
          }
          texture={navTexture}
        />
      )}

      {!tree && !isCompact && (
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

      {/* The horizontal shape's tier 2. Renders nothing for a module with no
          sections (Clips, Games, Music, CSV Analysis), rather than drawing an
          empty band — the tab row above already names where you are. */}
      {isHorizontal && stripModule && (
        <SectionStrip
          moduleSlug={stripModule.slug}
          sections={stripModule.sections}
          activeHref={pathname}
        />
      )}

      {/* Tier 2. Owns its own fork: a fixed column on full, and on compact a
          bottom bar that carries tier 1 as well — see `navStyle` below.
          With a tree, this renders on **compact only**: the tree has taken over
          the desktop column, but the bottom bar is still the whole of navigation
          on a phone and is deliberately unchanged. */}
      {(!tree || isCompact) && (
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
        // The same picture the tree draws. Compact is where this lands in
        // practice -- on desktop a shell with a `tree` renders `NavTree` instead
        // -- but it is passed unconditionally, because which of the two is on
        // screen is this component's decision and not the texture's.
        texture={navTexture}
      />
      )}

      {/* Tier 3, plus the page. Both sit in the content column, which
          `.app-main`'s padding-left has already offset past the tiers — so the
          header starts where the panel ends without re-deriving the width. */}
      {/* `isCompact ||` first, and deliberately. The module switcher has moved to
          the bottom bar, but this bar still carries the **profile menu** — and
          therefore logout — which on compact has nowhere else to go: the rail
          that holds it on the home screen's full layout doesn't render here.
          Honouring `hideHeader` on compact would leave the reader unable to log
          out. */}
      {/* `|| tree` for the same reason `isCompact ||` is there: `hideHeader` is only
          safe when some *other* surface can take the profile menu, and on the full
          layout that surface was the rail's bottom zone. The tree replaced the rail
          and deliberately has no utility zone — design.md's rule that the bottom of
          a navigation surface is for destinations, not actions — so honouring the
          flag here would leave the home screen with no way to log out. Enforced in
          the shell rather than asked of each caller, because a caller that forgot
          would produce a dead end rather than a visible bug. */}
      {/* `!isHorizontal` last, and it is the only clause that can drop the bar on
          the full layout when a `tree` is present. Safe for exactly the reason the
          comment above says the tree's case was not: `NavTabs` *does* take the
          utility cluster, so the bell and the profile menu — and therefore logout
          — are rehomed rather than lost. `isHorizontal` already folds in
          `!isCompact`, so the compact guard in front still wins on a phone. */}
      {(isCompact || ((tree || !hideHeader) && !isHorizontal)) && (
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
          // Two shapes, one control. Under the tree there is always something to
          // bring back — the tree doesn't depend on the module having sections —
          // so the `sections.length` condition applies only to the panel.
          onExpandPanel={
            !isCompact && !panelOpen && (tree || sections.length > 0)
              ? () => setPanelOpen(true)
              : undefined
          }
        />
      )}

      {children}
    </NavPendingProvider>
  );
}
