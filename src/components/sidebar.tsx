"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminIcon } from "./admin-icon";
import { AppIcon } from "./app-icon";
import { Avatar } from "./avatar";
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
  currentUser: { id: number; fullName: string; avatarMimeType?: string; updatedAt?: string };
  /** Whether to show the "Administration" link — false for non-admin users. */
  showAdmin: boolean;
  /** Server action that ends the current session, wired to the footer's "Log out" button. */
  logoutAction: () => Promise<void>;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

const navRowClasses = (collapsed: boolean, active: boolean) =>
  `relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
    collapsed ? "justify-center" : ""
  } ${
    active
      ? "bg-brass-soft text-brass-dark shadow-[0_2px_6px_-2px_rgba(0,0,0,0.25)]"
      : "text-muted hover:bg-line/50 hover:text-ink"
  }`;

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
    // Fixed and raised above the page rather than a column in the flow: the
    // layout only reserves the collapsed rail's width, so a module gets the
    // rest of the screen and the expanded sidebar floats over it.
    //
    // z-40 is "on top of everything" — above the DataGrid's sticky header (z-10),
    // its resize handles (z-20), IconSelect's dropdown (z-30) and Admin's floating
    // save bar (z-20) — but deliberately below Modal (z-50), so a dialog's overlay
    // still covers it and the sidebar isn't clickable mid-dialog.
    //
    // The hard offset shadow is Button's 3D treatment rotated to point right,
    // since a full-height slab has no bottom edge to cast from; the soft second
    // shadow is what makes it read as floating over the content.
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex flex-col rounded-r-2xl border-r border-line bg-gradient-to-b from-paper-raised to-paper shadow-[5px_0_0_0_var(--brass-dark),14px_0_30px_-10px_rgba(0,0,0,0.45)] transition-[width] motion-reduce:transition-none ${
        collapsed ? "w-16" : "w-60"
      } ${className}`}
    >
      <div
        className={`flex shrink-0 items-center ${
          collapsed ? "justify-center px-2 py-3" : "h-14 justify-between px-4"
        }`}
      >
        {/* Collapsed, the header is just the toggle. The app glyph on its own did
            nothing — it isn't a link, and it read as a duplicate of the Home icon
            directly below it. It comes back with the wordmark when expanded. */}
        {!collapsed && (
          <div className="flex min-w-0 items-center gap-2">
            <AppIcon className="h-6 w-6 shrink-0" />
            <span className="truncate font-display text-sm font-semibold text-ink">{appName}</span>
          </div>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-line/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        >
          {/* Same chevron as TreeNav and CollapsibleCard. */}
          <span
            className={`inline-block transition-transform motion-reduce:transition-none ${
              collapsed ? "" : "rotate-180"
            }`}
            aria-hidden
          >
            &rsaquo;
          </span>
        </button>
      </div>
      {/* Scrolls on its own now the rail is a fixed, viewport-height slab — a long
          module list can no longer just make the page taller. */}
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2">
        <Link href="/" title="Home" className={navRowClasses(collapsed, homeActive)}>
          <ModuleIcon name="home" className="h-4 w-4 shrink-0 text-brass" />
          {!collapsed && <span className="truncate">Home</span>}
        </Link>
        {showAdmin && (
          <Link
            href="/admin"
            title="Administration"
            className={navRowClasses(collapsed, adminActive)}
          >
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
        <Link
          href="/account"
          title="My Account"
          className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-line/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <Avatar
            userId={currentUser.id}
            avatarMimeType={currentUser.avatarMimeType}
            fallbackText={currentUser.fullName}
            version={currentUser.updatedAt}
            size="sm"
          />
          {!collapsed && <span className="truncate">{currentUser.fullName}</span>}
        </Link>
        <form action={logoutAction}>
          <button
            type="submit"
            title="Log out"
            className={`mt-0.5 flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-line/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
              ⏻
            </span>
            {!collapsed && <span>Log out</span>}
          </button>
        </form>
      </div>
    </aside>
  );
}
