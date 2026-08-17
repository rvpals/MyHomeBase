import { getAuthEventSummary, listAuthEvents } from "@/lib/auth-events";
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

  return <SecurityView events={events} summary={summary} fullNameByUserId={fullNameByUserId} />;
}
