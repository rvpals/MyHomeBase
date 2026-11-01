"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { SlotIcon } from "@/components/slot-icon";
import { Tabs, type TabItem } from "@/components/tabs";
import { getIconSlot } from "@/lib/icons";
// Imported from the leaf modules, not the barrels: `@/lib/auth-events`,
// `@/lib/site-visits`, `@/lib/system-log` and `@/lib/messages` all re-export their
// `deps`-backed repositories, which would drag better-sqlite3 and `node:fs` into
// this client bundle and fail the build. Same rule, and the same reason, as each of
// the three tab files below.
import type { AuthEvent, AuthEventSummary } from "@/lib/auth-events/types";
import type { SystemMessage } from "@/lib/messages/types";
import type {
  IpAllowlistEntry,
  IpBlacklistEntry,
  SiteVisitSummary,
  VisitWeekGroup,
} from "@/lib/site-visits/types";
import type {
  SystemLogCounts,
  SystemLogEntry,
  SystemLogSettings,
} from "@/lib/system-log/types";
import { MessagesTab } from "./messages-tab";
import { SecurityTab } from "./security-tab";
import { SystemLogTab } from "./system-log-tab";
import { PAGE_CONTAINER } from "../../page-container";

/**
 * Resolved once at module scope. `getIconSlot` reads the static registry — no I/O —
 * and the guard is for the registry, not the user: if an id is ever removed the tab
 * loses its glyph rather than crashing. `Tabs` takes a ReactNode label, which is what
 * lets a tab carry an icon beside its text.
 */
const SECURITY_TAB_SLOT = getIconSlot("admin_system_messages_tab_security");
const SYSTEM_LOG_TAB_SLOT = getIconSlot("admin_system_messages_tab_system_log");
const MESSAGES_TAB_SLOT = getIconSlot("admin_system_messages_tab_messages");

/** The query parameter naming the open top-level tab. */
const TAB_PARAM = "tab";
/** The query parameter naming Security's open sub-tab. Ignored by the other two. */
const SUB_PARAM = "sub";

/** The three top tabs, as keys. Also the values `?tab=` accepts. */
const SECURITY_TAB = "security";
const SYSTEM_LOG_TAB = "system-log";
const MESSAGES_TAB = "messages";

const TAB_KEYS = [SECURITY_TAB, SYSTEM_LOG_TAB, MESSAGES_TAB];
/** Security's two sub-tabs. These keys are the ones `security-tab.tsx` declares. */
const SUB_TAB_KEYS = ["login", "visit"];

export interface SystemMessagesViewProps {
  events: AuthEvent[];
  summary: AuthEventSummary;
  fullNameByUserId: Record<number, string>;
  visitWeeks: VisitWeekGroup[];
  visitSummary: SiteVisitSummary;
  allowlist: IpAllowlistEntry[];
  blacklist: IpBlacklistEntry[];
  todayIso: string;
  thisWeekStart: string;
  logEntries: SystemLogEntry[];
  logCounts: SystemLogCounts;
  logSettings: SystemLogSettings;
  messages: SystemMessage[];
}

/**
 * Administration → System Messages: the app's three after-the-fact channels, as
 * three tabs on one screen.
 *
 *   Security    — who signed in, and who came knocking. Two sub-tabs of its own.
 *   System Log  — what the code was doing while it ran. Many lines per pass.
 *   Message Queue — what a reader still has to act on. The bell's inbox.
 *
 * One screen rather than three, because reading them as a group is the point: a
 * failed sign-in, the lines the code wrote around it and the notice it filed are
 * three views of one event, and three nav entries made that a three-click comparison.
 * **Background Tasks deliberately stayed its own screen** — it answers "did each job
 * run", which is a scheduler question rather than a log one.
 *
 * ## Why the tab lives in the URL
 *
 * `?tab=` is read and written here rather than left to `Tabs`' own state, for three
 * reasons that all predate this screen:
 *
 *  - The three old routes still exist as redirects, and each one lands on its tab.
 *  - The home screen's two alerts deep-link to a specific tab, and the
 *    suspicious-visit one needs Security's *Visit* sub-tab (`?tab=security&sub=visit`)
 *    rather than the Login tab it would otherwise open on.
 *  - A personal toolbar row saved against one of the three old menu items points at
 *    a tab URL, so those rows keep working.
 *
 * `router.replace`, not `push`: switching tabs is not a navigation a reader expects
 * Back to undo one step at a time, and `scroll: false` keeps a long grid where it was.
 *
 * ## Phone and desktop
 *
 * `Tabs` already wraps its strip, and `DataGrid` dispatches to its card layout below
 * 1024px by itself. Security's nested strip means two wrapping rows narrow, which is
 * the cost of keeping Login and Visit distinct — no new chrome, nothing `fixed`.
 */
