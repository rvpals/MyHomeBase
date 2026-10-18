"use client";

// Navigation feedback: what the app does between a nav click and the new screen.
//
// Why it exists: every nav row is a `<Link>` to a **server-rendered** route, so a
// click starts an RSC fetch and React keeps the *old* screen on-screen until the
// payload lands. On a light section that is invisible. On a heavy one the app
// reads as hung — the reader clicks, nothing moves, and they click again.
//
// The source of truth is `useLinkStatus()` (Next 16), which reports the pending
// state of the nearest enclosing `<Link>`. That is React context, set by `Link`
// itself, so **it is only readable inside a `<Link>`'s subtree** — a component
// elsewhere on the page sees `pending: false` forever. Hence the split below:
//
//   - `NavLinkRow` renders the row's `<Link>` and dresses the row itself (the
//     wait cursor); `NavRowPending` swaps the row's icon for a spinner. Both do
//     their reading from *inside* the link, which is the only place it works.
//   - `NavProgressBar` renders beside the page content, far outside any `<Link>`.
//     It cannot read the status directly, so the rows publish it upward through
//     `NavPendingProvider` and it reads that instead.
//
// One provider wraps the shell; every nav surface inside it — the desktop tree
// and the compact bottom bar alike — feeds the same bar. Next holds `pending`
// false for ~100ms, so a fast navigation never flashes.
//
// Pure presentation: no data, no `lib` imports, no domain decisions.

import Link, { useLinkStatus } from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * How a row tells the shell it is loading. Null outside a provider, which is the
 * supported case: a nav surface rendered on its own still dresses its own rows,
 * it just has no bar to drive.
 */
const NavPendingContext = createContext<{
  pending: boolean;
  report: (id: string, pending: boolean) => void;
} | null>(null);

/**
 * Publishes "some nav row is loading" to everything inside it.
 *
 * Counts rows rather than holding a boolean: on a compact sheet the reader can
 * click a second row before the first resolves, and a boolean would be cleared
 * by whichever navigation settled first, hiding the bar while the other was
 * still in flight.
 */
export function NavPendingProvider({ children }: { children: ReactNode }) {
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());

  const report = useCallback((id: string, pending: boolean) => {
    setPendingIds((current) => {
      if (pending === current.has(id)) return current;
      const next = new Set(current);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ pending: pendingIds.size > 0, report }),
    [pendingIds, report],
  );

  return <NavPendingContext.Provider value={value}>{children}</NavPendingContext.Provider>;
}

/**
 * Reads the nearest `<Link>`'s pending state and publishes it to the provider.
 *
 * Every row calls this once. The id only has to be unique among rows, so an href
 * is enough — two rows pointing at the same place are the same destination and
 * may share a slot in the set.
 */
function useReportedLinkStatus(id: string): boolean {
  const { pending } = useLinkStatus();
  const ctx = useContext(NavPendingContext);
  const report = ctx?.report;

  useEffect(() => {
    if (!report) return;
    report(id, pending);
    // Clears the row's slot when it unmounts mid-flight — the compact sheet
    // closes on navigate, so its rows routinely disappear while still pending,
    // and without this the bar would never stop.
    return () => report(id, false);
  }, [report, id, pending]);

  return pending;
}

export interface NavRowPendingProps {
  /** Identifies this row in the provider's set. The row's href. */
  id: string;
  /**
   * The row's normal icon. Swapped for a spinner while the navigation is in
   * flight — *swapped*, not covered, so the row never changes width and the
   * label beside it doesn't shift as the spinner appears.
   */
  children: ReactNode;
  /**
   * The icon's size classes, e.g. `h-4 w-4 shrink-0`. The spinner takes the same
   * ones so the swap is invisible in the layout. Passed rather than hard-coded
   * because the tree's section rows, its Home row and the compact bar all size
   * their icons differently.
   */
  className?: string;
}

