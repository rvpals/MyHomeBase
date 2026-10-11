"use client";

// The Script Fonts pickers: two lists of six faces, each card a specimen written
// in the face it selects.
//
// Draft fields on the admin shell rather than a screen with its own Save button,
// matching the color theme, icon set and chrome style pickers — `useAdminSettings()`
// holds both picks and the shell's "Save Settings" commits them. That is why this
// file has no `actions.ts` beside it.
//
// **Each specimen is written in its own face via an inline `fontFamily`, and that
// is deliberate.** The six faces are each loaded under their own `--font-*`
// variable in layout.tsx, and the catalogue carries the variable name — so a card
// can point at one face directly without going through `--font-script`, which
// holds the *saved* value and would render all twelve cards identically. There is
// no Tailwind class per face and there should not be one: the list is data, and a
// class per face would be a second copy of the catalogue that drifts from it.
//
// **Why the two lists repeat the same six faces rather than sharing one row of
// cards.** Each list is a separate choice and shows its own selection ring and
// its own "Saved" badge; one shared row could not show two different states. The
// specimens differ too — the quote list shows a quote at the size the card
// actually uses, the journal list shows a sentence of running text.

import { SCRIPT_FONTS, type ScriptFontId } from "@/lib/settings";
import { useAdminSettings } from "../../admin-shell";

/** What each list is for, so the two pickers below are one component used twice. */
interface PickerCopy {
  heading: string;
  blurb: string;
  /** The text each specimen is written in — chosen to match the real surface. */
  specimen: string;
  /**
   * How the specimen is sized. The quote card renders at `text-3xl`, the journal
   * sheet at whichever of four sizes the module's own preference names — so the
   * journal specimen uses that range's middle rather than implying a size this
   * screen controls. It does not: see the footnote at the bottom of the page.
   */
  specimenClass: string;
}

const DAILY_QUOTE_COPY: PickerCopy = {
  heading: "Daily Quote",
  blurb:
    "The scroll on the home screen. One short line, read at a glance — a decorative face suits it, and legibility matters least here.",
  specimen: "The best time to plant a tree was twenty years ago.",
  specimenClass: "text-2xl leading-snug",
};

const JOURNAL_COPY: PickerCopy = {
  heading: "Journal handwriting",
  blurb:
    "The entry form's Content field, when Handwriting is switched on. This is writing you read back at length, so a steadier hand is usually the better choice.",
  specimen: "Woke early, walked to the river before the heat set in.",
  specimenClass: "text-xl leading-relaxed",
};

/**
 * How clearly a face reads at length, as a quiet chip. Shown because the whole
 * trade on this screen is flourish against legibility, and design.md keeps script
 * off anything read carefully — an admin choosing a journal hand should be able to
 * see which faces survive a paragraph without trying all six.
 */
function LegibilityChip({ legibility }: { legibility: "Low" | "Medium" | "High" }) {
  return (
    <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs text-muted">
      {legibility} legibility
    </span>
  );
}

function FontPicker({
  copy,
  value,
  saved,
  onChange,
}: {
  copy: PickerCopy;
  /** The draft pick — what the cards show as selected. */
  value: ScriptFontId;
  /** The face currently live, for the "Saved" badge and the unsaved notice. */
  saved: ScriptFontId;
  onChange: (id: ScriptFontId) => void;
}) {
  const hasUnsavedChange = value !== saved;

  return (
    <section className="mt-10">
      <h2 className="font-display text-xl font-semibold text-ink">{copy.heading}</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">{copy.blurb}</p>

      {/* The pickers are drafts, and the specimens follow the draft while the real
          surfaces still show the saved face. Saying so beats leaving an admin to
          wonder why the home screen hasn't changed. */}
      {hasUnsavedChange && (
        <p className="mt-4 rounded-lg border border-brass/40 bg-brass-soft px-3 py-2 text-sm text-ink">
          <span className="font-medium">Not saved yet.</span> The{" "}
          {copy.heading.toLowerCase()} keeps its saved face until you press{" "}
          <span className="font-medium">Save Settings</span>.
        </p>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {SCRIPT_FONTS.map((font) => {
          const active = font.id === value;
          return (
            <button
              key={font.id}
              type="button"
              onClick={() => onChange(font.id)}
              aria-pressed={active}
              className={`rounded-xl border bg-paper-raised p-4 text-left transition ${
                active ? "border-brass ring-2 ring-brass" : "border-line hover:border-brass/50"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-base font-semibold text-ink">
                  {font.label}
                </span>
                {font.id === saved && (
                  <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs text-muted">
                    Saved
                  </span>
                )}
                {active && (
                  <span className="ml-auto shrink-0 rounded-full bg-brass px-2 py-0.5 text-xs font-medium text-paper">
                    Selected
                  </span>
                )}
              </div>

              {/* The specimen, written in the face it selects. `aria-hidden`
                  because it is the same sample text on every card — a screen
                  reader would read the sentence six times over and learn
                  nothing; the label and the legibility chip carry the meaning. */}
              <p
                aria-hidden
                style={{ fontFamily: `var(${font.cssVar})` }}
                className={`mt-3 text-ink ${copy.specimenClass}`}
              >
                {copy.specimen}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <LegibilityChip legibility={font.legibility} />
              </div>
              <p className="mt-2 text-sm text-muted">{font.description}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function ScriptFontsView({
  savedDailyQuoteFont,
  savedJournalFont,
}: {
  savedDailyQuoteFont: ScriptFontId;
  savedJournalFont: ScriptFontId;
}) {
  const { dailyQuoteFont, journalHandwritingFont, setDailyQuoteFont, setJournalHandwritingFont } =
    useAdminSettings();

  return (
    <>
      <FontPicker
        copy={DAILY_QUOTE_COPY}
        value={dailyQuoteFont}
        saved={savedDailyQuoteFont}
        onChange={setDailyQuoteFont}
      />

      <FontPicker
        copy={JOURNAL_COPY}
        value={journalHandwritingFont}
        saved={savedJournalFont}
        onChange={setJournalHandwritingFont}
      />

      <p className="mt-10 text-xs text-muted">
        These set the face only, not the size. The Daily Quote sizes itself and steps down
        on a narrow screen; the journal&apos;s handwriting size is a preference inside the
        Journal module, under its own Preferences screen. Faces differ in how large they
        look at the same size — the steadier hands here read noticeably bigger than the
        copperplates — so you may want to revisit that size after changing this.
      </p>
    </>
  );
}
