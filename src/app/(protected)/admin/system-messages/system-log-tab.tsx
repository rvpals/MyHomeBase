"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/button";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
// Imported from the leaf modules, not the `@/lib/system-log` barrel: that barrel
// re-exports `SqliteSystemLogRepository`, which would drag better-sqlite3 into this
// client bundle and fail the build. Same rule, and the same reason, as
// `admin/system-messages/messages-tab.tsx` importing from `@/lib/messages/types`.
import type {
  SystemLogCounts,
  SystemLogEntry,
  SystemLogKind,
  SystemLogSettings,
} from "@/lib/system-log/types";
import { clearSystemLogAction } from "./system-log-actions";

/**
 * The System Log tab of Administration → System Messages.
 *
 * Was its own screen (`/admin/system-log`) until the three after-the-fact channels
 * were folded into one. Only the chrome moved — the page container, the eyebrow and
 * the `<h1>` belong to `SystemMessagesView` now, and this returns a bare body.
 *
 * One grid over both kinds, interleaved by time. The kind is a column rather than
 * two tabs on purpose: an OPERATIONAL line saying a job started and the DEBUG lines
 * underneath it explain each other, and splitting them would hide exactly the
 * sequence a reader came here to follow. `DataGrid`'s per-column filter narrows to
 * one kind for anyone who wants that.
 *
 * Phone and desktop: `DataGrid` dispatches to its card layout below 1024px by
 * itself, so there is nothing here to restyle. The header buttons wrap.
 */

/** How a kind reads on screen, and the colour it carries. */
const KIND_LABEL: Record<SystemLogKind, string> = {
  operational: "OPERATIONAL",
  debug: "DEBUG",
};

/**
 * A state glyph, not an icon slot — the contrast between the two badges IS the
 * information, which is the case `coding-guide.md` says must not become a slot.
 */
function KindBadge({ kind }: { kind: SystemLogKind }) {
  const tone =
    kind === "operational"
      ? "border-brass/40 bg-brass-soft text-brass-dark"
      : "border-line bg-paper-raised text-muted";
  return (
    <span
      className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[0.65rem] font-medium uppercase tracking-wider ${tone}`}
    >
      {KIND_LABEL[kind]}
    </span>
  );
}

export function SystemLogTab({
  entries,
  counts,
  settings,
}: {
  entries: SystemLogEntry[];
  counts: SystemLogCounts;
  settings: SystemLogSettings;
}) {
  const router = useRouter();
  const [isClearing, setIsClearing] = useState(false);

  async function clear(kind?: SystemLogKind) {
    const what =
      kind === undefined ? "every line in the system log" : `every ${KIND_LABEL[kind]} line`;
    if (!window.confirm(`Delete ${what}? This cannot be undone.`)) return;

    setIsClearing(true);
    try {
      await clearSystemLogAction(kind);
      router.refresh();
    } finally {
      setIsClearing(false);
    }
  }

  const columns: DataGridColumn<SystemLogEntry>[] = [
    {
      key: "createdAt",
      header: "Time",
      value: (row) => row.createdAt,
      render: (row) => <span className="whitespace-nowrap font-mono text-xs">{row.createdAt}</span>,
      hint: "When the line was written, in UTC — stamped by the database, not by the code that logged it.",
      minWidth: 150,
    },
    {
      key: "kind",
      header: "Kind",
      value: (row) => row.kind,
      render: (row) => <KindBadge kind={row.kind} />,
      hint: "OPERATIONAL is routine activity such as a job running; DEBUG is detail planted while something is being diagnosed.",
      minWidth: 120,
    },
    {
      key: "source",
      header: "Source",
      value: (row) => row.source,
      render: (row) => <span className="font-mono text-xs text-muted">{row.source}</span>,
      hint: "Where in the code the line came from.",
      minWidth: 150,
    },
    {
      key: "message",
      header: "Message",
      value: (row) => row.message,
      // The detail is searchable but not sortable or exported as part of the
      // message — see `searchValue` in components.md. A reader looking for a word in
      // a stack trace should find the row it belongs to.
      searchValue: (row) => `${row.message} ${row.detail}`,
      render: (row) => (
        <span className="block">
          <span className="text-ink">{row.message}</span>
          {row.detail === "" ? null : (
            <span className="mt-0.5 block whitespace-pre-wrap font-mono text-xs text-muted">
              {row.detail}
            </span>
          )}
        </span>
      ),
      minWidth: 320,
    },
  ];

  return (
    <div>
      <p className="text-sm text-muted">
        What the application has been doing. Separate from the{" "}
        <span className="text-ink">Message Queue</span> beside it, which is what a reader
        still has to act on, and from <span className="text-ink">Background Tasks</span>,
        which records how each job&rsquo;s pass went.
      </p>

      {settings.debugEnabled || settings.operationalEnabled ? null : (
        // Without this an empty table reads as "nothing happened", which is the one
        // thing it does not mean.
        <p className="mt-4 rounded-md border border-line bg-paper-raised px-3 py-2 text-sm text-muted">
          Both switches are off, so nothing is being written. Turn them on under{" "}
          <span className="font-medium text-ink">
            Configuration → Application Configuration
          </span>
          .
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">
          {counts.total === 0 ? (
            "The log is empty."
          ) : (
            <>
              {counts.total.toLocaleString()} lines —{" "}
              {counts.operational.toLocaleString()} operational, {counts.debug.toLocaleString()}{" "}
              debug. Keeping the newest {settings.maxRows.toLocaleString()}.
            </>
          )}
        </span>

        <span className="ml-auto flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={isClearing || counts.debug === 0}
            onClick={() => void clear("debug")}
          >
            Clear DEBUG
          </Button>
          <Button
            variant="secondary"
            disabled={isClearing || counts.operational === 0}
            onClick={() => void clear("operational")}
          >
            Clear OPERATIONAL
          </Button>
          <Button
            variant="danger"
            disabled={isClearing || counts.total === 0}
            onClick={() => void clear()}
          >
            Clear all
          </Button>
        </span>
      </div>

      <div className="mt-4">
        <DataGrid
          columns={columns}
          rows={entries}
          getRowKey={(row) => row.id}
          emptyMessage="No lines yet."
          exportFileName="system-log"
          storageKey="admin-system-log"
          defaultDensity="compact"
        />
      </div>
    </div>
  );
}
