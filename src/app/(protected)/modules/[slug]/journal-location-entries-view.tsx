"use client";

// "Entries at <place>": the Location Manager's popup behind a row's usage count.
//
// The library is the *source* an entry copies from, so the count on each row is
// the only trace of what a place is actually used for. This turns that number
// back into the entries themselves, each a link to the entry it names.
//
// Read-only on purpose. Correcting a place is the row's pencil, and deleting one
// already warns with the same count — nothing here writes.
//
// Route-local rather than registered: only the Journal has a location library,
// the same call as `journal-location-dedup-view.tsx` next door.

import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import type { EntryUsingLocation, SavedLocationWithUsage } from "@/lib/journal-locations";
import { listEntriesUsingLocationAction } from "./journal-locations-actions";

/**
 * What to show where the title goes.
 *
 * An encrypted entry's title column reads as `""` (migration 0131) — the same
 * value an entry genuinely left untitled has — so the flag is the only thing
 * that tells the two apart, and they deserve different words.
 */
function titleLabel(entry: EntryUsingLocation): { text: string; isPlaceholder: boolean } {
  if (entry.isEncrypted) return { text: "🔒 Encrypted", isPlaceholder: true };
  if (entry.title.trim() === "") return { text: "(untitled)", isPlaceholder: true };
  return { text: entry.title, isPlaceholder: false };
}

export function JournalLocationEntriesModal({
  location,
  onClose,
}: {
  location: SavedLocationWithUsage;
  onClose: () => void;
}) {
  // `undefined` while the first read runs, so the empty state doesn't flash.
  const [entries, setEntries] = useState<EntryUsingLocation[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const result = await listEntriesUsingLocationAction(location.id);
      if (cancelled) return;
      if (result.ok) setEntries(result.entries ?? []);
      else setError(result.error);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [location.id]);

  const placeName = location.name || "this place";

  /**
   * Said only when the two numbers differ, which happens when an entry visited
   * this place more than once: the row counts location rows, this list counts
   * entries. Explaining it in words beats letting "3×" sit above two rows.
   */
  const countNote =
    entries && entries.length !== location.usageCount
      ? ` from ${location.usageCount} location${location.usageCount === 1 ? "" : "s"} on them`
      : "";

  return (
    <Modal onClose={onClose} size="lg" title={`Entries at "${placeName}"`}>
      <div className="flex flex-col gap-3">
        {error && <p className="text-sm text-red-400">{error}</p>}

        {entries === undefined && !error && <p className="text-sm text-muted">Loading…</p>}

        {entries && entries.length === 0 && (
          <p className="text-sm text-muted">
            No journal entries point at this place. Entries written before it was added keep
            their own coordinates — use “Create locations from existing journal entries” to
            pull those in.
          </p>
        )}

        {entries && entries.length > 0 && (
          <>
            <p className="text-sm text-muted">
              {entries.length} {entries.length === 1 ? "entry" : "entries"}
              {countNote}, newest first.
            </p>

            <ul className="flex flex-col gap-1">
              {entries.map((entry) => {
                const label = titleLabel(entry);
                return (
                  <li key={entry.entryId}>
                    {/* The whole row is the link: the reader's intent here is
                        always "open that entry", so a separate affordance would
                        just be a smaller target for the same act. */}
                    <a
                      href={`/modules/journal/entries/${entry.entryId}`}
                      className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-md border border-line bg-paper px-3 py-1.5 text-sm hover:border-brass max-lg:flex-col"
                    >
                      <span className="shrink-0 font-mono text-xs text-muted">
                        {entry.entryDate}
                        {entry.entryTime && ` ${entry.entryTime}`}
                      </span>
                      <span
                        className={`min-w-0 flex-1 font-medium ${
                          label.isPlaceholder ? "text-muted" : "text-ink"
                        }`}
                      >
                        {label.text}
                      </span>
                      {entry.placeName && (
                        <span className="truncate text-xs text-muted">{entry.placeName}</span>
                      )}
                      {/* Only when it isn't 1: "1 stop" on every row would be
                          noise, and the interesting case is the repeat visit. */}
                      {entry.locationCount > 1 && (
                        <span className="shrink-0 font-mono text-xs text-muted">
                          {entry.locationCount} stops
                        </span>
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
