"use client";

// The application-wide message queue: a bell in the utility header, and the
// window it opens.
//
// Tier 3 by design — design.md's "Adding a UI element to the shell" puts
// anything acting on the *whole app* (search, notifications, profile) in the
// header, and `AppHeader` already documents an `actions` slot for exactly this.
// It is not a floating component: nothing about it is an accessory you keep
// open while working, and it is not navigation.
//
// Pure presentation, per components.md — it fetches nothing itself. The shell
// hands it a `MessageQueueActions` object and an initial unread count read on
// the server, so the first paint already shows the right badge rather than
// flashing one in after hydration.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { getIconSlot } from "@/lib/icons";
import type { SystemMessage } from "@/lib/messages";
import { Button } from "./button";
import { Modal } from "./modal";
import { SlotIcon } from "./slot-icon";
import { Tabs } from "./tabs";
import { TreeIcon } from "./tree-icons";

const MESSAGES_SLOT = getIconSlot("chrome_header_messages")!;

/**
 * The server actions this needs, handed down as a prop.
 *
 * A file under `src/components/` must not import from `src/app/`, so the mount
 * site builds this object. **Every value must be the action itself, never an
 * arrow around it** — see the note in `(protected)/layout.tsx`; a wrapper
 * compiles and then fails at request time.
 */
export interface MessageQueueActions {
  load: () => Promise<{ unread: SystemMessage[]; read: SystemMessage[] }>;
  markRead: (messageIds: number[]) => Promise<number>;
  markAllRead: () => Promise<number>;
}

export interface MessageQueueProps {
  /**
   * Unread count at page load, resolved on the server. The badge is drawn from
   * this until the window is opened and the real lists arrive.
   */
  initialUnreadCount: number;
  actions: MessageQueueActions;
  className?: string;
}

