import { getAuthEventSummary, listAuthEvents } from "@/lib/auth-events";
import { startOfWeekIso, todayIsoLocal } from "@/lib/shared/date";
import { getSiteVisitSummary, listAllowedIps, listVisitsByWeek } from "@/lib/site-visits";
import { listUsers } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { SecurityView } from "./view";

export default async function SecurityPage() {
  const events = listAuthEvents({}, deps.authEventRepo);
  const summary = getAuthEventSummary(deps.authEventRepo);

  // Resolved here rather than joined in SQL: the log deliberately outlives the
  // accounts it references (migrations/0045), so a row can point at a deleted user.
  // A missing name falls back to the username that was typed.
  const fullNameByUserId: Record<number, string> = {};
  for (const user of listUsers(deps.userRepo)) {
    fullNameByUserId[user.id] = user.fullName;
  }

  // Grouped in the lib (`listVisitsByWeek`), so the view renders a tree it is handed
  // rather than doing date arithmetic in a component.
  const visitWeeks = listVisitsByWeek({}, deps.siteVisitRepo);
  const visitSummary = getSiteVisitSummary(deps.siteVisitRepo);
  const allowlist = listAllowedIps(deps.ipAllowlistRepo);

  // Which groups start expanded. Computed on the server so the first HTML already has
  // the right sections open — a tree that rearranges one frame after hydration reads
  // as a glitch, and this one can be many rows tall.
  const todayIso = todayIsoLocal();

  return (
    <SecurityView
      events={events}
      summary={summary}
      fullNameByUserId={fullNameByUserId}
      visitWeeks={visitWeeks}
      visitSummary={visitSummary}
      allowlist={allowlist}
      todayIso={todayIso}
      thisWeekStart={startOfWeekIso(todayIso)}
    />
  );
}
