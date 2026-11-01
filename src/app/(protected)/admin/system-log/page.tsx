import {
  countSystemLog,
  listSystemLog,
  resolveSystemLogSettings,
} from "@/lib/system-log";
import { deps } from "@/lib/wiring";
import { SystemLogView } from "./view";

/**
 * Administration → System Log: what the application has been doing, in its own
 * words (migrations/0167).
 *
 * The third of three after-the-fact screens, and the one that answers a different
 * question from the other two:
 *
 *   Background Tasks  — did each job run, and how did the pass go? One row per pass.
 *   Message Queue     — what does a reader still need to act on? The bell's inbox.
 *   System Log (here) — what was the code doing while it ran? Many lines per pass.
 *
 * Both halves arrive in one list: the grid filters by kind in the view, so splitting
 * them here would be two queries for a screen that shows them interleaved by time —
 * which is the reading that matters when an operational line and the debug lines
 * around it explain each other.
 */
export default async function AdminSystemLogPage() {
  const entries = listSystemLog(deps.systemLogRepo);
  const counts = countSystemLog(deps.systemLogRepo);
  // Read alongside the rows so the screen can say "the log is off" rather than
  // leaving an empty table to be misread as "nothing happened".
  const settings = resolveSystemLogSettings(deps.settingsRepo.listSettings());

  return <SystemLogView entries={entries} counts={counts} settings={settings} />;
}
