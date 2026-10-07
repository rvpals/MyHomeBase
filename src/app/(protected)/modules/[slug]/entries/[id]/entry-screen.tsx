"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { EncryptionPrompt } from "@/components/encryption-prompt";
import { JournalViewer } from "@/components/journal-viewer";
import type { EntryLocation, JournalEntry, JournalEntryNeighbors } from "@/lib/journal";
import {
  decryptJournalEntryAction,
  deleteJournalEntryAction,
  encryptJournalEntryAction,
  removeJournalEntryEncryptionAction,
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
const LocationMap = dynamic(
  () => import("@/components/location-map").then((module) => module.LocationMap),
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
  locationCategoryOptions = [],
  locationTagOptions = [],
}: {
  entry: JournalEntry;
  neighbors: JournalEntryNeighbors;
  categoryIcons?: Record<string, string>;
  tagIcons?: Record<string, string>;
  /** Every known category name — the edit form's picker offers these. */
  categoryOptions: string[];
  /** Every known tag name — the edit form's picker offers these. */
  tagOptions: string[];
  /** The saved-location library's taxonomy, for the edit form's location picker. */
  locationCategoryOptions?: string[];
  locationTagOptions?: string[];
}) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [mapView, setMapView] = useState<MapView | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  // --- encryption (migration 0131) -------------------------------------------
  //
  // This component owns the unlock, because it is the one thing above both the
  // viewer and the edit form. The password lives **here and nowhere else**: not
  // in a cookie, not in storage, not on the server between calls. Navigating
  // away unmounts this component and takes it with it, which is the whole of the
  // unlock lifetime — `NavTree` remounts on every navigation anyway.
  //
  // There is deliberately no idle timer: an unlock expiring mid-edit would throw
  // away writing in progress, which is worse than the exposure it prevents.
  const [password, setPassword] = useState<string | undefined>(undefined);
  const [openedText, setOpenedText] = useState<{ title: string; content: string } | undefined>(
    undefined,
  );
  const [encryptionError, setEncryptionError] = useState<string | undefined>(undefined);
  // Which prompt is on screen, when one is. `undefined` = none.
  const [prompt, setPrompt] = useState<"encrypt" | "remove" | undefined>(undefined);

  const isUnlocked = entry.isEncrypted && openedText !== undefined;

  async function handleUnlock(typed: string) {
    setIsBusy(true);
    setEncryptionError(undefined);
    try {
      const result = await decryptJournalEntryAction(entry.id, typed);
      if (!result.ok || !result.text) {
        setEncryptionError(result.error ?? "That password does not open this entry.");
        return;
      }
      setOpenedText(result.text);
      setPassword(typed);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleEncrypt(typed: string, hint: string) {
    setIsBusy(true);
    setEncryptionError(undefined);
    try {
      const result = await encryptJournalEntryAction(entry.id, typed, hint);
      if (!result.ok) {
        setEncryptionError(result.error);
        return;
      }
      // Not left unlocked: the reader just proved they know the password by
      // typing it twice, and leaving the plaintext on screen after sealing it
      // reads as if nothing happened.
      setPrompt(undefined);
      setOpenedText(undefined);
      setPassword(undefined);
      router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRemoveEncryption(typed: string) {
    setIsBusy(true);
    setEncryptionError(undefined);
    try {
      const result = await removeJournalEntryEncryptionAction(entry.id, typed);
      if (!result.ok) {
        setEncryptionError(result.error);
        return;
      }
      setPrompt(undefined);
      setOpenedText(undefined);
      setPassword(undefined);
      router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  /** Drops the decrypted text and the password without touching the entry. */
  function handleLock() {
    setOpenedText(undefined);
    setPassword(undefined);
    setEncryptionError(undefined);
    setIsEditing(false);
  }

  /**
   * The entry as the viewer and the edit form should see it.
   *
   * An unlocked entry is shown with its decrypted title and content spliced back
   * in. This object is **never** sent to `updateJournalEntryAction` — the edit
   * form routes an encrypted save through `updateEncryptedJournalEntryAction`
   * instead, and the use-case refuses to write plaintext over ciphertext even if
   * something slipped through.
   */
  const shownEntry: JournalEntry =
    isUnlocked && openedText
      ? { ...entry, title: openedText.title, content: openedText.content }
      : entry;

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
      {/* No "Back to My Journal" link: the page renders inside `JournalShell`
          now, so the module rail and the section panel are the way back. */}
      {error && <p className="no-print text-sm text-red-400">{error}</p>}

      {/* A sealed entry shows the prompt in place of its body. Rendered inline
          rather than as an overlay: nothing about an entry belongs on the
          floating layer, and the bottom edge is already the shared nav's. */}
      {entry.isEncrypted && !isUnlocked && (
        <EncryptionPrompt
          mode="unlock"
          hint={entry.passwordHint}
          error={encryptionError}
          isBusy={isBusy}
          onSubmit={(typed) => handleUnlock(typed)}
          className="no-print"
        />
      )}

      {/* Encrypting and removing encryption are dialogs, not inline cards: both
          are deliberate decisions with a consequence that cannot be undone, and
          a dialog stops the rest of the entry competing for attention while one
          is being made. The *unlock* prompt above stays inline on purpose --
          it sits where the body would be, so it reads as the entry being shut
          rather than as the app asking a question. */}
      {prompt === "encrypt" && (
        <EncryptionPrompt
          asModal
          mode="encrypt"
          error={encryptionError}
          isBusy={isBusy}
          onSubmit={handleEncrypt}
          onCancel={() => {
            setPrompt(undefined);
            setEncryptionError(undefined);
          }}
        />
      )}
      {prompt === "remove" && (
        <EncryptionPrompt
          asModal
          mode="confirm"
          hint={entry.passwordHint}
          error={encryptionError}
          isBusy={isBusy}
          onSubmit={(typed) => handleRemoveEncryption(typed)}
          onCancel={() => {
            setPrompt(undefined);
            setEncryptionError(undefined);
          }}
        />
      )}

      {entry.isEncrypted && !isUnlocked ? null : isEditing ? (
        <JournalEntryEditForm
          entry={shownEntry}
          encryptionPassword={password}
          categoryOptions={categoryOptions}
          tagOptions={tagOptions}
          locationCategoryOptions={locationCategoryOptions}
          locationTagOptions={locationTagOptions}
          onCancel={() => setIsEditing(false)}
          onSaved={() => {
            setIsEditing(false);
            router.refresh(); // pull the saved entry back from the server
          }}
        />
      ) : (
        <JournalViewer
          entry={shownEntry}
          isUnlocked={isUnlocked}
          onEncrypt={() => {
            setEncryptionError(undefined);
            setPrompt("encrypt");
          }}
          onRemoveEncryption={() => {
            setEncryptionError(undefined);
            setPrompt("remove");
          }}
          onLock={handleLock}
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
          <LocationMap
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
          <LocationMap
            // Numbered pins, fitted to the whole set. Taller than the
            // single-pin map because it has to hold several pins at once.
            markers={entry.locations.map((location, index) => ({
              latitude: location.latitude,
              longitude: location.longitude,
              number: index + 1,
              // Clicking a pin names it. An entry's locations carry no
              // categories or address, so the popup is the name and the
              // coordinates — which is all the table below holds too.
              label: location.locationName,
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
