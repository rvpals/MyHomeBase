"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import type { JournalEntry } from "@/lib/journal";
import {
  updateJournalEntryAction,
  type JournalLocationInput,
} from "../../journal-actions";
import { JournalLocationPicker } from "../../journal-location-picker";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

// Inline editor for one entry. Seeded from the current entry — including
// locations, weather, and pinned — because updateEntry replaces the whole
// aggregate, so anything not resubmitted would be dropped.
export function JournalEntryEditForm({
  entry,
  onCancel,
  onSaved,
}: {
  entry: JournalEntry;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(entry.date);
  const [time, setTime] = useState(entry.time);
  const [title, setTitle] = useState(entry.title);
  const [placeName, setPlaceName] = useState(entry.placeName);
  // Categories are comma-separated and tags whitespace-separated, matching the
  // delimiters the create form and the CSV importer use.
  const [categoriesText, setCategoriesText] = useState(entry.categories.join(", "));
  const [tagsText, setTagsText] = useState(entry.tags.join(" "));
  const [content, setContent] = useState(entry.content);
  const [isPinned, setIsPinned] = useState(entry.isPinned);
  const [locations, setLocations] = useState<JournalLocationInput[]>(
    entry.locations.map((location) => ({
      latitude: location.latitude,
      longitude: location.longitude,
      locationName: location.locationName,
    })),
  );
  const [removeWeather, setRemoveWeather] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleSave() {
    setIsBusy(true);
    setError(undefined);
    try {
      const result = await updateJournalEntryAction(entry.id, {
        date,
        time,
        title,
        content,
        placeName,
        categoriesText,
        tagsText,
        locations,
        // Carried through untouched unless the user asks to remove it.
        weather: removeWeather ? undefined : entry.weather,
        isPinned,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-paper-raised p-6">
      <h2 className="font-display text-xl text-ink">Edit entry</h2>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Date</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={INPUT_CLASS} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Time</span>
          <input type="time" step={1} value={time} onChange={(event) => setTime(event.target.value)} className={INPUT_CLASS} />
        </label>

        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-ink">Title</span>
          <input type="text" value={title} onChange={(event) => setTitle(event.target.value)} className={INPUT_CLASS} />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Place name</span>
          <input type="text" value={placeName} onChange={(event) => setPlaceName(event.target.value)} className={INPUT_CLASS} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Categories</span>
          <input type="text" value={categoriesText} onChange={(event) => setCategoriesText(event.target.value)} className={INPUT_CLASS} />
          <span className="mt-1 block text-xs text-muted">Comma-separated</span>
        </label>

        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-ink">Tags</span>
          <input type="text" value={tagsText} onChange={(event) => setTagsText(event.target.value)} className={INPUT_CLASS} />
          <span className="mt-1 block text-xs text-muted">Space-separated</span>
        </label>

        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-ink">Content</span>
          <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={10} className={`${INPUT_CLASS} resize-y`} />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={isPinned} onChange={(event) => setIsPinned(event.target.checked)} />
        Pinned
      </label>

      {entry.weather && (
        <label className="flex flex-wrap items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={removeWeather} onChange={(event) => setRemoveWeather(event.target.checked)} />
          Remove the recorded weather
          <span className="text-xs text-muted">
            (currently {entry.weather.temp}
            {entry.weather.unit} · {entry.weather.description})
          </span>
        </label>
      )}

      <JournalLocationPicker value={locations} onChange={setLocations} />

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={isBusy || date === ""}>
          {isBusy ? "Saving…" : "Save changes"}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={isBusy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
