"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import {
  describeFailureReason,
  type AuthEvent,
  type AuthEventSummary,
  type AuthEventType,
} from "@/lib/auth-events";
import { markFailuresReviewedAction } from "./actions";
import { PAGE_CONTAINER } from "../../page-container";

export interface SecurityViewProps {
  events: AuthEvent[];
  summary: AuthEventSummary;
  fullNameByUserId: Record<number, string>;
}

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

export function SecurityView({ events, summary, fullNameByUserId }: SecurityViewProps) {
  const router = useRouter();
  const [isReviewing, setIsReviewing] = useState(false);

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
    <div className={PAGE_CONTAINER}>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Security</h1>
      <p className="mt-2 text-sm text-muted">
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
          getRowKey={(row) => row.id}
          emptyMessage="No sign-in activity recorded yet."
          exportFileName="sign-in-activity"
          storageKey="admin-security"
          recordViewTitle={(row) => `${EVENT_LABELS[row.eventType]} — ${row.createdAt} UTC`}
        />
      </div>
    </div>
  );
}
