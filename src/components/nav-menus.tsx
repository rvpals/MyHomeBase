"use client";

// The two dropdown menus the app's navigation shares: the module switcher and
// the user menu.
//
// This file was `AppChrome`, a top bar that rendered on every page. That bar is
// gone — navigation is the two-tier shell now (`TwoTierShell`: a module rail, a
// section panel and a utility header). What survived is the two menus, because
// both are still needed and neither belongs to a single tier:
//
//   ModuleMenu  the compact layout's module switcher, folded into `AppHeader`
//   UserMenu    the profile menu, in the header at every layout
//
// Kept here rather than split into two files because they share `useDropdown`
// and the `menuItem`/`menuPanel` classes, which is what makes them read as one
// pattern rather than two dropdowns that happen to sit in the same bar.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "./avatar";
import { ModuleIcon } from "./module-icons";
import { SlotIcon } from "./slot-icon";
import { ViewportSwitch } from "./viewport-switch";
import { getIconSlot } from "@/lib/icons";

// Resolved once at module scope; the registry is static, so this is not I/O. These three
// replace hand-rolled inline SVGs — the glyphs now come from the reader's icon set, and
// each can be overridden individually.
const MODULES_SLOT = getIconSlot("chrome_menu_modules_trigger")!;
const ACCOUNT_SLOT = getIconSlot("chrome_menu_account")!;
const ADMINISTRATION_SLOT = getIconSlot("chrome_menu_administration")!;

export interface NavLink {
  slug: string;
  name: string;
  href: string;
  icon: string;
  hint?: string;
}

const iconButton =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-brass-soft hover:text-brass-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

// Shared by every item in a dropdown opened from this bar, so the module menu
// and the user menu read as one pattern.
const menuItem =
  "flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";
const menuItemIdle = "text-ink hover:bg-line/60";
const menuItemActive = "bg-brass-soft font-medium text-brass-dark";
// z-30: under this bar's own z-40, over ordinary content.
const menuPanel =
  "absolute top-full z-30 mt-1 rounded-lg border border-line bg-paper-raised p-1 shadow-lg";

/**
 * Open/closed state for a dropdown in this bar, closed by an outside click or
 * Escape. Both menus here need exactly this and nothing more; `TreeNav`'s
 * `GroupChip` hand-rolls its own copy, which is left alone rather than dragged
 * into a shared component for two callers.
 */
function useDropdown() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return { containerRef, isOpen, setIsOpen };
}

/**
 * Compact's stand-in for the inline module list: one button that opens the
 * same links as a dropdown. There's no room to lay them out inline down here,
 * and the old alternative — a second bar pinned to the bottom — would have had
 * to fight the current module's own section bar (`TreeNav`) for the same edge.
 */
// Exported for `TwoTierShell`, which folds the module switcher into its header
// on compact — same list, same dropdown behaviour.
export function ModuleMenu({ links, isActive }: { links: NavLink[]; isActive: (href: string) => boolean }) {
  const { containerRef, isOpen, setIsOpen } = useDropdown();

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        title="Modules"
        aria-label="Modules"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={iconButton}
      >
        <SlotIcon slot={MODULES_SLOT} className="h-4 w-4" />
      </button>
      {isOpen && (
        <div role="menu" aria-label="Modules" className={`${menuPanel} left-0 min-w-48`}>
          {links.map((link) => (
            <Link
              key={link.slug}
              href={link.href}
              role="menuitem"
              title={link.hint ?? link.name}
              onClick={() => setIsOpen(false)}
              className={`${menuItem} ${isActive(link.href) ? menuItemActive : menuItemIdle}`}
            >
              <ModuleIcon name={link.icon} className="h-4 w-4 shrink-0" />
              {link.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Everything about *this reader* behind one target: the account link, the
 * layout switch, Administration and Log out.
 *
 * These were four separate controls in the bar. Grouping them frees the row —
 * which compact needs most, since the module menu and the app title compete for
 * the same 390px — and puts the two destructive-ish or global actions (log out,
 * change the whole UI's layout) behind a deliberate second click rather than
 * one stray tap. The avatar is the trigger, so `/account` moves inside as the
 * first item.
 */
// Exported so `TwoTierShell`'s header can reuse it rather than growing a second
// copy: it carries the account link, the layout switch, Administration and log
// out, and two implementations of that list would drift.
export function UserMenu({
  currentUser,
  showAdmin,
  logoutAction,
  viewportPinned,
  isAdminRoute,
}: {
  currentUser: { id: number; fullName: string; avatarMimeType?: string; updatedAt?: string };
  showAdmin: boolean;
  logoutAction: () => Promise<void>;
  viewportPinned: boolean;
  isAdminRoute: boolean;
}) {
  const { containerRef, isOpen, setIsOpen } = useDropdown();
  const close = () => setIsOpen(false);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        title={currentUser.fullName}
        aria-label={`${currentUser.fullName} — account menu`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={`${iconButton} ${isOpen ? "bg-brass-soft text-brass-dark" : ""}`}
      >
        <Avatar
          userId={currentUser.id}
          avatarMimeType={currentUser.avatarMimeType}
          fallbackText={currentUser.fullName}
          version={currentUser.updatedAt}
          size="sm"
        />
      </button>
      {isOpen && (
        // Right-aligned: this is the last thing in the bar, so a left-aligned
        // panel would hang off the screen edge on compact.
        <div role="menu" aria-label="Account" className={`${menuPanel} right-0 min-w-56`}>
          <p className="truncate px-2.5 py-1.5 text-xs font-medium uppercase tracking-wide text-muted">
            {currentUser.fullName}
          </p>
          <div className="my-1 h-px bg-line" />
          <Link
            href="/account"
            role="menuitem"
            onClick={close}
            className={`${menuItem} ${menuItemIdle}`}
          >
            <SlotIcon slot={ACCOUNT_SLOT} className="h-4 w-4 shrink-0" />
            My account
          </Link>
          <ViewportSwitch pinned={viewportPinned} variant="menu-item" onToggled={close} />
          {showAdmin && (
            <Link
              href="/admin"
              role="menuitem"
              onClick={close}
              className={`${menuItem} ${isAdminRoute ? menuItemActive : menuItemIdle}`}
            >
              <SlotIcon slot={ADMINISTRATION_SLOT} className="h-4 w-4 shrink-0" />
              Administration
            </Link>
          )}
          <div className="my-1 h-px bg-line" />
          <form action={logoutAction}>
            <button type="submit" role="menuitem" className={`${menuItem} ${menuItemIdle}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0" aria-hidden>
                <path d="M15 17l5-5-5-5M20 12H9M12 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6" />
              </svg>
              Log out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
