// Administration -> Display Settings -> Script Fonts.
//
// A server component: it reads both saved faces so the pickers start on the real
// values with no fetch-then-populate flicker, and hands them to the client view.
// Two settings rows, so the read is two lookups.
//
// The pickers themselves are draft fields on the admin shell — they commit on
// "Save Settings", like the color theme, icon set and chrome style pickers — so
// the values read here are the *saved* ones, which is what the view compares its
// drafts against to show the "Not saved yet" notice.

import { getSetting, resolveScriptFont, SCRIPT_FONT_SETTING_KEYS } from "@/lib/settings";
import { deps } from "@/lib/wiring";
import { PAGE_CONTAINER } from "../../../page-container";
import { ScriptFontsView } from "./view";

export default function ScriptFontsPage() {
  const savedDailyQuoteFont = resolveScriptFont(
    getSetting(deps.settingsRepo, SCRIPT_FONT_SETTING_KEYS.dailyQuote)?.value,
  );
  const savedJournalFont = resolveScriptFont(
    getSetting(deps.settingsRepo, SCRIPT_FONT_SETTING_KEYS.journalHandwriting)?.value,
  );

  return (
    <div className={PAGE_CONTAINER}>
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Display Settings
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Script Fonts</h1>
      <p className="mt-2 text-sm text-muted">
        The handwriting the application is written in, in the two places it uses any. These
        are one choice for the whole application, not per person, and they are deliberately
        separate: the Daily Quote is a line you glance at, while a journal entry is a
        paragraph you read back. Nothing else in the app uses a script face — the rest
        follows your color theme&apos;s fonts.
      </p>

      <ScriptFontsView
        savedDailyQuoteFont={savedDailyQuoteFont}
        savedJournalFont={savedJournalFont}
      />
    </div>
  );
}
