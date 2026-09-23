"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { SlotIcon } from "@/components/slot-icon";
import { getIconSlot } from "@/lib/icons";
// Imported from the leaf modules, not the `@/lib/site-visits` barrel: that barrel
// re-exports the `deps`-backed prune runner, which would drag better-sqlite3 and
// `node:fs` into this client bundle and fail the build. Same rule, and the same
// reason, as the note at the top of `view.tsx`.
import { describeSuspicion } from "@/lib/site-visits/suspicion";
import type {
  IpAllowlistEntry,
  SiteVisit,
  SiteVisitSummary,
  SuspicionLevel,
  VisitWeekGroup,
} from "@/lib/site-visits/types";
import {
  allowIpAddressesAction,
  deleteSiteVisitsAction,
  disallowIpAddressAction,
  markVisitsReviewedAction,
} from "./actions";

export interface VisitsTabProps {
  weeks: VisitWeekGroup[];
  summary: SiteVisitSummary;
  allowlist: IpAllowlistEntry[];
  /** `YYYY-MM-DD` today, so the current day opens expanded. Resolved on the server. */
  todayIso: string;
  /** `YYYY-MM-DD` Monday of the current week, so this week opens expanded. */
  thisWeekStart: string;
}

// Resolved once at module scope; the guard is for the registry, not the user.
const ALLOWLIST_SLOT = getIconSlot("admin_security_allowlist");

/**
 * Red for suspicious, amber for watch, muted for normal — the fixed-colour exception
 * design.md allows for error/warning states, matching `EventBadge` on the Login tab.
 */
function SuspicionBadge({ level }: { level: SuspicionLevel }) {
  if (level === "normal") return <span className="text-muted">—</span>;

  const tone =
    level === "suspicious" ? "bg-red-950/50 text-red-300" : "bg-amber-950/50 text-amber-300";

  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {describeSuspicion(level)}
    </span>
  );
}

/** A headline count. Matches the Login tab's tiles rather than inventing a second style. */
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

/** The rollup chips on a week or day header. */
function GroupCounts({
  totalVisits,
  uniqueIps,
  suspiciousVisits,
}: {
  totalVisits: number;
  uniqueIps: number;
  suspiciousVisits: number;
}) {
  return (
    <span className="flex flex-wrap items-center gap-3 text-xs text-muted">
      <span>
        {totalVisits.toLocaleString()} visit{totalVisits === 1 ? "" : "s"}
      </span>
      <span>
        {uniqueIps.toLocaleString()} IP{uniqueIps === 1 ? "" : "s"}
      </span>
      {suspiciousVisits > 0 && (
        <span className="font-semibold text-red-300">{suspiciousVisits} suspicious</span>
      )}
    </span>
  );
}

