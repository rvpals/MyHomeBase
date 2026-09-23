"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { SlotIcon } from "@/components/slot-icon";
import { Tabs, type TabItem } from "@/components/tabs";
import { getIconSlot } from "@/lib/icons";
// Imported from the leaf modules, not the `@/lib/auth-events` barrel: that barrel
// re-exports the `deps`-backed prune runner, which would drag better-sqlite3 and
// `node:fs` into this client bundle and fail the build. Same rule, and the same
// reason, as `admin/background-tasks/view.tsx` importing from
// `@/lib/scheduled-refresh/types`.
import { describeFailureReason } from "@/lib/auth-events/auth-events";
import type {
  AuthEvent,
  AuthEventSummary,
  AuthEventType,
} from "@/lib/auth-events/types";
import type {
  IpAllowlistEntry,
  SiteVisitSummary,
  VisitWeekGroup,
} from "@/lib/site-visits/types";
import { deleteAuthEventsAction, markFailuresReviewedAction } from "./actions";
import { VisitsTab } from "./visits-tab";
import { PAGE_CONTAINER } from "../../page-container";

export interface SecurityViewProps {
  events: AuthEvent[];
  summary: AuthEventSummary;
  fullNameByUserId: Record<number, string>;
  /** Arrivals grouped week → day, newest first. Grouped in the lib, not here. */
  visitWeeks: VisitWeekGroup[];
  visitSummary: SiteVisitSummary;
  allowlist: IpAllowlistEntry[];
  /** `YYYY-MM-DD` today, so the current day opens expanded. Resolved on the server. */
  todayIso: string;
  /** `YYYY-MM-DD` Monday of the current week, so this week opens expanded. */
  thisWeekStart: string;
}

// Resolved once at module scope. `getIconSlot` reads the static registry — no I/O — and
// the guard is for the registry, not the user: if an id is ever removed the tab loses
// its glyph rather than crashing. `Tabs` takes a ReactNode label, which is what lets a
// tab carry an icon beside its text (Journal's Entries → Log did this first).
const LOGIN_TAB_SLOT = getIconSlot("admin_security_tab_login");
const VISIT_TAB_SLOT = getIconSlot("admin_security_tab_visit");

const EVENT_LABELS: Record<AuthEventType, string> = {
  login_success: "Signed in",
  login_failure: "Failed",
  logout: "Signed out",
};

function EventBadge({ eventType }: { eventType: AuthEventType }) {
  // Red means error, green means fine — the fixed-colour exception in design.md,
  // matching the Enabled/Disabled badges on User Management.
  const tone =
    eventType === "login_failure"
      ? "bg-red-950/50 text-red-300"
      : eventType === "login_success"
        ? "bg-emerald-950/50 text-emerald-300"
        : "bg-line/60 text-muted";

  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {EVENT_LABELS[eventType]}
    </span>
  );
}

/** A headline count. Not `UsageMeter` — these numbers aren't part of a known total. */
function StatTile({ label, value, tone }: { label: string; value: number; tone?: "alert" }) {
  return (
    <div className="rounded-xl border border-line bg-paper-raised px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p
        className={`mt-1 font-display text-2xl font-semibold ${
          tone === "alert" && value > 0 ? "text-red-300" : "text-ink"
        }`}
      >
        {value.toLocaleString()}
      </p>
    </div>
  );
}

/**
 * The Security screen: sign-in activity and site arrivals, as two tabs.
 *
 * The screen title and its intro sit above the strip, because they describe the
 * screen rather than either tab. Each tab then carries its own explanation, its own
 * stat tiles and its own grid.
 */
export function SecurityView({
  events,
  summary,
  fullNameByUserId,
  visitWeeks,
  visitSummary,
  allowlist,
  todayIso,
  thisWeekStart,
}: SecurityViewProps) {
  const tabs: TabItem[] = [
    {
      key: "login",
      label: (
        <span className="flex items-center gap-2">
          {LOGIN_TAB_SLOT && <SlotIcon slot={LOGIN_TAB_SLOT} className="h-4 w-4" />}
          Login
        </span>
      ),
      content: (
        <LoginTab events={events} summary={summary} fullNameByUserId={fullNameByUserId} />
      ),
    },
    {
      key: "visit",
      label: (
        <span className="flex items-center gap-2">
          {VISIT_TAB_SLOT && <SlotIcon slot={VISIT_TAB_SLOT} className="h-4 w-4" />}
          Visit
        </span>
      ),
      content: (
        <VisitsTab
          weeks={visitWeeks}
          summary={visitSummary}
          allowlist={allowlist}
          todayIso={todayIso}
          thisWeekStart={thisWeekStart}
        />
      ),
    },
  ];

  return (
    <div className={PAGE_CONTAINER}>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Security</h1>
      <p className="mt-2 text-sm text-muted">
        Who has signed in, and who has come knocking. <strong className="text-ink">Login</strong>{" "}
        records every sign-in attempt; <strong className="text-ink">Visit</strong> records arrivals
        at the site by anyone who wasn&apos;t signed in.
      </p>

      <div className="mt-6">
        <Tabs items={tabs} defaultActiveKey="login" />
      </div>
    </div>
  );
}

