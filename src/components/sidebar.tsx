"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminIcon } from "./admin-icon";
import { AppIcon } from "./app-icon";
import { Avatar } from "./avatar";
import { ModuleIcon } from "./module-icons";

const STATE_STORAGE_KEY = "myhomebase:sidebar-state";
/** The pre-3-state key. Read once on mount so an existing preference survives. */
const LEGACY_COLLAPSED_KEY = "myhomebase:sidebar-collapsed";

/**
 * How much of the sidebar is showing.
 *
 * `strip` is the accent edge on its own — the slab is gone and the page gets the
 * space back. It stays clickable, and clicking it returns to `rail`, so the
 * sidebar is never unreachable.
 */
export type SidebarState = "full" | "rail" | "strip";

const WIDTH_CLASS: Record<SidebarState, string> = {
  full: "w-60",
  rail: "w-16",
  // Wide enough to hit, and it reads as the hard accent shadow the other two
  // states cast — the slab appears to slide out from behind its own edge.
  strip: "w-3",
};

function isSidebarState(value: string | null): value is SidebarState {
  return value === "full" || value === "rail" || value === "strip";
}

/**
 * Mirrors the state onto `<html>` so the page shell can reclaim the reserved
 * gutter in CSS. The layout is a server component and this state is a client
 * concern, so an attribute is the seam between them — see globals.css.
 */
function publishState(state: SidebarState): void {
  document.documentElement.dataset.sidebar = state;
}

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
  const [state, setState] = useState<SidebarState>("full");
  const pathname = usePathname();
  const adminActive = pathname.startsWith("/admin");
  const homeActive = pathname === "/";
  const collapsed = state === "rail";

  useEffect(() => {
    const stored = window.localStorage.getItem(STATE_STORAGE_KEY);
    if (isSidebarState(stored)) {
      // Syncing from an external system (localStorage) on mount, not reacting to React state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(stored);
      return;
    }
    // Carry over the old boolean rather than resetting anyone who had it collapsed.
    const legacy = window.localStorage.getItem(LEGACY_COLLAPSED_KEY);
    if (legacy !== null) setState(legacy === "true" ? "rail" : "full");
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STATE_STORAGE_KEY, state);
    publishState(state);
  }, [state]);

  // Hidden: the slab is gone and only its accent edge is left, as a full-height
  // target that brings back the rail. Rendered as its own branch rather than a
  // zero-width version of the nav so nothing offscreen stays focusable — a
  // hidden sidebar you can still Tab into is worse than no sidebar.
  if (state === "strip") {
    return (
      <button
        type="button"
        onClick={() => setState("rail")}
        aria-label="Show sidebar"
        aria-expanded={false}
        title="Show sidebar"
        className={`fixed inset-y-0 left-0 z-40 ${WIDTH_CLASS.strip} cursor-pointer border-0 bg-brass-dark shadow-[8px_0_24px_-12px_rgba(0,0,0,0.45)] transition-[width,background-color] hover:bg-brass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass focus-visible:ring-offset-0 motion-reduce:transition-none ${className}`}
      />
    );
  }

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
      // `app-sidebar` lets globals.css size the slab from `<html data-sidebar>`
      // for the first paint, before the mount effect has read localStorage.
      className={`app-sidebar fixed inset-y-0 left-0 z-40 flex flex-col rounded-r-2xl border-r border-line bg-gradient-to-b from-paper-raised to-paper shadow-[5px_0_0_0_var(--brass-dark),14px_0_30px_-10px_rgba(0,0,0,0.45)] transition-[width] motion-reduce:transition-none ${
        WIDTH_CLASS[state]
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
        {/* Two controls, each reversible on its own: the chevron moves between
            full and rail, and « drops to the strip. A single control cycling
            three states can only go one way, so overshooting would mean going
            all the way round. */}
        <div className={`flex shrink-0 items-center ${collapsed ? "flex-col gap-0.5" : "gap-0.5"}`}>
          <button
            type="button"
            onClick={() => setState(collapsed ? "full" : "rail")}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar to icons"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar to icons"}
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
          <button
            type="button"
            onClick={() => setState("strip")}
            aria-label="Hide sidebar"
            title="Hide sidebar — click the edge to bring it back"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-line/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          >
            <span aria-hidden>&laquo;</span>
          </button>
        </div>
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
