"use client";

// Tier 1 of the two-tier shell: which module you're in.
//
// A 64px icon-only column down the left edge, at the `full` layout only. On
// `compact` this renders nothing — the module switcher moves into the app bar as
// a dropdown, because a 64px rail beside a 240px panel is 304px of chrome on a
// 390px phone. That fork lives in `TwoTierShell`, not here; this component is
// the desktop shape and says so by rendering `null` rather than restyling.
//
// Icon-only is a deliberate trade, argued in design.md: it costs discoverability
// on touch (no hover, so no tooltip) and buys the content the full width. What
// keeps it honest is that the section panel's header repeats the module name in
// words — the glyph is never the only thing naming where you are.
//
// The width is `--module-rail-width` from globals.css, never a literal 64px:
// three things have to agree on it (this rail, the panel's left offset, and the
// padding `.app-main` reserves), and only one of them is a React component.

import Link from "next/link";
import { getIconSlot } from "@/lib/icons";
import { AppIcon } from "./app-icon";
import { ModuleIcon } from "./module-icons";
import { SlotIcon } from "./slot-icon";

// Resolved at module scope: `ICON_SLOTS` is a static array, so this is a lookup
// rather than I/O. Non-null because the id is registered in slots.ts and a test
// asserts every wired slot exists.
const HOME_SLOT = getIconSlot("chrome_rail_home")!;

export interface ModuleRailLink {
  slug: string;
  name: string;
  href: string;
  icon: string;
  hint?: string;
}

export interface ModuleRailProps {
  links: ModuleRailLink[];
  /** Whether a given module's href is the one currently open. */
  isActive: (href: string) => boolean;
  className?: string;
}

export function ModuleRail({ links, isActive, className = "" }: ModuleRailProps) {
  return (
    // `.shell-rail` (globals.css) owns the fixed position, the width and the
    // safe-area insets. Only the surface treatment is here — same split as
    // `.app-bar`, and for the same reason: the padding `.app-main` reserves has
    // to agree with the width, so one file owns both.
    <nav
      aria-label="Modules"
      className={`shell-rail flex flex-col items-center gap-1 border-r border-line bg-paper-raised py-2 ${className}`}
    >
      {/* `?home=1`, not `/`, so the logo always reaches the home screen. Bare
          `/` redirects anyone who opted into opening a favorite module on
          startup, which made this link a no-op for them — the same reasoning
          `AppChrome`'s wordmark link carries. */}
      <Link
        href="/?home=1"
        title="Home"
        aria-label="Home"
        className="mb-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-brass-dark transition-colors hover:bg-brass-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
      >
        {/* Replaceable from Admin → Display Settings → Icons. `fallback` keeps the
            brass coin-and-house mark until someone actually uploads something —
            the app mark is artwork, not a glyph either icon table can express. */}
        <SlotIcon slot={HOME_SLOT} className="h-6 w-6" fallback={<AppIcon className="h-6 w-6" />} />
      </Link>

      <div className="h-px w-8 shrink-0 bg-line" aria-hidden />

      {/* Scrolls rather than squashing: a reader with a dozen modules on a short
          window would otherwise get 12 icons compressed past the point of being
          tappable. `scrollbar-none` isn't available here, so the scrollbar is
          left visible — it only appears when it's genuinely needed. */}
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto py-1">
        {links.map((link) => {
          const active = isActive(link.href);
          return (
            <Link
              key={link.slug}
              href={link.href}
              title={link.hint ? `${link.name} — ${link.hint}` : link.name}
              aria-label={link.name}
              aria-current={active ? "page" : undefined}
              className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
                active
                  ? "bg-brass-soft text-brass-dark"
                  : "text-muted hover:bg-line/60 hover:text-ink"
              }`}
            >
              {/* The active marker is an edge bar *as well as* the tint. At 64px
                  wide with no label, a tint alone is easy to miss against the
                  rail's own `paper-raised` surface — the bar is what carries the
                  state at a glance. */}
              {active && (
                <span
                  className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-r bg-brass"
                  aria-hidden
                />
              )}
              <ModuleIcon name={link.icon} className="h-5 w-5" />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