/** The sign-in log. The screen this file has always been, now inside a tab. */
function LoginTab({
  events,
  summary,
  fullNameByUserId,
}: Pick<SecurityViewProps, "events" | "summary" | "fullNameByUserId">) {
  const router = useRouter();
  const [isReviewing, setIsReviewing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleMarkReviewed() {
    setIsReviewing(true);
    try {
      const result = await markFailuresReviewedAction();
      if (!result.ok) window.alert(result.error);
      else router.refresh();
    } finally {
      setIsReviewing(false);
    }
  }

  async function handleDelete(rows: AuthEvent[], clearSelection: () => void) {
    if (
      !window.confirm(
        `Delete ${rows.length} event${rows.length === 1 ? "" : "s"}? This cannot be undone.`,
      )
    ) {
      return;
    }

    setIsDeleting(true);
    try {
      const result = await deleteAuthEventsAction(rows.map((row) => row.id));
      if (!result.ok) window.alert(result.error);
      else {
        clearSelection();
        router.refresh();
      }
    } finally {
      setIsDeleting(false);
    }
  }

  /** The typed username, falling back to the account name when nothing was typed (a logout). */
  function describeAccount(row: AuthEvent): string {
    if (row.attemptedUsername) return row.attemptedUsername;
    if (row.userId !== undefined) return fullNameByUserId[row.userId] ?? `User #${row.userId}`;
    return "—";
  }

  const columns: DataGridColumn<AuthEvent>[] = [
    {
      key: "createdAt",
      header: "When (UTC)",
      value: (row) => row.createdAt,
      render: (row) => <span className="whitespace-nowrap text-muted">{row.createdAt}</span>,
    },
    {
      key: "eventType",
      header: "Event",
      value: (row) => EVENT_LABELS[row.eventType],
      render: (row) => <EventBadge eventType={row.eventType} />,
    },
    {
      key: "account",
      header: "Username typed",
      value: (row) => describeAccount(row),
      render: (row) => <span className="break-all text-ink">{describeAccount(row)}</span>,
    },
    {
      key: "matchedUser",
      header: "Matched account",
      value: (row) =>
        row.userId === undefined ? "" : (fullNameByUserId[row.userId] ?? `User #${row.userId}`),
      render: (row) =>
        row.userId === undefined ? (
          <span className="text-muted">—</span>
        ) : (
          // The log outlives the accounts it references, so an id with no name is a
          // deleted user, not an error.
          <span className="text-ink">
            {fullNameByUserId[row.userId] ?? `Deleted user #${row.userId}`}
          </span>
        ),
    },
    {
      key: "failureReason",
      header: "Reason",
      value: (row) => (row.failureReason ? describeFailureReason(row.failureReason) : ""),
      render: (row) =>
        row.failureReason ? (
          <span className="text-red-300">{describeFailureReason(row.failureReason)}</span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: "ipAddress",
      header: "IP address",
      value: (row) => row.ipAddress ?? "",
      render: (row) => (
        <span className="whitespace-nowrap font-mono text-xs text-muted">
          {row.ipAddress ?? "—"}
        </span>
      ),
    },
    {
      key: "reviewed",
      header: "Reviewed",
      value: (row) => (row.reviewedAt ? "Yes" : row.eventType === "login_failure" ? "No" : ""),
      render: (row) => {
        if (row.eventType !== "login_failure") return <span className="text-muted">—</span>;
        return row.reviewedAt ? (
          <span className="text-muted">Yes</span>
        ) : (
          <span className="font-semibold text-red-300">No</span>
        );
      },
    },
    {
      key: "userAgent",
      header: "Browser",
      value: (row) => row.userAgent ?? "",
      render: (row) => (
        <span className="break-all text-xs text-muted">{row.userAgent ?? "—"}</span>
      ),
    },
  ];

  return (
    <div>
      <p className="text-sm text-muted">
        Every sign-in, sign-out and failed attempt, newest first. A failed attempt records why it
        failed even though the sign-in screen only ever says &ldquo;Invalid username or
        password&rdquo; — the visitor learns nothing, you learn everything. Attempts are kept for
        90 days.
      </p>

      {/* Two columns on a phone, four on a desktop: the tiles stay readable narrow
          without a separate component. */}
      <div className="mt-6 grid grid-cols-4 gap-3 max-lg:grid-cols-2">
        <StatTile label="Unreviewed failures" value={summary.unreviewedFailures} tone="alert" />
        <StatTile label="Failures (90 days)" value={summary.totalFailures} />
        <StatTile label="Successful sign-ins" value={summary.totalSuccesses} />
        <StatTile label="Events recorded" value={events.length} />
      </div>

      {summary.unreviewedFailures > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3">
          <p className="text-sm text-red-200">
            {summary.unreviewedFailures.toLocaleString()} failed sign-in
            {summary.unreviewedFailures === 1 ? "" : "s"} you haven&apos;t reviewed
            {summary.latestFailureAt ? `, most recently ${summary.latestFailureAt} UTC` : ""}.
          </p>
          <Button size="sm" onClick={handleMarkReviewed} disabled={isReviewing}>
            {isReviewing ? "Marking…" : "Mark all reviewed"}
          </Button>
        </div>
      )}

      <div className="mt-6">
        <DataGrid
          columns={columns}
          rows={events}
          // The row's real database id, never its position: a bulk action keyed on
          // array index writes to the wrong row after a re-sort.
          getRowKey={(row) => row.id}
          enableSelection
          renderSelectionActions={(selectedRows, clearSelection) => (
            <Button
              size="sm"
              variant="danger"
              onClick={() => handleDelete(selectedRows, clearSelection)}
              disabled={isDeleting}
            >
              Delete
            </Button>
          )}
          emptyMessage="No sign-in activity recorded yet."
          exportFileName="sign-in-activity"
          storageKey="admin-security"
          recordViewTitle={(row) => `${EVENT_LABELS[row.eventType]} — ${row.createdAt} UTC`}
        />
      </div>
    </div>
  );
}