export function VisitsTab({
  weeks,
  summary,
  allowlist,
  todayIso,
  thisWeekStart,
}: VisitsTabProps) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);

  /** Every mutation here refreshes rather than patching local state — one source of truth. */
  async function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    setIsBusy(true);
    try {
      const result = await work();
      if (!result.ok) window.alert(result.error);
      else router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDelete(rows: SiteVisit[], clearSelection: () => void) {
    if (
      !window.confirm(
        `Delete ${rows.length} visit${rows.length === 1 ? "" : "s"}? This cannot be undone.`,
      )
    ) {
      return;
    }

    await run(async () => {
      const result = await deleteSiteVisitsAction(rows.map((row) => row.id));
      if (result.ok) clearSelection();
      return result;
    });
  }

  async function handleAllow(rows: SiteVisit[], clearSelection: () => void) {
    // Ticked rows routinely share an address; the reader is choosing ADDRESSES here,
    // so the confirm names the distinct ones rather than the row count.
    const addresses = [...new Set(rows.map((row) => row.ipAddress).filter(Boolean))] as string[];

    if (addresses.length === 0) {
      window.alert("None of the selected visits recorded an IP address.");
      return;
    }

    const label =
      window.prompt(
        `Always trust ${addresses.length} address${addresses.length === 1 ? "" : "es"}?\n\n${addresses.join("\n")}\n\nOptionally say why (e.g. "my phone on 5G"):`,
        "",
      ) ?? undefined;

    // `prompt` returns null on Cancel, which `?? undefined` has already flattened —
    // so an empty string here means "OK with no label", which is allowed.
    if (label === undefined) return;

    await run(async () => {
      const result = await allowIpAddressesAction(
        addresses.map((ipAddress) => ({ ipAddress, label })),
      );
      if (result.ok) clearSelection();
      return result;
    });
  }

  async function handleDisallow(entry: IpAllowlistEntry) {
    if (!window.confirm(`Stop trusting ${entry.ipAddress}? Its past visits will be re-flagged.`)) {
      return;
    }
    await run(() => disallowIpAddressAction(entry.id, entry.ipAddress));
  }

  const columns: DataGridColumn<SiteVisit>[] = [
    {
      key: "createdAt",
      header: "When (UTC)",
      value: (row) => row.createdAt,
      render: (row) => <span className="whitespace-nowrap text-muted">{row.createdAt}</span>,
    },
    {
      key: "suspicion",
      header: "Verdict",
      value: (row) => describeSuspicion(row.suspicion),
      render: (row) => <SuspicionBadge level={row.suspicion} />,
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
      key: "userAgent",
      header: "Browser",
      value: (row) => row.userAgent ?? "",
      render: (row) => (
        <span className="break-all text-xs text-muted">{row.userAgent ?? "—"}</span>
      ),
    },
    {
      key: "referer",
      header: "Came from",
      value: (row) => row.referer ?? "",
      render: (row) => (
        <span className="break-all text-xs text-muted">{row.referer ?? "—"}</span>
      ),
    },
    {
      key: "reviewed",
      header: "Reviewed",
      value: (row) => (row.reviewedAt ? "Yes" : row.suspicion === "suspicious" ? "No" : ""),
      render: (row) => {
        if (row.suspicion !== "suspicious") return <span className="text-muted">—</span>;
        return row.reviewedAt ? (
          <span className="text-muted">Yes</span>
        ) : (
          <span className="font-semibold text-red-300">No</span>
        );
      },
    },
  ];

  return (
    <div>
      <p className="text-sm text-muted">
        Every time somebody opened the site without being signed in, grouped by week and then by
        day. Your own visits while signed in are not recorded. The IP address comes from the
        reverse proxy and can be forged — treat it as a hint about where to look, never as proof
        of who someone is. Visits are kept for 90 days.
      </p>

      {/* Two columns on a phone, four on a desktop — the same grid as the Login tab. */}
      <div className="mt-6 grid grid-cols-4 gap-3 max-lg:grid-cols-2">
        <StatTile label="Unreviewed suspicious" value={summary.unreviewedSuspicious} tone="alert" />
        <StatTile label="Suspicious (90 days)" value={summary.suspiciousVisits} />
        <StatTile label="Visits recorded" value={summary.totalVisits} />
        <StatTile label="Distinct addresses" value={summary.uniqueIps} />
      </div>

      {summary.unreviewedSuspicious > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3">
          <p className="text-sm text-red-200">
            {summary.unreviewedSuspicious.toLocaleString()} suspicious visit
            {summary.unreviewedSuspicious === 1 ? "" : "s"} you haven&apos;t reviewed
            {summary.latestSuspiciousAt ? `, most recently ${summary.latestSuspiciousAt} UTC` : ""}.
          </p>
          <Button size="sm" onClick={() => run(markVisitsReviewedAction)} disabled={isBusy}>
            {isBusy ? "Marking…" : "Mark all reviewed"}
          </Button>
        </div>
      )}

      <div className="mt-6">
        <CollapsibleCard
          title={`Allowed addresses (${allowlist.length})`}
          titleIcon={
            ALLOWLIST_SLOT ? <SlotIcon slot={ALLOWLIST_SLOT} className="h-4 w-4" /> : undefined
          }
          defaultOpen={false}
        >
          <p className="text-sm text-muted">
            Visits from these addresses are always marked normal. They are still recorded — trusting
            an address hides the alarm, never the evidence.
          </p>
          {allowlist.length === 0 ? (
            <p className="mt-3 text-sm text-muted">
              Nothing here yet. Tick a visit below and choose &ldquo;Always trust these IPs&rdquo;.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {allowlist.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="font-mono text-xs text-ink">{entry.ipAddress}</span>
                  {entry.label && <span className="text-xs text-muted">{entry.label}</span>}
                  <span className="ml-auto">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleDisallow(entry)}
                      disabled={isBusy}
                    >
                      Remove
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CollapsibleCard>
      </div>

      {weeks.length === 0 ? (
        <p className="mt-6 text-sm text-muted">No visits recorded yet.</p>
      ) : (
        <div className="mt-6 space-y-3">
          {weeks.map((week) => (
            <CollapsibleCard
              key={week.weekStart}
              title={week.label}
              // Only the current week starts open. Older weeks are history the reader
              // opens deliberately, and expanding ninety days at once would bury it.
              defaultOpen={week.weekStart === thisWeekStart}
              headerAction={
                <GroupCounts
                  totalVisits={week.totalVisits}
                  uniqueIps={week.uniqueIps}
                  suspiciousVisits={week.suspiciousVisits}
                />
              }
            >
              <div className="space-y-3">
                {week.days.map((day) => (
                  <CollapsibleCard
                    key={day.date}
                    title={day.label}
                    defaultOpen={day.date === todayIso}
                    headerAction={
                      <GroupCounts
                        totalVisits={day.totalVisits}
                        uniqueIps={day.uniqueIps}
                        suspiciousVisits={day.suspiciousVisits}
                      />
                    }
                  >
                    <DataGrid
                      columns={columns}
                      rows={day.visits}
                      // The row's real database id, never its position: a bulk action
                      // keyed on array index writes to the wrong row after a re-sort.
                      getRowKey={(row) => row.id}
                      enableSelection
                      renderSelectionActions={(selectedRows, clearSelection) => (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleAllow(selectedRows, clearSelection)}
                            disabled={isBusy}
                          >
                            Always trust these IPs
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => handleDelete(selectedRows, clearSelection)}
                            disabled={isBusy}
                          >
                            Delete
                          </Button>
                        </div>
                      )}
                      emptyMessage="No visits on this day."
                      exportFileName={`site-visits-${day.date}`}
                      storageKey="admin-security-visits"
                      showToolbar={false}
                      defaultPageSize="ALL"
                    />
                  </CollapsibleCard>
                ))}
              </div>
            </CollapsibleCard>
          ))}
        </div>
      )}
    </div>
  );
}
