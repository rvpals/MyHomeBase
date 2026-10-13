"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
// Imported from the leaf module, not the `@/lib/messages` barrel: that barrel
// re-exports `SqliteMessageRepository`, which would drag better-sqlite3 into this
// client bundle and fail the build. Same rule, and the same reason, as
// `admin/security/view.tsx` importing from `@/lib/auth-events/types`.
import type { SystemMessage } from "@/lib/messages/types";
import {
  deleteMessagesAction,
  markMessagesReadAction,
  pruneMessagesAction,
  setMessagesLockedAction,
} from "./actions";
import { PAGE_CONTAINER } from "../../page-container";

/**
 * The purge windows the button offers.
 *
 * A choice rather than the fixed 90 days the two sibling logs hardcode: those are
 * pruned by a nightly job where nobody picks anything, and this one is only ever
 * run by hand. An admin clearing a queue by hand knows whether they want last
 * week's noise gone or last quarter's.
 *
 * "Everything" is `1` — the smallest window the schema allows, since a floor of one
 * day is what stops a mistyped window being read as "delete the table". It still
 * leaves today's messages, which is the honest thing for a button that cannot
 * distinguish "clear the queue" from "clear the backlog".
 */
const PURGE_WINDOWS: { days: number; label: string }[] = [
  { days: 7, label: "Older than 7 days" },
  { days: 30, label: "Older than 30 days" },
  { days: 90, label: "Older than 90 days" },
  { days: 365, label: "Older than a year" },
];

/** Local to this screen, like Security's and About's. Not worth a shared component. */
function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line bg-paper-raised px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold text-ink">
        {value.toLocaleString()}
      </p>
    </div>
  );
}

/**
 * SQLite writes `YYYY-MM-DD HH:MM:SS` in UTC. `Date` needs the `T` and the zone to
 * read it as one; without them Safari returns Invalid Date and the cell shows
 * "Invalid Date" where a time should be. Same helper, same reason, as the header's
 * `message-queue.tsx` — kept local rather than shared, because that one is a
 * component-scoped detail of a different screen.
 */
