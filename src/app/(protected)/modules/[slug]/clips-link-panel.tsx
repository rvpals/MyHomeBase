"use client";

// "Attached to" — the journal entries a clip supports, plus the picker that
// attaches another.
//
// Route-local presentation. It renders inside the clip viewer, and it is the only
// place in the browser where a link is created or removed.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/button";
import type { ResolvedClipLink } from "@/lib/clips";
import {
  linkClipAction,
  listClipLinksAction,
  searchJournalEntriesForClipAction,
  unlinkClipAction,
  type JournalEntryRef,
} from "./clips-actions";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export function ClipsLinkPanel({ clipId }: { clipId: number }) {
  const [links, setLinks] = useState<ResolvedClipLink[]>([]);
  const [picking, setPicking] = useState(false);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<JournalEntryRef[]>([]);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    const result = await listClipLinksAction(clipId);
    if (result.ok && result.links) setLinks(result.links);
    else setError(result.error ?? "Could not load this clip's links.");
  }, [clipId]);

  useEffect(() => {
    let cancelled = false;
    void listClipLinksAction(clipId).then((result) => {
      if (cancelled) return;
      if (result.ok && result.links) setLinks(result.links);
      else setError(result.error ?? "Could not load this clip's links.");
    });
    return () => {
      cancelled = true;
    };
  }, [clipId]);

  // Runs whenever the picker opens or the term changes, including on a blank term
  // — which lists the most recent entries rather than nothing, because the entry
  // someone wants is usually the one they just wrote.
  useEffect(() => {
    if (!picking) return;
    let cancelled = false;

    void searchJournalEntriesForClipAction(term).then((result) => {
      if (cancelled) return;
      if (result.ok && result.entries) setResults(result.entries);
      else setError(result.error ?? "Could not search the journal.");
    });

    return () => {
      cancelled = true;
    };
  }, [picking, term]);

  async function attach(entryId: number) {
    setError("");
    const result = await linkClipAction(clipId, entryId);
    if (!result.ok) {
      setError(result.error ?? "Could not attach that clip.");
      return;
    }
    setPicking(false);
    setTerm("");
    await reload();
  }

  async function detach(linkId: number) {
    setError("");
    const result = await unlinkClipAction(linkId);
    if (!result.ok) {
      setError(result.error ?? "Could not detach that clip.");
      return;
    }
    await reload();
  }

  const attachedIds = new Set(links.map((link) => link.targetId));

  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-ink">Attached to</h3>
        <Button variant="secondary" onClick={() => setPicking((open) => !open)}>
          {picking ? "Done" : "Attach to an entry"}
        </Button>
      </div>

      {error && <p className="mb-2 text-sm text-danger">{error}</p>}

      {links.length === 0 ? (
        <p className="text-sm text-muted">Not attached to anything. This clip stands on its own.</p>
      ) : (
        <ul className="space-y-1">
          {links.map((link) => (
            <li key={link.id} className="flex items-center justify-between gap-2 text-sm">
              {link.targetHref ? (
                <Link href={link.targetHref} className="text-ink underline hover:text-brass-dark">
                  {link.targetTitle}
                </Link>
              ) : (
                // Shown, not hidden: a clip attached to a deleted entry is still
                // attached, and hiding the row would make it look unattached. The
                // clip itself is never touched by that deletion — that is the
                // module's central promise.
                <span className="text-muted italic">The linked entry is gone.</span>
              )}
              <button
                type="button"
                onClick={() => detach(link.id)}
                className="shrink-0 text-xs text-muted hover:text-danger"
                aria-label="Detach"
              >
                Detach
              </button>
            </li>
          ))}
        </ul>
      )}

      {picking && (
        <div className="mt-3 space-y-2">
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search entries, or pick a recent one"
            className={INPUT_CLASS}
          />

          {results.length === 0 ? (
            <p className="text-sm text-muted">No entries match.</p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {results.map((entry) => {
                const already = attachedIds.has(entry.id);
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      // Attaching twice is harmless — the unique index makes it a
                      // no-op — but offering it reads as if nothing happened, so
                      // the row says so instead.
                      disabled={already}
                      onClick={() => attach(entry.id)}
                      className="w-full rounded border border-line px-2 py-1.5 text-left text-sm text-ink hover:border-brass disabled:opacity-50 disabled:hover:border-line"
                    >
                      <span className="text-muted">{entry.date}</span>{" "}
                      {entry.title || "(untitled)"}
                      {already && <span className="ml-1 text-xs text-muted">— attached</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