export function SystemMessagesView({
  events,
  summary,
  fullNameByUserId,
  visitWeeks,
  visitSummary,
  allowlist,
  blacklist,
  todayIso,
  thisWeekStart,
  logEntries,
  logCounts,
  logSettings,
  messages,
}: SystemMessagesViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // An unrecognised `?tab=` falls back to Security rather than rendering nothing:
  // these URLs are typed by hand and pasted into alerts, and a typo should land
  // somewhere useful instead of on an empty screen.
  const requestedTab = searchParams.get(TAB_PARAM);
  const activeTab = requestedTab && TAB_KEYS.includes(requestedTab) ? requestedTab : SECURITY_TAB;

  const requestedSub = searchParams.get(SUB_PARAM);
  const activeSubTab =
    requestedSub && SUB_TAB_KEYS.includes(requestedSub) ? requestedSub : "login";

  /**
   * Writes one parameter back to the URL, preserving whatever else is on it.
   *
   * Switching the top tab clears `?sub=`: it belongs to Security alone, and leaving
   * it behind would make a shared System Log link carry a stale sub-tab that silently
   * reappears if the reader clicks back to Security.
   */
  const setParam = useCallback(
    (name: string, value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set(name, value);
      if (name === TAB_PARAM && value !== SECURITY_TAB) next.delete(SUB_PARAM);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const tabs: TabItem[] = [
    {
      key: SECURITY_TAB,
      label: (
        <span className="flex items-center gap-2">
          {SECURITY_TAB_SLOT && <SlotIcon slot={SECURITY_TAB_SLOT} className="h-4 w-4" />}
          Security
        </span>
      ),
      content: (
        <SecurityTab
          events={events}
          summary={summary}
          fullNameByUserId={fullNameByUserId}
          visitWeeks={visitWeeks}
          visitSummary={visitSummary}
          allowlist={allowlist}
          blacklist={blacklist}
          todayIso={todayIso}
          thisWeekStart={thisWeekStart}
          activeSubTab={activeSubTab}
          onSubTabChange={(key) => setParam(SUB_PARAM, key)}
        />
      ),
    },
    {
      key: SYSTEM_LOG_TAB,
      label: (
        <span className="flex items-center gap-2">
          {SYSTEM_LOG_TAB_SLOT && <SlotIcon slot={SYSTEM_LOG_TAB_SLOT} className="h-4 w-4" />}
          System Log
        </span>
      ),
      content: (
        <SystemLogTab entries={logEntries} counts={logCounts} settings={logSettings} />
      ),
    },
    {
      key: MESSAGES_TAB,
      label: (
        <span className="flex items-center gap-2">
          {MESSAGES_TAB_SLOT && <SlotIcon slot={MESSAGES_TAB_SLOT} className="h-4 w-4" />}
          Message Queue
        </span>
      ),
      content: <MessagesTab messages={messages} />,
    },
  ];

  return (
    <div className={PAGE_CONTAINER}>
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Administration
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">System Messages</h1>
      <p className="mt-2 text-sm text-muted">
        Everything the application has recorded about itself, after the fact.{" "}
        <strong className="text-ink">Security</strong> is who signed in and who came
        knocking; <strong className="text-ink">System Log</strong> is what the code was
        doing while it ran; <strong className="text-ink">Message Queue</strong> is what a
        reader still has to act on. Whether each scheduled job <em>ran</em> is a separate
        question, answered on <span className="text-ink">Background Tasks</span>.
      </p>

      <div className="mt-6">
        <Tabs
          items={tabs}
          activeKey={activeTab}
          onActiveKeyChange={(key) => setParam(TAB_PARAM, key)}
        />
      </div>
    </div>
  );
}
