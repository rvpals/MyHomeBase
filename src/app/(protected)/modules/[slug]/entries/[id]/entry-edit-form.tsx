"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import { TokenPicker } from "@/components/token-picker";
import type { JournalEntry } from "@/lib/journal";
import {
  updateEncryptedJournalEntryAction,
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
  encryptionPassword,
  categoryOptions,
  tagOptions,
  locationCategoryOptions = [],
  locationTagOptions = [],
  onCancel,
  onSaved,
}: {
  /**
   * The entry to edit. For an encrypted entry this carries the **decrypted**
   * title and content, spliced in by `entry-screen.tsx` — so the fields below
   * show real text while the stored row stays sealed.
   */
  entry: JournalEntry;
  /**
   * The password that opened this entry, when it is encrypted and unlocked.
   *
   * Held only for the lifetime of the screen above and passed straight back to
   * the action on save; it is never stored here. Undefined for an ordinary
   * entry, and `handleSave` refuses to save an encrypted entry without it rather
   * than falling through to the plaintext path.
   */
  encryptionPassword?: string;
  /** Every known category name, for the picker's dropdown. */
  categoryOptions: string[];
  /** Every known tag name, for the picker's dropdown. */
  tagOptions: string[];
  /** The saved-location library's taxonomy, for the location picker's chips. */
  locationCategoryOptions?: string[];
  locationTagOptions?: string[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(entry.date);
  const [time, setTime] = useState(entry.time);
  const [title, setTitle] = useState(entry.title);
  const [placeName, setPlaceName] = useState(entry.placeName);
  // Held as arrays, the shape the pickers and the action both speak.
  const [categories, setCategories] = useState<string[]>(entry.categories);
  const [tags, setTags] = useState<string[]>(entry.tags);
  const [content, setContent] = useState(entry.content);
  const [isPinned, setIsPinned] = useState(entry.isPinned);
  const [locations, setLocations] = useState<JournalLocationInput[]>(
    entry.locations.map((location) => ({
      latitude: location.latitude,
      longitude: location.longitude,
      locationName: location.locationName,
      // Carried through, because `updateEntry` rewrites the whole aggregate:
      // an edit that did not resubmit the address would silently clear it.
      streetAddress: location.streetAddress,
    })),
  );
  // Weather is edited as free text, not just kept or dropped. Held as three
  // separate strings rather than a Weather object because a half-typed
  // temperature ("-" or "") is not a number yet, and the field has to let the
  // user get there. They are folded back into a Weather on save.
  const [weatherTemp, setWeatherTemp] = useState(
    entry.weather ? String(entry.weather.temp) : "",
  );
  const [weatherUnit, setWeatherUnit] = useState(entry.weather?.unit ?? "");
  const [weatherDescription, setWeatherDescription] = useState(entry.weather?.description ?? "");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // The temperature is the anchor, matching the repository: an entry has weather
  // only when it has a temperature. Clearing the field removes the reading, so
  // the checkbox this replaced is no longer needed. A non-numeric temperature is
  // rejected on save rather than silently dropping the whole reading.
  const trimmedTemp = weatherTemp.trim();
  const parsedTemp = trimmedTemp === "" ? undefined : Number(trimmedTemp);
  const isTempValid = parsedTemp === undefined || Number.isFinite(parsedTemp);
  const typedWeather =
    parsedTemp === undefined || !Number.isFinite(parsedTemp)
      ? undefined
      : {
          temp: parsedTemp,
          unit: weatherUnit.trim(),
          description: weatherDescription.trim(),
          // Preserved only while this stays the reading that was fetched. Once
          // the numbers are typed over, the old WMO code would describe weather
          // that is no longer on the entry, so it goes back to 0 -- the same
          // value the repository reads back for a row that never had one.
          code:
            entry.weather &&
            parsedTemp === entry.weather.temp &&
            weatherUnit.trim() === entry.weather.unit &&
            weatherDescription.trim() === entry.weather.description
              ? entry.weather.code
              : 0,
        };

  async function handleSave() {
    if (!isTempValid) {
      setError("Temperature must be a number, or empty to record no weather.");
      return;
    }
    setIsBusy(true);
    setError(undefined);
    try {
      // An encrypted entry saves in two parts, because its text and its metadata
      // live in different columns and only the text needs the password.
      //
      // The text goes first: if the password is wrong the entry is left entirely
      // untouched, which is the safe order. The metadata save that follows runs
      // through the ordinary path, where the use-case carries the ciphertext
      // across unchanged and keeps the plaintext columns blank.
      if (entry.isEncrypted) {
        if (encryptionPassword === undefined) {
          setError("This entry is locked. Unlock it before saving.");
          return;
        }
        const encryptedResult = await updateEncryptedJournalEntryAction(
          entry.id,
          encryptionPassword,
          { title, content },
        );
        if (!encryptedResult.ok) {
          setError(encryptedResult.error);
          return;
        }
      }

      const result = await updateJournalEntryAction(entry.id, {
        date,
        time,
        title,
        content,
        placeName,
        categories,
        tags,
        locations,
        weather: typedWeather,
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
        <TokenPicker
          label="Categories"
          value={categories}
          onChange={setCategories}
          options={categoryOptions}
          allowCreate
          createPlaceholder="Filter or add a category…"
        />

        <TokenPicker
          className="sm:col-span-2"
          label="Tags"
          value={tags}
          onChange={setTags}
          options={tagOptions}
          allowCreate
          createPlaceholder="Filter or add a tag…"
        />

        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-ink">Content</span>
          <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={10} className={`${INPUT_CLASS} resize-y`} />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={isPinned} onChange={(event) => setIsPinned(event.target.checked)} />
        Pinned
      </label>

      {/* Typed by hand, because an entry written up later -- or one from a place
          the forecast API never covered -- still had weather. Three fields on one
          row on desktop; they stack on a phone, where a narrow temperature box
          beside a narrow description box would be unusable. */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-ink">Weather</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[6rem_6rem_1fr]">
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted">Temperature</span>
            <input
              type="text"
              inputMode="decimal"
              value={weatherTemp}
              onChange={(event) => setWeatherTemp(event.target.value)}
              placeholder="18"
              className={INPUT_CLASS}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted">Unit</span>
            <input
              type="text"
              value={weatherUnit}
              onChange={(event) => setWeatherUnit(event.target.value)}
              placeholder="°C"
              className={INPUT_CLASS}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted">Description</span>
            <input
              type="text"
              value={weatherDescription}
              onChange={(event) => setWeatherDescription(event.target.value)}
              placeholder="Light rain"
              className={INPUT_CLASS}
            />
          </label>
        </div>
        <p className="text-xs text-muted">
          Clear the temperature to record no weather for this entry.
        </p>
      </fieldset>

      <JournalLocationPicker
        value={locations}
        onChange={setLocations}
        libraryCategoryOptions={locationCategoryOptions}
        libraryTagOptions={locationTagOptions}
      />

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
