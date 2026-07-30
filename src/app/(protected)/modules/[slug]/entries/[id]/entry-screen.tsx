"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { JournalEntryCard } from "@/components/journal-entry-card";
import type { EntryLocation, JournalEntry, JournalEntryNeighbors } from "@/lib/journal";
import {
  deleteJournalEntryAction,
  setEntryLockAction,
} from "../../journal-actions";
import { JournalEntryEditForm } from "./entry-edit-form";

const JOURNAL_MODULE_PATH = "/modules/journal";

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

// Route-local adapter: wires the reusable JournalEntryCard's events to the
// journal server actions and handles navigation after a delete.
export function JournalEntryScreen({
  entry,
  neighbors,
}: {
  entry: JournalEntry;
  neighbors: JournalEntryNeighbors;
}) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [mapLocation, setMapLocation] = useState<EntryLocation | undefined>(undefined);
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

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Link href={JOURNAL_MODULE_PATH} className="text-sm text-brass-dark hover:underline">
          &larr; Back to My Journal
        </Link>
        <div className="flex items-center gap-2">
          {/* With no neighbour, href is undefined so Button renders a real
              disabled <button> (its base classes dim it and block clicks). */}
          <Button size="sm" variant="secondary" href={previousHref} disabled={!previousHref}>
            &larr; Previous
          </Button>
          <Button size="sm" variant="secondary" href={nextHref} disabled={!nextHref}>
            Next &rarr;
          </Button>
        </div>
      </div>

      <p className="no-print text-xs text-muted">
        {neighbors.previous ? `Previous (older): ${neighbors.previous.date}` : "This is the oldest entry."}
        {" · "}
        {neighbors.next ? `Next (newer): ${neighbors.next.date}` : "This is the newest entry."}
      </p>

      {error && <p className="no-print text-sm text-red-400">{error}</p>}

      {isEditing ? (
        <JournalEntryEditForm
          entry={entry}
          onCancel={() => setIsEditing(false)}
          onSaved={() => {
            setIsEditing(false);
            router.refresh(); // pull the saved entry back from the server
          }}
        />
      ) : (
        <JournalEntryCard
          entry={entry}
          onPrint={() => window.print()}
          onEdit={() => setIsEditing(true)}
          onShowLocation={setMapLocation}
          onToggleLock={handleToggleLock}
          onDelete={handleDelete}
          isBusy={isBusy}
        />
      )}

      {mapLocation && !isEditing && (
        <div className="no-print rounded-xl border border-line bg-paper-raised p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-ink">
              {mapLocation.locationName !== "" && <span className="mr-2">{mapLocation.locationName}</span>}
              <span className="font-mono text-xs text-muted">
                {mapLocation.latitude.toFixed(5)}, {mapLocation.longitude.toFixed(5)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-muted">Open in:</span>
              <a
                href={openStreetMapUrl(mapLocation)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-brass-dark hover:underline"
              >
                OpenStreetMap
              </a>
              <a
                href={googleMapsUrl(mapLocation)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-brass-dark hover:underline"
              >
                Google Maps
              </a>
              <Button size="sm" variant="secondary" onClick={() => setMapLocation(undefined)}>
                Close map
              </Button>
            </div>
          </div>
          <JournalLocationMap
            // `key` remounts the map when a different pin is chosen, so it
            // recenters even though the component holds its own Leaflet state.
            key={mapLocation.id}
            marker={{ latitude: mapLocation.latitude, longitude: mapLocation.longitude }}
            center={{ latitude: mapLocation.latitude, longitude: mapLocation.longitude }}
          />
        </div>
      )}
    </div>
  );
}