/** Newest first, and a readable date rather than a raw SQLite timestamp. */
function formatWhen(value: string): string {
  // SQLite writes `YYYY-MM-DD HH:MM:SS` in UTC. `Date` needs the `T` and the
  // zone to read it as one; without them Safari returns Invalid Date and the
  // row shows "Invalid Date" where a time should be.
  const parsed = new Date(`${value.replace(" ", "T")}Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function MessageList({
  messages,
  emptyText,
  onMarkRead,
}: {
  messages: SystemMessage[];
  emptyText: string;
  onMarkRead?: (id: number) => void;
}) {
  if (messages.length === 0) {
    return <p className="px-1 py-8 text-center text-sm text-muted">{emptyText}</p>;
  }

  return (
    <ul className="flex flex-col gap-2 py-2">
      {messages.map((message) => (
        <li
          key={message.id}
          className="rounded-lg border border-line bg-paper p-3"
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-medium text-ink">{message.title}</span>
            <span className="ml-auto shrink-0 font-mono text-xs text-muted">
              {formatWhen(message.createdAt)}
            </span>
          </div>
          {message.body && (
            <p className="mt-1 text-sm text-muted">{message.body}</p>
          )}
          <div className="mt-2 flex items-center gap-3">
            {message.source && (
              <span className="rounded bg-brass-soft px-1.5 py-0.5 text-xs font-medium text-brass-dark">
                {message.source}
              </span>
            )}
            {onMarkRead && (
              <button
                type="button"
                onClick={() => onMarkRead(message.id)}
                className="ml-auto rounded-md px-2 py-0.5 text-xs font-medium text-muted transition-colors hover:bg-line/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
              >
                Mark read
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function MessageQueue({
  initialUnreadCount,
  actions,
  className = "",
}: MessageQueueProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [unread, setUnread] = useState<SystemMessage[]>([]);
  const [read, setRead] = useState<SystemMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [isLoading, setIsLoading] = useState(false);
  const titleId = useId();

  // The server's count is authoritative on every navigation. Without this the
  // badge would keep whatever the first page load said for the life of the tab.
  useEffect(() => {
    setUnreadCount(initialUnreadCount);
  }, [initialUnreadCount]);

  // Guards a late response from a previous open overwriting a newer one.
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setIsLoading(true);
    try {
      const queue = await actions.load();
      if (request !== requestRef.current) return;
      setUnread(queue.unread);
      setRead(queue.read);
      setUnreadCount(queue.unread.length);
    } finally {
      if (request === requestRef.current) setIsLoading(false);
    }
  }, [actions]);

  function open() {
    setIsOpen(true);
    void load();
  }

  async function markRead(id: number) {
    // Optimistic: the row moves to the Read tab immediately. A failed write is
    // corrected by the reload below, which is the authoritative read.
    setUnread((current) => current.filter((message) => message.id !== id));
    setUnreadCount((count) => Math.max(0, count - 1));
    await actions.markRead([id]);
    void load();
  }

  async function markAllRead() {
    setUnread([]);
    setUnreadCount(0);
    await actions.markAllRead();
    void load();
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        title={
          unreadCount > 0
            ? `Messages — ${unreadCount} unread`
            : "Messages"
        }
        aria-label={
          unreadCount > 0 ? `Messages, ${unreadCount} unread` : "Messages"
        }
        className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-line/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${className}`}
      >
        <SlotIcon slot={MESSAGES_SLOT} className="h-4 w-4" />
        {unreadCount > 0 && (
          // A count, not a dot: "how many" is the thing worth knowing at a
          // glance, and the badge is why the bell is in the header rather than
          // behind the profile menu. Capped so a runaway queue can't widen the
          // header.
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-brass px-1 text-center text-[10px] font-semibold leading-4 text-paper"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <Modal
          title="Messages"
          size="lg"
          onClose={() => setIsOpen(false)}
          description={
            unreadCount > 0
              ? `${unreadCount} unread`
              : "Nothing unread."
          }
          footer={
            <>
              {unread.length > 0 && (
                <Button variant="secondary" onClick={markAllRead}>
                  Mark all read
                </Button>
              )}
              <Button variant="primary" onClick={() => setIsOpen(false)}>
                Close
              </Button>
            </>
          }
        >
          <div aria-busy={isLoading} aria-labelledby={titleId}>
            <Tabs
              items={[
                {
                  key: "unread",
                  label: `Unread${unread.length > 0 ? ` (${unread.length})` : ""}`,
                  content: (
                    <MessageList
                      messages={unread}
                      emptyText={
                        isLoading ? "Loading…" : "No unread messages."
                      }
                      onMarkRead={markRead}
                    />
                  ),
                },
                {
                  key: "read",
                  // The tab the request asked for by name: read messages are
                  // kept rather than discarded, one click away.
                  label: `Read message${read.length > 0 ? ` (${read.length})` : ""}`,
                  content: (
                    <MessageList
                      messages={read}
                      emptyText={isLoading ? "Loading…" : "Nothing read yet."}
                    />
                  ),
                },
              ]}
            />
          </div>
        </Modal>
      )}
    </>
  );
}

/**
 * The warning dialog a ticker's monitor marker opens.
 *
 * Here rather than in the Investments module because it is the same "a message
 * with an ✕ to close" shape the queue deals in, and putting it beside the queue
 * keeps the two sentences styled identically — the modal and the queue row are
 * showing the *same* text, one live and one filed.
 */
export interface MonitorWarningDialogProps {
  ticker: string;
  /** One line per monitor currently in its band. */
  messages: string[];
  onClose: () => void;
}

export function MonitorWarningDialog({
  ticker,
  messages,
  onClose,
}: MonitorWarningDialogProps) {
  return (
    <Modal
      title={`${ticker} — monitor warning`}
      size="md"
      onClose={onClose}
      titleIcon={<TreeIcon name="warning" className="h-5 w-5 text-brass-dark" />}
      footer={
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <ul className="flex flex-col gap-2">
        {messages.map((message, index) => (
          // The list is a snapshot of one evaluation and is never reordered,
          // so the index is the honest key — the same call `AppHeader`'s
          // breadcrumb makes.
          <li
            key={index}
            className="rounded-lg border border-line bg-paper p-3 text-sm text-ink"
          >
            {message}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
