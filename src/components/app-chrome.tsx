"use client";

// The app's navigation shell: one top bar, at every screen size.
//
// Replaced the left `Sidebar`. A 240px slab down the side is a desktop pattern
// that cost a phone 62% of its screen and, being `fixed` above the content,
// swallowed taps meant for the page underneath. Moving navigation to the edges
// gives every layout the full width.
//
// **Where the modules live is the one thing that differs by layout.** On `full`
// they sit inline in the top bar, next to everything else. On `compact` there
// isn't room for that, so they collapse behind a single menu button that opens
// the same list as a dropdown — freeing the bottom edge for the current
// module's own section bar (`TreeNav`) rather than splitting it between two
// bars.
//
// The bar minimises to a small floating puck (top-left). The state is
// persisted, and mirrored onto `<html>` so `globals.css` can set the page's
// padding — `(protected)/layout.tsx` is a server component and can't read
// client state, the same seam the old sidebar worked around.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AdminIcon } from "./admin-icon";
import { AppIcon } from "./app-icon";
import { Avatar } from "./avatar";
import { ModuleIcon } from "./module-icons";
import { Puck } from "./puck";
import { useIsCompact } from "./viewport-context";
import { ViewportSwitch } from "./viewport-switch";

export interface AppChromeLink {
  slug: string;
  name: string;
  href: string;
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

const iconButton =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-brass-soft hover:text-brass-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/**
 * Compact's stand-in for the inline module list: one button that opens the
 * same links as a dropdown. There's no room to lay them out inline down here,
 * and the old alternative — a second bar pinned to the bottom — would have had
 * to fight the current module's own section bar (`TreeNav`) for the same edge.
 */
function ModuleMenu({ links, isActive }: { links: AppChromeLink[]; isActive: (href: string) => boolean }) {
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
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      </button>
      {isOpen && (
        <div
          role="menu"
          aria-label="Modules"
          // z-30: under this bar's own z-40, over ordinary content.
          className="absolute left-0 top-full z-30 mt-1 min-w-48 rounded-lg border border-line bg-paper-raised p-1 shadow-lg"
        >
          {links.map((link) => (
            <Link
              key={link.slug}
              href={link.href}
              role="menuitem"
              title={link.hint ?? link.name}
              onClick={() => setIsOpen(false)}
              className={`flex items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
                isActive(link.href) ? "bg-brass-soft font-medium text-brass-dark" : "text-ink hover:bg-line/60"
              }`}
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

  useEffect(() => {
    // Syncing from an external system (localStorage) on mount, not reacting to
    // React state.
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setBarOpen(window.localStorage.getItem(BAR_KEY) !== "min");
  }, []);

  // Mirrored onto <html> so globals.css can pad `.app-main`. The page shell is a
  // server component, so this is the only way it can react to client state.
  useEffect(() => {
    document.documentElement.dataset.appbar = barOpen ? "open" : "min";
    window.localStorage.setItem(BAR_KEY, barOpen ? "open" : "min");
  }, [barOpen]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className={className}>
      {barOpen ? (
        <header className="app-bar nav-raised-top fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-2 border-b border-line bg-paper-raised px-3">
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

          {/* Modules live inline here on the full layout. On compact there
              isn't room, so they collapse behind one menu button instead — see
              `ModuleMenu`. Freeing the bottom edge is the point: the current
              module's own section bar (`TreeNav`) pins there now, and it
              wouldn't have anywhere to go if a module bar still lived there
              too. */}
          {isCompact ? (
            <ModuleMenu links={links} isActive={isActive} />
          ) : (
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
        <Puck onClick={() => setBarOpen(true)} label="Show the toolbar" position="left-3 top-3 z-40">
          <AppIcon className="h-5 w-5" />
        </Puck>
      )}
    </div>
  );
}
