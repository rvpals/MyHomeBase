import { getAuthEventSummary, listAuthEvents } from "@/lib/auth-events";
import { listAllMessages } from "@/lib/messages";
import { startOfWeekIso, todayIsoLocal } from "@/lib/shared/date";
import {
  getSiteVisitSummary,
  listAllowedIps,
  listBlockedIps,
  listVisitsByWeek,
} from "@/lib/site-visits";
import {
  countSystemLog,
  listSystemLog,
  resolveSystemLogSettings,
} from "@/lib/system-log";
import { listUsers } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { SystemMessagesView } from "./view";

/**
 * Administration → System Messages: Security, System Log and Message Queue, which
 * were three screens until they were folded into one set of tabs.
 *
 * The three old routes (`/admin/security`, `/admin/system-log`, `/admin/messages`)
 * survive as redirects into this one's `?tab=`, so existing links and saved toolbar
 * rows keep working.
 *
 * **Every tab's data is read here, on every visit, whichever tab is open.** Eager
 * rather than per-tab, for two reasons: Security already did exactly this for its own
 * two tabs, and all four reads are over bounded tables — the auth log is pruned at 90
 * days and the system log is capped by its own row limit. Making this lazy would mean
 * a client fetch per tab and a loading state on each, which is a real cost for a screen
 * whose whole point is comparing the three. If the system log's cap is ever raised far
 * enough that this is felt, that is the trade to revisit.
 */
export default async function AdminSystemMessagesPage() {
  // --- Security: sign-in activity -----------------------------------------
  const events = listAuthEvents({}, deps.authEventRepo);
  const summary = getAuthEventSummary(deps.authEventRepo);

  // Resolved here rather than joined in SQL: the log deliberately outlives the
  // accounts it references (migrations/0045), so a row can point at a deleted user.
  // A missing name falls back to the username that was typed.
  const fullNameByUserId: Record<number, string> = {};
  for (const user of listUsers(deps.userRepo)) {
    fullNameByUserId[user.id] = user.fullName;
  }

  // --- Security: site arrivals ---------------------------------------------
  // Grouped in the lib (`listVisitsByWeek`), so the view renders a tree it is handed
  // rather than doing date arithmetic in a component.
  const visitWeeks = listVisitsByWeek({}, deps.siteVisitRepo);
  const visitSummary = getSiteVisitSummary(deps.siteVisitRepo);
  const allowlist = listAllowedIps(deps.ipAllowlistRepo);
  const blacklist = listBlockedIps(deps.ipBlacklistRepo);

  // Which groups start expanded. Computed on the server so the first HTML already has
  // the right sections open — a tree that rearranges one frame after hydration reads
  // as a glitch, and this one can be many rows tall.
  const todayIso = todayIsoLocal();

  // --- System Log -----------------------------------------------------------
  // Both kinds arrive in one list: the grid filters by kind in the view, so splitting
  // them here would be two queries for a tab that shows them interleaved by time —
  // which is the reading that matters when an operational line and the debug lines
  // around it explain each other.
  const logEntries = listSystemLog(deps.systemLogRepo);
  const logCounts = countSystemLog(deps.systemLogRepo);
  // Read alongside the rows so the tab can say "the log is off" rather than leaving
  // an empty table to be misread as "nothing happened".
  const logSettings = resolveSystemLogSettings(deps.settingsRepo.listSettings());

  // --- Message Queue --------------------------------------------------------
  // Read and unread together, newest first. The grid shows a state column and filters
  // in the view, so it wants one list rather than the header bell's split pair.
  const messages = listAllMessages(deps.messageRepo);

  return (
    <SystemMessagesView
      events={events}
      summary={summary}
      fullNameByUserId={fullNameByUserId}
      visitWeeks={visitWeeks}
      visitSummary={visitSummary}
      allowlist={allowlist}
      blacklist={blacklist}
      todayIso={todayIso}
      thisWeekStart={startOfWeekIso(todayIso)}
      logEntries={logEntries}
      logCounts={logCounts}
      logSettings={logSettings}
      messages={messages}
    />
  );
}
