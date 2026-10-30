"use client";

// Tier 1 of the horizontal shell: which module you're in, as a tab row.
//
// The full layout's `horizontal` navigation shape (design.md, "The full layout's
// two shapes"). Replaces the 260px tree column with one band across the top, so
// the page gets the whole window width. Home is the leading tab; the modules
// follow in registry order; the bell and avatar sit at the trailing edge.
//
// **Full layout only.** Compact never renders this — the bottom bar already owns
// the module list there, and a second module switcher at the opposite edge is the
// split the two-tier shell exists to remove. `TwoTierShell` decides.
//
// **The row measures itself.** Twelve modules do not fit one row at any realistic
// width, and how many do depends on the window *and* on how long the module names
// are — both of which an admin can change. So rather than a fixed count, the row
// measures its tabs once, derives an average tab width, and recomputes capacity on
// every resize. `splitTabs` in `src/lib/navigation` makes the actual decision; this
// component only supplies the measurement, which is what keeps the rule testable.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getIconSlot } from "@/lib/icons";
import { splitTabs, type TreeModule, type TreeSection } from "@/lib/navigation";
import { navTextureVars, type ResolvedNavTexture } from "@/lib/nav-texture";
import { ModuleIcon } from "./module-icons";
import { NavLinkRow, NavRowPending } from "./nav-pending";
import { SlotIcon } from "./slot-icon";
import type { CSSProperties, ReactNode } from "react";

// The same slot the tree's Home row draws, on purpose: the tree and this tab row
// are two shapes of one navigation, so a reader who has replaced Home's mark sees
// it in both. Going through the slot is also what keeps this tab from drawing
// nothing — `home.icon` is `"home"`, which is a MODULE icon name and not a tree
// concept, so a bare `<TreeIcon name="home">` here rendered an empty 16px box.
const HOME_SLOT = getIconSlot("chrome_tree_home")!;

/** Width reserved for Home, "More", and the utility cluster before tabs are placed. */
const CHROME_RESERVE_PX = 190;
/** Fallback tab width before the first measurement lands. */
const ASSUMED_TAB_WIDTH_PX = 132;

function TabLink({
  href,
  label,
  icon,
  slug,
  active,
  title,
  children,
}: {
  href: string;
  label?: string;
  icon?: string;
  slug?: string;
  active: boolean;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <NavLinkRow
      href={href}
      title={title ?? label}
      active={active}
      // Same reason as `SectionStrip`'s chips: the anchor is `block w-full` by
      // default, which would stack the tabs instead of laying them in a row.
      wrapperClassName="!w-auto shrink-0"
      className={`flex h-full items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
        active
          ? "border-brass bg-brass-soft font-medium text-brass-dark"
          : "border-transparent text-muted hover:text-ink"
      }`}
    >
      <NavRowPending id={href} className="h-4 w-4 shrink-0">
        {children ?? <ModuleIcon slug={slug} name={icon ?? "grid"} className="h-4 w-4 shrink-0" />}
      </NavRowPending>
      {label && <span className="truncate">{label}</span>}
    </NavLinkRow>
  );
}

export interface NavTabsProps {
  /** Every module the reader can reach, in registry order. */
  modules: TreeModule[];
  /** The Home leaf, drawn as the leading tab. */
  home: TreeSection;
  /** The current path, for the active tab. */
  activeHref: string;
  /** The active module's slug, so it is never hidden in the overflow menu. */
  activeModuleSlug?: string;
  /** Administration, when the reader is an admin. Drawn after the modules. */
  adminModule?: TreeModule;
  /** The bell and the profile menu, at the trailing edge. */
  utility?: ReactNode;
  /** The navigation's optional background picture. */
  texture?: ResolvedNavTexture;
}

