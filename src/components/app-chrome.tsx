"use client";

// The app's navigation shell: a top bar always, plus a bottom module bar on the
// compact layout.
//
// Replaced the left `Sidebar`. A 240px slab down the side is a desktop pattern
// that cost a phone 62% of its screen and, being `fixed` above the content,
// swallowed taps meant for the page underneath. Moving navigation to the edges
// gives every layout the full width.
//
// **Where the modules live is the one thing that differs by layout.** On `full`
// they sit in the top bar, next to everything else. On `compact` there isn't
// room, so they move to a bottom bar — icons only, and within thumb reach rather
// than up in the corner that is hardest to hit one-handed.
//
// Both bars minimise to a small floating puck (top-left, bottom-right). The
// state is persisted, and mirrored onto `<html>` so `globals.css` can set the
// page's padding — `(protected)/layout.tsx` is a server component and can't read
// client state, the same seam the old sidebar worked around.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminIcon } from "./admin-icon";
import { AppIcon } from "./app-icon";
import { Avatar } from "./avatar";
import { ModuleIcon } from "./module-icons";
import { useIsCompact } from "./viewport-context";
import { ViewportSwitch } from "./viewport-switch";

export interface AppChromeLink {
  slug: string;
  name: string;
  href: string;
  code: string;
  icon: string;
  hint?: string;
}

export interface AppChromeProps {
  links: AppChromeLink[];
  appName: string;
  currentUser: { id: number; fullName: string; avatarMimeType?: string; updatedAt?: string };
  showAdmin: boolean;
  logoutAction: () => Promise<void>;
  /** Whether the reader pinned the layout by hand — shown by the view switch. */
  viewportPinned: boolean;
  className?: string;
}

// Duplicated in the pre-paint script in src/app/layout.tsx: that file is a
// server component, and importing a constant from this "use client" module
// there yields an undefined client-reference proxy rather than the string, with
// nothing to catch it at build time. Keep the two in step.
const BAR_KEY = "myhomebase:appbar";
const TABS_KEY = "myhomebase:moduletabs";

const iconButton =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-brass-soft hover:text-brass-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/** The small round target a minimised bar leaves behind. */
function Puck({
  onClick,
  label,
  position,
  children,
}: {
  onClick: () => void;
  label: string;
  position: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`fixed ${position} z-40 flex h-11 w-11 items-center justify-center rounded-full border border-line bg-paper-raised text-brass-dark shadow-[0_6px_18px_-6px_rgba(0,0,0,0.45)] transition-colors hover:bg-brass-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass`}
    >
      {children}
    </button>
  );
}

