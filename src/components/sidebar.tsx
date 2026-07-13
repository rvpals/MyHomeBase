"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminIcon } from "./admin-icon";
import { AppIcon } from "./app-icon";
import { ModuleIcon } from "./module-icons";

const COLLAPSED_STORAGE_KEY = "myhomebase:sidebar-collapsed";

export interface SidebarLink {
  slug: string;
  name: string;
  href: string;
  /** Short reference code shown next to the name, e.g. "REI". */
  code: string;
  /** Module icon key, e.g. "building". */
  icon: string;
  /** Hover tooltip text (the module's description), if any. */
  hint?: string;
}

export interface SidebarProps {
  /** Links rendered as buttons, one per module. */
  links: SidebarLink[];
  /** Application name shown as the sidebar wordmark. */
  appName: string;
  /** The logged-in user, shown in the footer row. */
  currentUser: { fullName: string };
  /** Whether to show the "Administration" link — false for non-admin users. */
  showAdmin: boolean;
  /** Server action that ends the current session, wired to the footer's "Log out" button. */
  logoutAction: () => Promise<void>;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

const navRowClasses = (collapsed: boolean, active: boolean) =>
  `relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
    collapsed ? "justify-center" : ""
  } ${active ? "bg-brass-soft text-brass-dark" : "text-muted hover:bg-line/60 hover:text-ink"}`;

export function Sidebar({
  links,
  appName,
  currentUser,
  showAdmin,
  logoutAction,
  className = "",
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const adminActive = pathname.startsWith("/admin");
  const homeActive = pathname === "/";

  useEffect(() => {
    const stored = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
    // Syncing from an external system (localStorage) on mount, not reacting to React state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored !== null) setCollapsed(stored === "true");
  }, []);

  useEffect(() => {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  return (
    <aside
      className={`flex min-h-screen flex-col border-r border-line bg-paper-raised transition-[width] motion-reduce:transition-none ${
        collapsed ? "w-16" : "w-60"
      } ${className}`}
    >
      <div
        className={`flex shrink-0 items-center px-4 ${
          collapsed ? "flex-col gap-2 py-3" : "h-14 justify-between"
        }`}
      >
        {collapsed ? (
          <AppIcon className="h-6 w-6 shrink-0" />
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <AppIcon className="h-6 w-6 shrink-0" />
            <span className="truncate font-display text-sm font-semibold text-ink">{appName}</span>
          </div>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-line/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        >
          {collapsed ? "»" : "«"}
        </button>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-2">
        <Link href="/" title="Home" className={navRowClasses(collapsed, homeActive)}>
          <span
            className={`absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-sm bg-brass transition-opacity ${
              homeActive ? "opacity-100" : "opacity-0"
            }`}
            aria-hidden
          />
          <ModuleIcon name="home" className="h-4 w-4 shrink-0 text-brass" />
          {!collapsed && <span className="truncate">Home</span>}
        </Link>
        {showAdmin && (
          <Link
            href="/admin"
            title="Administration"
            className={navRowClasses(collapsed, adminActive)}
          >
            <span
              className={`absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-sm bg-brass transition-opacity ${
                adminActive ? "opacity-100" : "opacity-0"
              }`}
              aria-hidden
            />
            <AdminIcon className="h-4 w-4 shrink-0 text-brass" />
            {!collapsed && <span className="truncate">Administration</span>}
          </Link>
        )}
        <div className="my-1 h-px bg-line" aria-hidden />
        {links.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.slug}
              href={link.href}
              title={link.hint ?? link.name}
              className={navRowClasses(collapsed, active)}
            >
              <span
                className={`absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-sm bg-brass transition-opacity ${
                  active ? "opacity-100" : "opacity-0"
                }`}
                aria-hidden
              />
              <ModuleIcon name={link.icon} className="h-4 w-4 shrink-0 text-brass" />
              {!collapsed && (
                <>
                  <span className="font-mono text-[10px] font-semibold text-brass">
                    {link.code}
                  </span>
                  <span className="truncate">{link.name}</span>
                </>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="shrink-0 border-t border-line px-2 py-3">
        <form action={logoutAction}>
          <button
            type="submit"
            title={`Log out (${currentUser.fullName})`}
            className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-line/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brass-soft text-[11px] font-semibold text-brass-dark">
              {currentUser.fullName.charAt(0).toUpperCase()}
            </span>
            {!collapsed && (
              <>
                <span className="truncate">{currentUser.fullName}</span>
                <span className="ml-auto text-xs text-muted">Log out</span>
              </>
            )}
          </button>
        </form>
      </div>
    </aside>
  );
}