function formatWhen(value: string): string {
  const parsed = new Date(`${value.replace(" ", "T")}Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface MessagesViewProps {
  /** The whole queue, read and unread, newest first. */
  messages: SystemMessage[];
}

/**
 * Administration → Message Queue.
 *
 * **This screen used to have no "mark read" control**, on the grounds that reading
 * was the header bell's job and offering both verbs here would blur the one
 * distinction worth keeping — read keeps a message, delete does not.
 *
 * That held while the bell was the only place a selection could be made. It stopped
 * holding once this grid grew bulk actions: an admin looking at 200 rows filed by a
 * job overnight wants to clear them in one gesture, and sending them to the bell to
 * do it one at a time was the worse answer. The distinction is kept in the wording
 * instead — "Mark read" and "Delete" sit side by side and say plainly which keeps
 * the message.
 */
export function MessagesView({ messages }: MessagesViewProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isMarkingRead, setIsMarkingRead] = useState(false);
  const [isLocking, setIsLocking] = useState(false);
  const [isPurging, setIsPurging] = useState(false);
  const [purgeDays, setPurgeDays] = useState(30);

  const unreadCount = messages.filter((message) => !message.readAt).length;
  const lockedCount = messages.filter((message) => message.isLocked).length;

  /** `3 messages` / `1 message` — the phrase three handlers below all need. */
  function plural(count: number): string {
    return `${count} message${count === 1 ? "" : "s"}`;
  }

  async function handleDelete(rows: SystemMessage[], clearSelection: () => void) {
    // Counted here rather than left to the server: `deleteMessages` skips locked
    // rows and returns only what went, so without this the admin would tick five,
    // press Delete, and be told "2 deleted" with no account of the other three.
    const locked = rows.filter((row) => row.isLocked);
    const deletable = rows.length - locked.length;

    if (deletable === 0) {
      window.alert(
        `${plural(rows.length)} selected, and ${
          rows.length === 1 ? "it is" : "all of them are"
        } locked. Unlock ${rows.length === 1 ? "it" : "them"} first.`,
      );
      return;
    }

    const lockedNote =
      locked.length > 0
        ? `

${plural(locked.length)} in the selection ${
            locked.length === 1 ? "is" : "are"
          } locked and will be kept.`
        : "";
    if (!window.confirm(`Delete ${plural(deletable)}? This cannot be undone.${lockedNote}`)) {
      return;
    }

    setIsDeleting(true);
    try {
      const result = await deleteMessagesAction(rows.map((row) => row.id));
      if (!result.ok) window.alert(result.error);
      else {
        clearSelection();
        router.refresh();
      }
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleMarkRead(rows: SystemMessage[], clearSelection: () => void) {
    // No confirm: marking read keeps every message, and the queue's two halves are
    // both visible on this screen, so the act is reversible by eye. Delete and
    // purge confirm because they are not.
    setIsMarkingRead(true);
    try {
      const result = await markMessagesReadAction(rows.map((row) => row.id));
      if (!result.ok) window.alert(result.error);
      else {
        clearSelection();
        router.refresh();
      }
    } finally {
      setIsMarkingRead(false);
    }
  }

  /**
   * One handler, both directions. `locked` is passed explicitly rather than
   * toggled per row: over a mixed selection a toggle would invert each row
   * independently and hand back the same mixture, which is why the schema takes
   * an end state and the bar shows two buttons.
   */
  async function handleSetLocked(
    rows: SystemMessage[],
    locked: boolean,
    clearSelection: () => void,
  ) {
    setIsLocking(true);
    try {
      const result = await setMessagesLockedAction(
        rows.map((row) => row.id),
        locked,
      );
      if (!result.ok) window.alert(result.error);
      else {
        clearSelection();
        router.refresh();
      }
    } finally {
      setIsLocking(false);
    }
  }

  async function handlePurge() {
    const chosen = PURGE_WINDOWS.find((option) => option.days === purgeDays);
    const describedWindow = chosen ? chosen.label.toLowerCase() : `older than ${purgeDays} days`;
    if (!window.confirm(`Delete every message ${describedWindow}? This cannot be undone.`)) {
      return;
    }

    setIsPurging(true);
    try {
      const result = await pruneMessagesAction(purgeDays);
      if (!result.ok) window.alert(result.error);
      else {
        // The count, not a bare "done": "0 messages deleted" is a useful answer —
        // it tells the admin the window was wrong, not that the button was.
        window.alert(
          `${(result.count ?? 0).toLocaleString()} message${result.count === 1 ? "" : "s"} deleted.`,
        );
        router.refresh();
      }
    } finally {
      setIsPurging(false);
    }
  }

  const columns: DataGridColumn<SystemMessage>[] = [
    {
      key: "createdAt",
      header: "Filed",
      value: (row) => row.createdAt,
      render: (row) => <span className="whitespace-nowrap text-sm">{formatWhen(row.createdAt)}</span>,
      minWidth: 150,
    },
    {
      key: "state",
      header: "State",
      // The sortable value is the word, so sorting groups unread together rather
      // than ordering by a timestamp the column doesn't show.
      value: (row) => (row.readAt ? "Read" : "Unread"),
      render: (row) =>
        row.readAt ? (
          <span className="text-sm text-muted">Read</span>
        ) : (
          <span className="text-sm font-semibold text-ink">Unread</span>
        ),
      minWidth: 90,
    },
    {
      key: "title",
      header: "Title",
      value: (row) => row.title,
      render: (row) => <span className="text-sm text-ink">{row.title}</span>,
      minWidth: 200,
    },
    {
      key: "body",
      header: "Message",
      value: (row) => row.body,
      // May be blank — a title-only message is a legitimate one-liner.
      render: (row) => <span className="text-sm text-muted">{row.body || "—"}</span>,
      minWidth: 240,
    },
    {
      key: "source",
      header: "Source",
      value: (row) => row.source,
      render: (row) => <span className="text-sm text-muted">{row.source || "—"}</span>,
      minWidth: 140,
    },
    {
      key: "module",
      header: "Module",
      value: (row) => row.module,
      // `system` is a real slug, not a blank, but it is not a module either — it
      // reads as "the app itself" so the column is not mistaken for a broken row.
      render: (row) => (
        <span className="text-sm text-muted">
          {row.module === "system" ? "System" : row.module}
        </span>
      ),
      minWidth: 130,
    },
    {
      key: "isLocked",
      header: "Locked",
      // The sortable value is the word, matching the State column beside it, so
      // sorting groups the locked rows rather than ordering by a raw 0/1.
      value: (row) => (row.isLocked ? "Locked" : ""),
      render: (row) =>
        row.isLocked ? (
          <span className="text-sm font-semibold text-ink">Locked</span>
        ) : (
          <span className="text-sm text-muted">—</span>
        ),
      minWidth: 90,
    },
  ];

  return (
    <div className={PAGE_CONTAINER}>
      <h1 className="font-display text-2xl font-semibold text-ink">Message Queue</h1>
      <p className="mt-2 text-sm text-muted">
        Every notice the application has filed, newest first — the same queue the bell in the
        header opens. Marking a message read keeps it; deleting it here does not, and nothing
        purges the queue on a timer, so it grows until you clear it. Lock a message to keep
        it through both a bulk delete and the age purge — unlock it to remove it.
      </p>

      {/* Two columns on a phone, four on a desktop: the fourth tile joins the row
          on wide screens and wraps to a second pair narrow, so nothing shrinks. */}
      <div className="mt-6 grid grid-cols-4 gap-3 max-lg:grid-cols-2">
        <StatTile label="Messages" value={messages.length} />
        <StatTile label="Unread" value={unreadCount} />
        <StatTile label="Read" value={messages.length - unreadCount} />
        <StatTile label="Locked" value={lockedCount} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-paper-raised px-4 py-3">
        <label htmlFor="purge-window" className="text-sm text-muted">
          Purge by age
        </label>
        <select
          id="purge-window"
          value={purgeDays}
          onChange={(event) => setPurgeDays(Number(event.target.value))}
          className="rounded-md border border-line bg-paper px-2 py-1 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        >
          {PURGE_WINDOWS.map((option) => (
            <option key={option.days} value={option.days}>
              {option.label}
            </option>
          ))}
        </select>
        <Button size="sm" variant="danger" onClick={handlePurge} disabled={isPurging}>
          {isPurging ? "Purging…" : "Purge"}
        </Button>
        <p className="text-xs text-muted">
          Deletes read and unread alike — age is the only criterion. Locked messages are kept.
        </p>
      </div>

      <div className="mt-6">
        <DataGrid
          columns={columns}
          rows={messages}
          // The row's real database id, never its position: a bulk action keyed on
          // array index writes to the wrong row after a re-sort.
          getRowKey={(row) => row.id}
          enableSelection
          renderSelectionActions={(selectedRows, clearSelection) => {
            // Which lock button to offer is decided by the selection: all-locked
            // gets Unlock, anything else gets Lock. One button, never both, so the
            // bar states an end state rather than asking the admin to work out
            // what a toggle would do to a mixed set.
            const allLocked = selectedRows.every((row) => row.isLocked);
            const busy = isDeleting || isMarkingRead || isLocking;

            return (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleMarkRead(selectedRows, clearSelection)}
                  disabled={busy}
                >
                  Mark read
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleSetLocked(selectedRows, !allLocked, clearSelection)}
                  disabled={busy}
                >
                  {allLocked ? "Unlock" : "Lock"}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => handleDelete(selectedRows, clearSelection)}
                  disabled={busy}
                >
                  Delete
                </Button>
              </>
            );
          }}
          emptyMessage="No messages have been filed yet."
          exportFileName="message-queue"
          storageKey="admin-messages"
          recordViewTitle={(row) => row.title}
        />
      </div>
    </div>
  );
}
