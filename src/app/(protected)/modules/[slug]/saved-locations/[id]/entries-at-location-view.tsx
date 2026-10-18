"use client";

// The entries written at one saved place — the screen behind the `#n` badge in
// Journal → Saved Locations.
//
// Presentational: the server resolves the place and the entries, this draws
// them. It edits nothing, so it has no actions and no busy state.

import Link from "next/link";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import type { JournalEntry } from "@/lib/journal";
import type { SavedLocation } from "@/lib/sys-locations";

export interface EntriesAtLocationViewProps {
  /**
   * The saved place, or undefined when it no longer exists.
   *
   * Undefined is an ordinary state, not an error: there is no foreign key
   * (migration 0151), so deleting a place leaves its entries pointing at a row
   * that is gone. The entries are still perfectly readable — every field they
   * show is their own copy — so this renders them under a heading that says the
   * place is gone rather than 404ing them out of reach.
   */
  place?: SavedLocation;
  /** Every entry with a pin at that place, newest first. */
  entries: JournalEntry[];
  /** Where an entry lives, e.g. `/modules/journal/entries`. */
  entryBasePath: string;
  /** Back to the list of saved places. */
  backHref: string;
}

/** An encrypted entry's title column is blank — say so rather than show nothing. */
function titleOf(entry: JournalEntry): string {
  if (entry.isEncrypted) return "(encrypted)";
  return entry.title.trim() || "(untitled)";
}

export function EntriesAtLocationView({
  place,
  entries,
  entryBasePath,
  backHref,
}: EntriesAtLocationViewProps) {
  const columns: DataGridColumn<JournalEntry>[] = [
    {
      key: "date",
      header: "Date",
      render: (entry) => (
        <Link
          href={`${entryBasePath}/${entry.id}`}
          className="text-ink hover:text-brass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        >
          {entry.date}
        </Link>
      ),
      value: (entry) => entry.date,
    },
    {
      key: "time",
      header: "Time",
      render: (entry) => entry.time || "—",
      value: (entry) => entry.time,
    },
    {
      key: "title",
      header: "Title",
      render: (entry) => (
        <Link
          href={`${entryBasePath}/${entry.id}`}
          className="text-ink hover:text-brass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        >
          {titleOf(entry)}
        </Link>
      ),
      value: (entry) => titleOf(entry),
    },
    {
      key: "categories",
      header: "Categories",
      render: (entry) => entry.categories.join(", ") || "—",
      value: (entry) => entry.categories.join(", "),
    },
    {
      key: "tags",
      header: "Tags",
      render: (entry) => entry.tags.join(", ") || "—",
      value: (entry) => entry.tags.join(", "),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          href={backHref}
          className="text-sm text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        >
          ← All saved locations
        </Link>
      </div>

      {place ? (
        <div>
          <h2 className="font-display text-xl font-semibold text-ink">
            {place.name.trim() || "Unnamed place"}
          </h2>
          {place.address && <p className="mt-1 text-sm text-muted">{place.address}</p>}
        </div>
      ) : (
        <div>
          <h2 className="font-display text-xl font-semibold text-ink">
            A place no longer in your saved locations
          </h2>
          <p className="mt-1 text-sm text-muted">
            This place has been deleted from the location database. The entries below still
            record where you were — each keeps its own copy of the name, address and
            coordinates.
          </p>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="rounded-md border border-dashed border-line p-6 text-center text-sm text-muted">
          No entries are linked to this place yet.
        </p>
      ) : (
        <DataGrid
          rows={entries}
          columns={columns}
          getRowKey={(entry) => entry.id}
        />
      )}
    </div>
  );
}
