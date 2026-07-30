"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import type { JournalLocationInput } from "./journal-actions";
import { JournalLocationField, type PickedLocation } from "./journal-location-field";

function formatCoords(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

// Collects several locations for an entry: a single-point field picks a "draft"
// point, which "Add location" appends to the list. Emits the list to the form.
export function JournalLocationPicker({
  value,
  onChange,
}: {
  value: JournalLocationInput[];
  onChange: (next: JournalLocationInput[]) => void;
}) {
  const [draft, setDraft] = useState<PickedLocation | null>(null);

  function addDraft() {
    if (!draft) return;
    onChange([
      ...value,
      { latitude: draft.latitude, longitude: draft.longitude, locationName: draft.name },
    ]);
    setDraft(null);
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

      <JournalLocationField value={draft} onChange={setDraft} />

      {draft && (
        <div>
          <Button size="sm" onClick={addDraft}>
            Add location
          </Button>
        </div>
      )}
    </div>
  );
}
