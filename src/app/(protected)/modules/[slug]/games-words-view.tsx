"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import {
  PICTIONARY_TIERS,
  type PictionaryImportSummary,
  type PictionaryTier,
  type StoredPictionaryWord,
} from "@/lib/games";
import { clearWordsAction, deleteWordAction, importWordsAction } from "./games-actions";

// The Pictionary word bank editor, on Games → Configuration.
//
// A plain textarea and a Save button. Everything about what a valid word is, how a list
// is split, and what counts as a duplicate lives in @/lib/games
// (src/lib/games/pictionary-import.ts) — this file collects text and reports a summary.
//
// Deliberately NOT `CsvImportPanel`: that component maps columns onto a record's fields,
// which is apparatus a one-column list has no use for. The registry was checked first;
// `Button` is reused, and the box itself is one textarea.

const TIER_LABEL: Record<PictionaryTier, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

export function GamesWordsView({
  words,
  counts,
}: {
  words: readonly StoredPictionaryWord[];
  counts: Record<PictionaryTier, number>;
}) {
  const router = useRouter();

  const [text, setText] = useState("");
  const [tier, setTier] = useState<PictionaryTier>("easy");
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState<PictionaryImportSummary>();
  const [error, setError] = useState<string>();

  // Which tier's stored list is on screen. `undefined` is "all of them".
  const [filter, setFilter] = useState<PictionaryTier | undefined>();

  const shown = filter ? words.filter((entry) => entry.tier === filter) : words;
  const total = PICTIONARY_TIERS.reduce((sum, entry) => sum + counts[entry], 0);

  async function save() {
    if (text.trim().length === 0 || saving) return;
    setSaving(true);
    setError(undefined);
    setSummary(undefined);

    const result = await importWordsAction(text, tier);
    setSaving(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setSummary(result.summary);
    // Clear the box only when something landed, so a paste that failed entirely is
    // still there to be corrected rather than lost.
    if (result.summary.added > 0) setText("");
    router.refresh();
  }

  async function removeOne(id: number) {
    const result = await deleteWordAction(id);
    if (!result.ok) setError(result.error);
    else router.refresh();
  }

  async function clearAll() {
    const scope = filter ? `every ${TIER_LABEL[filter].toLowerCase()} word` : "every word";
    if (!window.confirm(`Remove ${scope} you have added? This cannot be undone.`)) return;

    const result = await clearWordsAction(filter);
    if (!result.ok) setError(result.error);
    else router.refresh();
  }

  return (
    <section className="rounded-xl border border-line bg-paper-raised p-5">
      <h2 className="font-display text-base text-ink">Pictionary words</h2>
      <p className="mt-1 text-sm text-muted">
        Add your own prompts to the ones that ship with the app. Type or paste a list
        below — one word a line, or separated by commas. Games draw from both lists.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-muted">
            Words to add
          </span>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={8}
            placeholder={"volcano\nbicycle\nhot air balloon"}
            spellCheck={false}
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 font-mono text-sm text-ink placeholder:text-muted"
          />
        </label>

        <div className="flex flex-wrap items-end gap-4">
          <div>
            <span className="mb-1 block text-xs uppercase tracking-wide text-muted">
              Add them as
            </span>
            <div className="flex gap-2">
              {PICTIONARY_TIERS.map((entry) => (
                <Button
                  key={entry}
                  size="sm"
                  variant={entry === tier ? "primary" : "secondary"}
                  onClick={() => setTier(entry)}
                  ariaPressed={entry === tier}
                >
                  {TIER_LABEL[entry]}
                </Button>
              ))}
            </div>
          </div>

          <Button onClick={save} disabled={saving || text.trim().length === 0}>
            {saving ? "Saving…" : "Save words"}
          </Button>
        </div>

        <p className="text-xs text-muted">
          A line can name its own tier after a comma (<code>volcano,hard</code>), which
          overrides the choice above. Words must be letters only — no digits, since the
          drawer is not allowed to write.
        </p>
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      {summary && (
        <div className="mt-4 rounded-lg border border-line bg-paper p-3 text-sm">
          <p className="text-ink">
            {summary.added > 0
              ? `Added ${summary.added} ${summary.added === 1 ? "word" : "words"}.`
              : "Nothing new was added."}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted">
            {summary.alreadyPresent > 0 && (
              <li>{summary.alreadyPresent} already in the bank.</li>
            )}
            {summary.duplicatesInPaste > 0 && (
              <li>{summary.duplicatesInPaste} repeated within the list you pasted.</li>
            )}
          </ul>

          {summary.problems.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-red-400">
                {summary.problems.length}{" "}
                {summary.problems.length === 1 ? "line could" : "lines could"} not be
                added:
              </p>
              <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted">
                {summary.problems.map((problem, index) => (
                  <li key={`${problem.line}-${index}`}>
                    Line {problem.line}
                    {problem.value && <> — &ldquo;{problem.value}&rdquo;</>}: {problem.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 border-t border-line pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display text-sm text-ink">
            Your words{" "}
            <span className="text-muted">
              ({total} {total === 1 ? "word" : "words"})
            </span>
          </h3>

          {total > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={filter === undefined ? "primary" : "secondary"}
                onClick={() => setFilter(undefined)}
                ariaPressed={filter === undefined}
              >
                All
              </Button>
              {PICTIONARY_TIERS.map((entry) => (
                <Button
                  key={entry}
                  size="sm"
                  variant={filter === entry ? "primary" : "secondary"}
                  onClick={() => setFilter(entry)}
                  ariaPressed={filter === entry}
                >
                  {TIER_LABEL[entry]} ({counts[entry]})
                </Button>
              ))}
              <Button size="sm" variant="danger" onClick={clearAll}>
                Remove {filter ? TIER_LABEL[filter].toLowerCase() : "all"}
              </Button>
            </div>
          )}
        </div>

        {total === 0 ? (
          <p className="mt-2 text-sm text-muted">
            You haven&rsquo;t added any yet. Games will use the built-in list until you do.
          </p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {shown.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center gap-2 rounded-full border border-line bg-paper py-1 pl-3 pr-1 text-sm"
              >
                <span className="text-ink">{entry.word}</span>
                <span className="text-xs text-muted">{TIER_LABEL[entry.tier]}</span>
                <button
                  type="button"
                  onClick={() => removeOne(entry.id)}
                  aria-label={`Remove ${entry.word}`}
                  title={`Remove ${entry.word}`}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-muted transition-colors hover:bg-brass-soft hover:text-brass-dark"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
