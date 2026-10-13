"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import { isDuplicateLocation } from "@/lib/sys-locations";
import {
  createLibraryLocationAction,
  findLocationsAtPointAction,
  reverseGeocodeAction,
  saveLibraryTaxonomyAction,
  type JournalLocationInput,
} from "./journal-actions";
import {
  EditSavedLocationModal,
  type EditLocationActions,
} from "@/app/(protected)/admin/locations/manager/view";
import { JournalLocationField, type PickedLocation } from "./journal-location-field";
import { JournalLocationLibraryPicker } from "./journal-location-library-picker";

function formatCoords(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

/**
 * Where a location comes from: searched/dropped on the map, or picked out of
 * the saved-location library.
 *
 * Two tabs rather than both panels stacked. They are alternative answers to the
 * same question ("which point?"), and the map picker is tall enough that
 * showing it above the library list would push the library off the screen on a
 * phone every time.
 */
type Source = "map" | "library";

const TAB_CLASS = "rounded-md px-3 py-1.5 text-sm transition-colors";

/**
 * The entry form's bundle for the location editor: the same use-cases the Admin
 * screens call, behind `requireModuleAccess("journal")` instead of
 * `requireAdmin()`, so saving a place does not require an admin account.
 *
 * No `update` — this popup only ever creates from here. Omitting it means an
 * edit cannot be reached by accident rather than failing at the call.
 *
 * Module-level so its identity is stable across renders.
 */
const ENTRY_EDIT_LOCATION_ACTIONS: EditLocationActions = {
  create: createLibraryLocationAction,
  findAtPoint: findLocationsAtPointAction,
  reverseGeocode: reverseGeocodeAction,
  saveTaxonomy: (kind, input) => saveLibraryTaxonomyAction(kind, input),
};

// Collects several locations for an entry: either pick a "draft" point on the
// map and append it with "Add location", or add one straight from the saved
// location library. Emits the list to the form.
export function JournalLocationPicker({
  value,
  onChange,
  libraryCategoryOptions = [],
  libraryTagOptions = [],
}: {
  value: JournalLocationInput[];
  onChange: (next: JournalLocationInput[]) => void;
  /** Filter chips for the library tab. Empty is fine — the chips just don't show. */
  libraryCategoryOptions?: string[];
  libraryTagOptions?: string[];
}) {
  const [draft, setDraft] = useState<PickedLocation | null>(null);
  const [source, setSource] = useState<Source>("map");
  // Set when an add was refused as a duplicate, cleared by the next successful
  // add or removal. A message rather than a disabled button: on the library tab
  // a row click *is* the add, so there is nothing to disable there, and one
  // mechanism for both tabs beats two.
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);
  // Which rows have been pushed to the shared library this session, by index,
  // and which one is in flight. Index rather than id: an entry location has no
  // id until the entry is saved, and the list is short and stable while open.
  //
  // Not persisted: reopening the form forgets, which is the honest state —
  // nothing links an entry pin to a library row (migration 0141), so the form
  // cannot know whether a place is already there.
  const [savedToLibrary, setSavedToLibrary] = useState<Set<number>>(new Set());
  /** The row whose "+" opened the location editor, or null when it is closed. */
  const [addingIndex, setAddingIndex] = useState<number | null>(null);

  function addDraft() {
    if (!draft) return;
    const candidate = {
      latitude: draft.latitude,
      longitude: draft.longitude,
      locationName: draft.name,
      // Saved only when the lookup actually produced one — a hand-dropped pin
      // with no answer stays address-less rather than storing a blank.
      streetAddress: draft.streetAddress?.trim() || undefined,
    };
    // Coordinates decide it, not the name — see `isDuplicateLocation`. The draft
    // is deliberately left in place so it is obvious nothing was lost.
    if (isDuplicateLocation(value, candidate)) {
      setDuplicateNotice("That location is already on this entry.");
      return;
    }
    onChange([...value, candidate]);
    setDuplicateNotice(null);
    setDraft(null);
  }

  function addFromLibrary(location: JournalLocationInput) {
    if (isDuplicateLocation(value, location)) {
      setDuplicateNotice(
        `${location.locationName || "That location"} is already on this entry.`,
      );
      return;
    }
    onChange([...value, location]);
    setDuplicateNotice(null);
  }

  function removeLocation(index: number) {
    // Clears the notice too: the row it complained about may be the one going.
    setDuplicateNotice(null);
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="block text-sm font-medium text-ink">Location(s)</span>

      {value.length > 0 && (
        <ul className="flex flex-col gap-1">
          {value.map((location, index) => (
            <li
              key={`${location.latitude},${location.longitude},${index}`}
              className="flex items-center gap-2 rounded-md border border-line bg-paper px-3 py-1.5 text-sm"
            >
              <span className="flex-1 text-ink">
                {location.locationName || <span className="text-muted">(no name)</span>}
                <span className="ml-2 font-mono text-xs text-muted">
                  {formatCoords(location.latitude, location.longitude)}
                </span>
                {location.streetAddress && (
                  <span className="mt-0.5 block text-xs text-muted">
                    {location.streetAddress}
                  </span>
                )}
              </span>
              {/* Saves this pin into the shared library. A tick once it is in,
                  rather than hiding the control: the row stays the same shape,
                  and the state is only "this session added it" — nothing links
                  a pin to a library row, so it cannot claim more than that. */}
              <button
                type="button"
                onClick={() => setAddingIndex(index)}
                disabled={savedToLibrary.has(index)}
                aria-label={
                  savedToLibrary.has(index)
                    ? `"${location.locationName || "This location"}" was added to the location library`
                    : `Add "${location.locationName || "this location"}" to the location library`
                }
                title={
                  savedToLibrary.has(index)
                    ? "Added to the location library"
                    : "Add to the location library"
                }
                className="shrink-0 rounded-md border border-line px-2 py-0.5 text-sm text-muted transition-colors enabled:hover:border-brass enabled:hover:text-brass disabled:cursor-default disabled:opacity-40"
              >
                {savedToLibrary.has(index) ? "✓" : "+"}
              </button>
              <button
                type="button"
                onClick={() => removeLocation(index)}
                aria-label="Remove location"
                className="text-muted hover:text-red-400"
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Above the tabs, so it is in the same place whichever tab refused the
          add. `role="status"` announces it without stealing focus from the
          form. */}
      {duplicateNotice && (
        <p role="status" className="text-sm text-red-400">
          {duplicateNotice}
        </p>
      )}

      <div className="flex gap-1 rounded-md border border-line bg-paper p-1">
        <button
          type="button"
          onClick={() => setSource("map")}
          aria-pressed={source === "map"}
          className={`${TAB_CLASS} ${source === "map" ? "bg-brass-soft text-ink" : "text-muted hover:text-ink"}`}
        >
          Search or map
        </button>
        <button
          type="button"
          onClick={() => setSource("library")}
          aria-pressed={source === "library"}
          className={`${TAB_CLASS} ${source === "library" ? "bg-brass-soft text-ink" : "text-muted hover:text-ink"}`}
        >
          From location database
        </button>
      </div>

      {source === "map" ? (
        <>
          <JournalLocationField value={draft} onChange={setDraft} showAddress />
          {draft && (
            <div>
              <Button size="sm" onClick={addDraft}>
                Add location
              </Button>
            </div>
          )}
        </>
      ) : (
        // No "Add" step here, unlike the map tab: clicking a row in the library
        // *is* the choice, and there is no draft to refine first.
        <JournalLocationLibraryPicker
          categoryOptions={libraryCategoryOptions}
          tagOptions={libraryTagOptions}
          onPick={addFromLibrary}
        />
      )}

      {/* The same editor the Location Manager uses, prefilled from the pin, so
          a place saved from an entry gets a name, a description and its labels
          rather than landing bare. It writes to the library only — the entry's
          own pin is untouched either way. */}
      {addingIndex !== null && value[addingIndex] && (
        <EditSavedLocationModal
          initial={{
            name: value[addingIndex].locationName,
            latitude: value[addingIndex].latitude,
            longitude: value[addingIndex].longitude,
            address: value[addingIndex].streetAddress,
          }}
          categoryOptions={libraryCategoryOptions}
          tagOptions={libraryTagOptions}
          categoryIcons={{}}
          tagIcons={{}}
          onClose={() => setAddingIndex(null)}
          onSaved={() =>
            setSavedToLibrary((previous) => new Set(previous).add(addingIndex))
          }
          actions={ENTRY_EDIT_LOCATION_ACTIONS}
        />
      )}
    </div>
  );
}