export function AppChrome({
  links,
  appName,
  currentUser,
  showAdmin,
  logoutAction,
  viewportPinned,
  className = "",
}: AppChromeProps) {
  const pathname = usePathname();
  const isCompact = useIsCompact();
  const [barOpen, setBarOpen] = useState(true);
  const [tabsOpen, setTabsOpen] = useState(true);

  useEffect(() => {
    // Syncing from an external system (localStorage) on mount, not reacting to
    // React state. Both are set unconditionally so the linter sees one
    // setState per call rather than a conditional pair.
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setBarOpen(window.localStorage.getItem(BAR_KEY) !== "min");
    setTabsOpen(window.localStorage.getItem(TABS_KEY) !== "min");
  }, []);

  // Mirrored onto <html> so globals.css can pad `.app-main`. The page shell is a
  // server component, so this is the only way it can react to client state.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.appbar = barOpen ? "open" : "min";
    root.dataset.moduletabs = tabsOpen ? "open" : "min";
    window.localStorage.setItem(BAR_KEY, barOpen ? "open" : "min");
    window.localStorage.setItem(TABS_KEY, tabsOpen ? "open" : "min");
  }, [barOpen, tabsOpen]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className={className}>
      {barOpen ? (
        <header className="app-bar fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-2 border-b border-line bg-paper-raised px-3 shadow-[0_2px_10px_-6px_rgba(0,0,0,0.45)]">
          <Link
            href="/"
            title="Home"
            className="flex shrink-0 items-center gap-2 rounded-lg px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          >
            <AppIcon className="h-7 w-7 shrink-0" />
            <span className="truncate font-display text-sm font-semibold text-ink max-lg:hidden">
              {appName}
            </span>
          </Link>

          {/* Modules live here on the full layout. On compact they're the bottom
              bar instead — there is no room for them beside everything else. */}
          {!isCompact && (
            <nav aria-label="Modules" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
              {links.map((link) => (
                <Link
                  key={link.slug}
                  href={link.href}
                  title={link.hint ?? link.name}
                  className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
                    isActive(link.href)
                      ? "bg-brass-soft text-brass-dark"
                      : "text-ink hover:bg-line/60"
                  }`}
                >
                  <ModuleIcon name={link.icon} className="h-4 w-4 shrink-0" />
                  {link.name}
                </Link>
              ))}
            </nav>
          )}

          <div className={`flex shrink-0 items-center gap-1 ${isCompact ? "ml-auto" : ""}`}>
            <ViewportSwitch pinned={viewportPinned} />
            {showAdmin && (
              <Link
                href="/admin"
                title="Administration"
                aria-label="Administration"
                className={`${iconButton} ${pathname.startsWith("/admin") ? "bg-brass-soft text-brass-dark" : ""}`}
              >
                <AdminIcon className="h-4 w-4" />
              </Link>
            )}
            <Link href="/account" title="My account" aria-label="My account" className={iconButton}>
              <Avatar
                userId={currentUser.id}
                avatarMimeType={currentUser.avatarMimeType}
                fallbackText={currentUser.fullName}
                version={currentUser.updatedAt}
                size="sm"
              />
            </Link>
            <form action={logoutAction}>
              <button type="submit" title="Log out" aria-label="Log out" className={iconButton}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                  aria-hidden
                >
                  <path d="M15 17l5-5-5-5M20 12H9M12 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6" />
                </svg>
              </button>
            </form>
            <button
              type="button"
              onClick={() => setBarOpen(false)}
              title="Hide the toolbar"
              aria-label="Hide the toolbar"
              className={iconButton}
            >
              <span aria-hidden>&minus;</span>
            </button>
          </div>
        </header>
      ) : (
        <Puck onClick={() => setBarOpen(true)} label="Show the toolbar" position="left-3 top-3">
          <AppIcon className="h-5 w-5" />
        </Puck>
      )}

      {/* Compact only: the modules, icons alone, within thumb reach. */}
      {isCompact &&
        (tabsOpen ? (
          <nav
            aria-label="Modules"
            className="app-tabs fixed inset-x-0 bottom-0 z-40 flex items-center gap-1 overflow-x-auto border-t border-line bg-paper-raised px-2 py-1.5 shadow-[0_-2px_10px_-6px_rgba(0,0,0,0.45)]"
          >
            {links.map((link) => (
              <Link
                key={link.slug}
                href={link.href}
                title={link.name}
                aria-label={link.name}
                className={`flex h-11 flex-1 shrink-0 basis-0 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
                  isActive(link.href) ? "bg-brass-soft text-brass-dark" : "text-muted"
                }`}
              >
                <ModuleIcon name={link.icon} className="h-5 w-5" />
              </Link>
            ))}
            <button
              type="button"
              onClick={() => setTabsOpen(false)}
              title="Hide the module bar"
              aria-label="Hide the module bar"
              className="flex h-11 w-9 shrink-0 items-center justify-center rounded-lg text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
            >
              <span aria-hidden>&minus;</span>
            </button>
          </nav>
        ) : (
          <Puck
            onClick={() => setTabsOpen(true)}
            label="Show the module bar"
            position="bottom-4 right-4"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              className="h-5 w-5"
              aria-hidden
            >
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </Puck>
        ))}
    </div>
  );
}
