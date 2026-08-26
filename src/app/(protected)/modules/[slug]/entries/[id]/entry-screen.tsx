"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { JournalViewer } from "@/components/journal-viewer";
import type { EntryLocation, JournalEntry, JournalEntryNeighbors } from "@/lib/journal";
import {
  deleteJournalEntryAction,
  setEntryLockAction,
} from "../../journal-actions";
import { journalEntriesFilterHref } from "../../journal-shared";
import { JournalEntryEditForm } from "./entry-edit-form";
import { JournalPhotosCard } from "./journal-photos-card";

const JOURNAL_MODULE_PATH = "/modules/journal";

/**
 * Clicking a category or tag opens the Entries browser filtered to it — the same
 * `?filter=` link the Top Categories/Tags cards use, so both routes into a slice
 * produce one shareable URL rather than two.
 *
 * A name containing a comma can't be expressed in the query grammar (the comma
 * is its "any of" separator), and `journalEntriesFilterHref` degrades to an
 * *unfiltered* link for those. That's right for a card whose whole job is to
 * navigate, but wrong for a chip: a chip that silently shows every entry looks
 * like the filter worked. So those stay unclickable here.
 */
function taxonomyFilterHref(kind: "category" | "tag", name: string): string | undefined {
  return name.includes(",") ? undefined : journalEntriesFilterHref(kind, name);
}

// Leaflet touches `window`, so the map is client-only. Read-only here: no onPick.
const JournalLocationMap = dynamic(
  () => import("../../journal-location-map").then((module) => module.JournalLocationMap),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-64 place-items-center rounded-md border border-line text-sm text-muted">
        Loading map…
      </div>
    ),
  },
);