/**
 * A nav row's icon, replaced by a spinner while that row's navigation is loading.
 *
 * This is the part that works everywhere: a phone has no cursor, and the compact
 * bottom bar is the whole of a phone's navigation, so a cursor-only treatment
 * would leave half the app with no feedback at all.
 *
 * Must be rendered inside the row's `<Link>` — see the note at the top.
 */
export function NavRowPending({ id, children, className = "" }: NavRowPendingProps) {
  const pending = useReportedLinkStatus(id);
  if (!pending) return <>{children}</>;
  return (
    <span
      className={`nav-pending-spinner ${className}`}
      // The spinner stands in for an icon, which is decoration a sighted reader
      // reads from position. The status role announces the wait to a reader who
      // cannot see the row change.
      role="status"
      aria-label="Loading"
    />
  );
}

export interface NavLinkRowProps {
  href: string;
  title?: string;
  /** Marks the row as the current page. */
  active?: boolean;
  /** Closes the compact sheet, etc. The row's own click handling is unchanged. */
  onClick?: () => void;
  /** The row's normal classes. The busy classes are appended while pending. */
  className?: string;
  /**
   * Classes for the `<a>` itself rather than the row body — margins, and anything
   * else positioning the row *within its parent*. Those cannot move inside: a
   * margin on the body would collapse inside the anchor and space nothing.
   */
  wrapperClassName?: string;
  children: ReactNode;
}

/**
 * A nav `<Link>` that dresses itself while its navigation is in flight.
 *
 * Every nav row goes through this instead of a bare `<Link>`. Why it is one
 * component rather than a hook the rows call: `useLinkStatus` reads context that
 * `Link` provides, so it only works *inside* the link — a row cannot read the
 * status of the link it is itself rendering. Putting the link here and the row's
 * body one level down (`NavLinkRowBody`) is what gets the status to the element
 * that needs it.
 *
 * The row's own classes move onto that inner element, which stretches to fill the
 * link, so the layout is unchanged and the busy dressing has something to sit on.
 *
 * `cursor-progress`, not `cursor-wait`: the app stays interactive during an RSC
 * fetch — the reader can click elsewhere, and `wait` would claim otherwise.
 * `progress` is the arrow-with-spinner meaning "busy, but you may still act".
 */
export function NavLinkRow({
  href,
  title,
  active,
  onClick,
  className = "",
  wrapperClassName = "",
  children,
}: NavLinkRowProps) {
  return (
    <Link
      href={href}
      title={title}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      // The link is a bare block; all the row's styling is on the body below, so
      // that the one element which can see the pending state is also the one
      // carrying the cursor.
      className={`block w-full ${wrapperClassName}`}
    >
      <NavLinkRowBody id={href} className={className}>
        {children}
      </NavLinkRowBody>
    </Link>
  );
}

/** The row's visible body, inside the link so it can see the navigation. */
function NavLinkRowBody({
  id,
  className,
  children,
}: {
  id: string;
  className: string;
  children: ReactNode;
}) {
  const pending = useReportedLinkStatus(id);
  return (
    <span className={`${className} ${pending ? "cursor-progress opacity-70" : ""}`}>
      {children}
    </span>
  );
}

/**
 * A sweep across the top of the content area while any nav row is loading.
 *
 * The row spinner says *which* destination is loading, but only while the reader
 * is looking at the navigation. This is for the commoner case: the click lands,
 * the eye moves to the content, and the content is still the old screen. The bar
 * sits where the new screen will appear, so it is already where they are looking.
 *
 * Renders nothing outside a `NavPendingProvider`, and nothing while idle.
 */
export function NavProgressBar({ className = "" }: { className?: string }) {
  const ctx = useContext(NavPendingContext);
  if (!ctx?.pending) return null;
  return (
    <div className={`nav-progress-track ${className}`} role="status" aria-label="Loading page">
      <div className="nav-progress-fill" />
    </div>
  );
}