export function NavTabs({
  modules,
  home,
  activeHref,
  activeModuleSlug,
  adminModule,
  utility,
  texture,
}: NavTabsProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const tabWidthRef = useRef(ASSUMED_TAB_WIDTH_PX);
  const [capacity, setCapacity] = useState(modules.length);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const tabbable = adminModule ? [...modules, adminModule] : modules;

  const measure = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    // Measure a real tab when one is on screen, so a theme or font change is
    // picked up rather than baked in at build time.
    const sample = row.querySelector<HTMLElement>("[data-nav-tab]");
    if (sample && sample.offsetWidth > 0) tabWidthRef.current = sample.offsetWidth;
    const usable = row.clientWidth - CHROME_RESERVE_PX;
    setCapacity(Math.max(1, Math.floor(usable / tabWidthRef.current)));
  }, []);

  // `useLayoutEffect` for the first pass so the row never paints at full width
  // and then visibly collapses into its menu on the next frame.
  useLayoutEffect(measure, [measure, tabbable.length]);

  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  // Navigating closes the menu — it would otherwise still be open behind the
  // new route's first paint.
  useEffect(() => setMenuOpen(false), [activeHref]);

  const { visible, overflow } = splitTabs(tabbable, capacity, activeModuleSlug);

  return (
    <nav
      aria-label="Modules"
      ref={rowRef}
      // `chrome-bar` carries the admin's bevel and border width, exactly as it
      // does for `AppHeader`. Geometry here, decoration there.
      //
      // **Not `sticky` itself.** The tab row and the section strip dock together
      // as one block, so the stickiness lives on the wrapper `TwoTierShell` puts
      // around both (`.shell-topnav`) — see design.md, "The full layout's two
      // shapes". Sticking this row on its own is what let the strip scroll out
      // from under it, leaving the current section unnamed on screen.
      className="chrome-bar flex items-stretch gap-0.5 border-line bg-paper-raised px-2"
      // Guarded exactly as `NavTree` guards it: `navTextureVars` takes a resolved
      // texture, not an optional one, so an unset picture means no vars at all.
      style={texture ? (navTextureVars(texture) as CSSProperties) : undefined}
    >
      {/* No `icon`/`slug`: the slot below is the only source of Home's mark, and
          passing them as well would read as a fallback `TabLink` never reaches. */}
      <TabLink href={home.href} title={home.label} active={activeHref === home.href}>
        <SlotIcon slot={HOME_SLOT} className="h-4 w-4 shrink-0" />
      </TabLink>

      {visible.map((module) => (
        // `flex` rather than a bare span: an inline wrapper would not stretch to
        // the row's height and `offsetWidth` would measure the text run rather
        // than the tab, which is the number `measure` divides by.
        <span key={module.slug} data-nav-tab className="flex shrink-0">
          <TabLink
            href={module.href}
            label={module.name}
            title={module.hint ?? module.name}
            slug={module.slug}
            icon={module.icon}
            active={module.slug === activeModuleSlug}
          />
        </span>
      ))}

      {overflow.length > 0 && (
        <div ref={menuRef} className="relative flex shrink-0 items-stretch">
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className="flex items-center gap-1 border-b-2 border-transparent px-3 py-2 text-sm text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          >
            <span>More</span>
            <span aria-hidden className="text-[0.65rem] opacity-70">
              &#9662;
            </span>
          </button>

          {menuOpen && (
            // `z-30`: inside the shell's band, below `Modal`'s `z-50`.
            <div
              role="menu"
              className="absolute right-0 top-full z-30 min-w-[13rem] rounded-lg border border-line bg-paper-raised p-1 shadow-lg"
            >
              {overflow.map((module) => (
                <NavLinkRow
                  key={module.slug}
                  href={module.href}
                  title={module.hint ?? module.name}
                  active={module.slug === activeModuleSlug}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                    module.slug === activeModuleSlug
                      ? "bg-brass-soft font-medium text-brass-dark"
                      : "text-ink hover:bg-line/60"
                  }`}
                >
                  <NavRowPending id={module.href} className="h-4 w-4 shrink-0">
                    <ModuleIcon
                      slug={module.slug}
                      name={module.icon}
                      className="h-4 w-4 shrink-0"
                    />
                  </NavRowPending>
                  <span className="truncate">{module.name}</span>
                </NavLinkRow>
              ))}
            </div>
          )}
        </div>
      )}

      {utility && <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">{utility}</div>}
    </nav>
  );
}
