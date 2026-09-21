"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import type { JournalLocationInput } from "./journal-actions";
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

  function addDraft() {
    if (!draft) return;
    onChange([
      ...value,
      { latitude: draft.latitude, longitude: draft.longitude, locationName: draft.name },
    ]);
    setDraft(null);
  }

  function addFromLibrary(location: JournalLocationInput) {
    onChange([...value, location]);
  }

  function removeLocation(index: number) {
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
                {/* Says where this one came from, because the two are not
                    interchangeable later: a saved place can be looked up and
                    corrected in the manager, a dropped pin cannot. */}
                {location.savedLocationId !== undefined && (
                  <span className="ml-2 rounded-full border border-line px-2 py-0.5 text-xs text-muted">
                    saved
                  </span>
                )}
              </span>
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
          <JournalLocationField value={draft} onChange={setDraft} />
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
    </div>
  );
}
