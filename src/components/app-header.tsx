"use client";

// Tier 3 of the two-tier shell: the utility header.
//
// A slim bar across the content area carrying the breadcrumb, whole-app actions
// and the profile menu. Deliberately thin on content — the rule in design.md is
// that this bar is for things meaning the same thing on *every* screen. A
// "Refresh prices" button belongs on the Stocks page however global it feels.
//
// **The breadcrumb is load-bearing, not decoration.** With the section panel
// collapsed, it is the only thing naming the current section in words on the
// full layout. It's also the compact layout's answer to the same question when
// the sheet is shut.
//
// The profile menu is `UserMenu` from `AppChrome`, reused rather than
// reimplemented: it carries the account link, the layout switch, Administration
// and log out, and a second copy would drift.

import Link from "next/link";
import type { ReactNode } from "react";
import { ModuleIcon } from "./module-icons";

export interface Breadcrumb {
  label: string;
  /** A crumb with no href is the current page — the last one, normally. */
  href?: string;
  icon?: string;
}

export interface AppHeaderProps {
  /** `[Module] › [Section]`, optionally a third crumb for a record. */
  crumbs: Breadcrumb[];
  /**
   * Compact folds the module switcher into this bar, so it takes the trigger as
   * a slot rather than knowing about modules itself.
   */
  moduleSwitcher?: ReactNode;
  /** Whole-app actions — search, notifications. Page actions do not go here. */
  actions?: ReactNode;
  /** The profile menu, supplied by the shell so this file doesn't import auth. */
  profile?: ReactNode;
  /**
   * Rendered before the breadcrumb when the section panel is collapsed — the
   * `»` that brings it back. Absent on compact, which has the bottom trigger.
   */
  onExpandPanel?: () => void;
  className?: string;
}

export function AppHeader({
  crumbs,
  moduleSwitcher,
  actions,
  profile,
  onExpandPanel,
  className = "",
}: AppHeaderProps) {
  return (
    // Not `fixed`: the rail and panel are the fixed surfaces, and this bar sits
    // inside the content column so it starts where they end. That's what lets
    // one `padding-left` on `.app-main` position the header and the page body
    // together, rather than each of them re-deriving the same offset.
    <header
      className={`sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-line bg-paper-raised px-3 ${className}`}
    >
      {onExpandPanel && (
        <button
          type="button"
          onClick={onExpandPanel}
          title="Show the section panel"
          aria-label="Show the section panel"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-line/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        >
          <span aria-hidden>&raquo;</span>
        </button>
      )}

      {moduleSwitcher}

      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            // The label is not unique enough to key on — two crumbs can share a
            // word — and the list is a fixed, non-reordered path, so the index
            // is the honest key here.
            <span key={index} className="flex min-w-0 items-center gap-1.5">
              {index > 0 && (
                <span className="shrink-0 text-muted" aria-hidden>
                  &rsaquo;
                </span>
              )}
              {crumb.icon && (
                <ModuleIcon name={crumb.icon} className="h-4 w-4 shrink-0 text-brass-dark" />
              )}
              {crumb.href && !isLast ? (
                <Link
                  href={crumb.href}
                  className="truncate text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className={`truncate ${isLast ? "font-medium text-ink" : "text-muted"}`}
                  aria-current={isLast ? "page" : undefined}
                >
                  {crumb.label}
                </span>
              )}
            </span>
          );
        })}
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {actions}
        {profile}
      </div>
    </header>
  );
}
