"use client";

// The home screen's monitor popup: what a ticker monitor with "Popup" ticked
// does in addition to filing a message (migrations/0149).
//
// One-off home-screen dialog, not a registered shared component — the same call
// `startup-message.tsx` beside it makes, and for the same reason: it reuses the
// registered `Modal` and `Button` and adds nothing but the dismiss wiring.
//
// ONE DIALOG FOR ALL PENDING NOTICES, not one per message. A refresh can trip
// several monitors at once, and a chain of modals would make the reader click
// OK four times to reach their home screen.
//
// The server only renders this when something is pending, so it opens
// immediately. OK marks those messages read, which is what stops them coming
// back — and clears them from the bell badge at the same time, because the
// popup and the queue entry are one record.

import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import {
  dismissMonitorPopupsAction,
  pendingMonitorPopupIdsAction,
} from "./monitor-popup-actions";

/**
 * One pending notice. Plain data, not a `SystemMessage`: this is a client
 * island, and it needs the id to dismiss and two strings to draw.
 */
export interface MonitorPopupNotice {
  id: number;
  title: string;
  body: string;
}

export function MonitorPopup({ notices }: { notices: MonitorPopupNotice[] }) {
  const [isOpen, setIsOpen] = useState(true);
  const [isDismissing, setIsDismissing] = useState(false);
  // Which of the server's notices are still unread *now*. Undefined until the
  // check returns, which is why nothing is drawn before then — see
  // `pendingMonitorPopupIdsAction`. A reader who cleared the bell and came back
  // to a cached home payload must not be shown a notice they already dealt with.
  const [confirmed, setConfirmed] = useState<MonitorPopupNotice[] | undefined>();

  // The effect keys on this, not on `notices`. The home screen builds that
  // array fresh on every render, so a new identity each time would re-run the
  // check on every re-render of the page rather than when the notices change.
  const noticeKey = notices.map((notice) => notice.id).join(",");

  useEffect(() => {
    let isCurrent = true;
    void (async () => {
      try {
        const pending = new Set(
          await pendingMonitorPopupIdsAction(notices.map((notice) => notice.id)),
        );
        if (isCurrent) setConfirmed(notices.filter((notice) => pending.has(notice.id)));
      } catch {
        // The check is a correction, not a gate: if it fails, show what the
        // server rendered rather than swallowing a notice the reader asked for.
        if (isCurrent) setConfirmed(notices);
      }
    })();
    return () => {
      isCurrent = false;
    };
    // `notices` is read inside but deliberately not a dependency — `noticeKey`
    // stands in for it, and the two change together by construction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noticeKey]);

  async function handleDismiss() {
    setIsDismissing(true);
    // Closes either way: if the write fails the notices reappear on the next
    // visit, which is a far better outcome than a dialog that won't go away.
    // Same trade `StartupMessage` makes.
    try {
      await dismissMonitorPopupsAction((confirmed ?? notices).map((notice) => notice.id));
    } finally {
      setIsDismissing(false);
      setIsOpen(false);
    }
  }

  // `confirmed === undefined` is "still checking", and draws nothing: a dialog
  // that appears and then vanishes is worse than one that appears a moment late.
  if (!isOpen || confirmed === undefined || confirmed.length === 0) return null;

  return (
    <Modal
      title={confirmed.length === 1 ? "Ticker monitor" : `Ticker monitors (${confirmed.length})`}
      onClose={handleDismiss}
      size="sm"
      isBusy={isDismissing}
      description="Dismissing marks these as read in your messages."
      footer={
        <Button onClick={handleDismiss} disabled={isDismissing}>
          OK
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {confirmed.map((notice) => (
          <div key={notice.id} className="flex flex-col gap-0.5">
            <p className="text-sm font-medium text-ink">{notice.title}</p>
            {/* Blank bodies are legitimate in this queue — a title-only message
                is a one-liner — so the paragraph is dropped rather than drawn
                empty. */}
            {notice.body && (
              <p className="text-sm leading-relaxed text-muted">{notice.body}</p>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