/** Deep link to the same point on openstreetmap.org, for directions or a bigger view. */
function openStreetMapUrl(location: EntryLocation): string {
  const { latitude, longitude } = location;
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=15/${latitude}/${longitude}`;
}

/**
 * Deep link to the same point on Google Maps. Uses the documented Maps URLs
 * form, which takes a plain coordinate query and needs no API key (unlike the
 * embedded JavaScript map, which is why the in-page map stays OpenStreetMap).
 */
function googleMapsUrl(location: EntryLocation): string {
  const { latitude, longitude } = location;
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

/**
 * Which map the panel below the viewer is showing: one chosen pin, or every
 * location on the entry at once. A single piece of state rather than two, so
 * the two modes can't both be open.
 */
type MapView = { kind: "one"; location: EntryLocation } | { kind: "all" };

// Route-local adapter: wires the reusable JournalViewer's events to the
// journal server actions and handles navigation after a delete.
export function JournalEntryScreen({
  entry,
  neighbors,
  categoryIcons,
  tagIcons,
  categoryOptions,
  tagOptions,
}: {
  entry: JournalEntry;
  neighbors: JournalEntryNeighbors;
  categoryIcons?: Record<string, string>;
  tagIcons?: Record<string, string>;
  /** Every known category name — the edit form's picker offers these. */
  categoryOptions: string[];
  /** Every known tag name — the edit form's picker offers these. */
  tagOptions: string[];
}) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [mapView, setMapView] = useState<MapView | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleToggleLock(nextLocked: boolean) {
    setIsBusy(true);
    setError(undefined);
    try {
      const result = await setEntryLockAction(entry.id, nextLocked);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDelete() {
    setIsBusy(true);
    setError(undefined);
    try {
      const result = await deleteJournalEntryAction(entry.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // The entry no longer exists, so return to the module rather than
      // re-rendering a deleted record.
      router.push(JOURNAL_MODULE_PATH);
    } finally {
      setIsBusy(false);
    }
  }

  // "Previous" is the older entry and "Next" the newer one — the same ordering
  // the entries list uses, so navigation matches the row you came from.
  const previousHref = neighbors.previous
    ? `${JOURNAL_MODULE_PATH}/entries/${neighbors.previous.id}`
    : undefined;
  const nextHref = neighbors.next ? `${JOURNAL_MODULE_PATH}/entries/${neighbors.next.id}` : undefined;

  // Deep link for the viewer's running-shoe icon: the Calendar section opened
  // on this entry's date. ?anchor= moves the grid to that day's month and
  // ?date= selects it beneath the grid; leaving ?scope= unset falls back to
  // the month view, so a link from any entry opens exactly its own month.
  const calendarHref = `${JOURNAL_MODULE_PATH}/calendar?anchor=${entry.date}&date=${entry.date}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print">
        <Link href={JOURNAL_MODULE_PATH} className="text-sm text-brass-dark hover:underline">
          &larr; Back to My Journal
        </Link>
      </div>

      {error && <p className="no-print text-sm text-red-400">{error}</p>}

      {isEditing ? (
        <JournalEntryEditForm
          entry={entry}
          categoryOptions={categoryOptions}
          tagOptions={tagOptions}
          onCancel={() => setIsEditing(false)}
          onSaved={() => {
            setIsEditing(false);
            router.refresh(); // pull the saved entry back from the server
          }}
        />
      ) : (
        <JournalViewer
          entry={entry}
          onPrint={() => window.print()}
          onEdit={() => setIsEditing(true)}
          onShowLocation={(location) => setMapView({ kind: "one", location })}
          onShowAllLocations={() => setMapView({ kind: "all" })}
          onToggleLock={handleToggleLock}
          onDelete={handleDelete}
          calendarHref={calendarHref}
          previousHref={previousHref}
          previousDate={neighbors.previous?.date}
          nextHref={nextHref}
          nextDate={neighbors.next?.date}
          categoryIcons={categoryIcons}
          tagIcons={tagIcons}
          categoryHref={(name) => taxonomyFilterHref("category", name)}
          tagHref={(name) => taxonomyFilterHref("tag", name)}
          photosSlot={<JournalPhotosCard date={entry.date} />}
          isBusy={isBusy}
        />
      )}

      {mapView?.kind === "one" && !isEditing && (
        <div className="no-print rounded-xl border border-line bg-paper-raised p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-ink">
              {mapView.location.locationName !== "" && (
                <span className="mr-2">{mapView.location.locationName}</span>
              )}
              <span className="font-mono text-xs text-muted">
                {mapView.location.latitude.toFixed(5)}, {mapView.location.longitude.toFixed(5)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-muted">Open in:</span>
              <a
                href={openStreetMapUrl(mapView.location)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-brass-dark hover:underline"
              >
                OpenStreetMap
              </a>
              <a
                href={googleMapsUrl(mapView.location)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-brass-dark hover:underline"
              >
                Google Maps
              </a>
              <Button size="sm" variant="secondary" onClick={() => setMapView(undefined)}>
                Close map
              </Button>
            </div>
          </div>
          <JournalLocationMap
            // `key` remounts the map when a different pin is chosen, so it
            // recenters even though the component holds its own Leaflet state.
            key={mapView.location.id}
            marker={{
              latitude: mapView.location.latitude,
              longitude: mapView.location.longitude,
            }}
            center={{
              latitude: mapView.location.latitude,
              longitude: mapView.location.longitude,
            }}
          />
        </div>
      )}

      {mapView?.kind === "all" && !isEditing && (
        <div className="no-print rounded-xl border border-line bg-paper-raised p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink">
              All locations{" "}
              <span className="font-normal text-muted">({entry.locations.length})</span>
            </h3>
            <Button size="sm" variant="secondary" onClick={() => setMapView(undefined)}>
              Close map
            </Button>
          </div>
          <JournalLocationMap
            // Numbered pins, fitted to the whole set. Taller than the
            // single-pin map because it has to hold several pins at once.
            markers={entry.locations.map((location, index) => ({
              latitude: location.latitude,
              longitude: location.longitude,
              number: index + 1,
            }))}
            marker={null}
            center={null}
            heightClassName="h-80 max-lg:h-64"
          />
          {/* The pin numbers spelled out, so every coordinate is readable as
              text and not only as a dot on the map. Scrolls sideways on a
              phone rather than squeezing the coordinate column. */}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[28rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th scope="col" className="w-12 py-2 pr-2 font-medium">
                    #
                  </th>
                  <th scope="col" className="py-2 pr-2 font-medium">
                    Coordinates
                  </th>
                  <th scope="col" className="py-2 pr-2 font-medium">
                    Name
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Open in
                  </th>
                </tr>
              </thead>
              <tbody>
                {entry.locations.map((location, index) => (
                  <tr key={location.id} className="border-b border-line/60 last:border-b-0">
                    <td className="py-2 pr-2 font-mono text-xs font-semibold text-brass-dark">
                      #{index + 1}
                    </td>
                    <td className="py-2 pr-2 font-mono text-xs text-muted">
                      {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
                    </td>
                    <td className="py-2 pr-2 text-ink">
                      {location.locationName !== "" ? location.locationName : "—"}
                    </td>
                    <td className="flex flex-wrap gap-3 py-2">
                      <a
                        href={openStreetMapUrl(location)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-brass-dark hover:underline"
                      >
                        OSM
                      </a>
                      <a
                        href={googleMapsUrl(location)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-brass-dark hover:underline"
                      >
                        Google
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
