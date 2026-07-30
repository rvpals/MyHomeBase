"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import type { JournalPreferences } from "@/lib/journal";
import {
  createJournalEntryAction,
  fetchWeatherAction,
  type EntryWeatherInput,
  type JournalLocationInput,
} from "./journal-actions";
import { JournalLocationPicker } from "./journal-location-picker";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

// Local calendar date as YYYY-MM-DD (not UTC), so the default matches the user's day.
function todayIso(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const emptyForm = (date: string) => ({
  date,
  time: "",
  title: "",
  placeName: "",
  categoriesText: "",
  tagsText: "",
  content: "",
});

export function JournalEntryForm({
  categoryOptions,
  tagOptions,
  preferences,
}: {
  categoryOptions: string[];
  tagOptions: string[];
  preferences: JournalPreferences;
}) {
  const router = useRouter();
  const [form, setForm] = useState(() => emptyForm(todayIso()));
  const [locations, setLocations] = useState<JournalLocationInput[]>([]);
  const [weather, setWeather] = useState<EntryWeatherInput | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);
  const [isFetchingWeather, setIsFetchingWeather] = useState(false);

  function update(field: keyof ReturnType<typeof emptyForm>, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function reset() {
    setForm(emptyForm(todayIso()));
    setLocations([]);
    setWeather(null);
  }

  // Weather is fetched for the first picked location if there is one, otherwise
  // the default location from preferences.
  async function handleFetchWeather() {
    const source = locations[0] ?? preferences.defaultLocation;
    if (!source) {
      setError("Pick a location above, or set a default location in Preferences, to fetch weather.");
      return;
    }
    setIsFetchingWeather(true);
    setError(undefined);
    try {
      const result = await fetchWeatherAction(source.latitude, source.longitude, preferences.temperatureUnit);
      if (!result.ok || !result.weather) {
        setError(result.error ?? "Failed to fetch weather.");
        return;
      }
      const { temperature, unit, description, code } = result.weather;
      setWeather({ temp: temperature, unit, description, code });
    } finally {
      setIsFetchingWeather(false);
    }
  }

  async function handleSave() {
    setIsBusy(true);
    setError(undefined);
    try {
      const result = await createJournalEntryAction({ ...form, locations, weather: weather ?? undefined });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      reset(); // ready for the next entry
      router.refresh(); // re-fetch the recent-entries list on the server
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Write a new entry. Categories and tags are created automatically if they&apos;re new.
      </p>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Date</span>
          <input type="date" value={form.date} onChange={(event) => update("date", event.target.value)} className={INPUT_CLASS} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Time</span>
          <input type="time" step={1} value={form.time} onChange={(event) => update("time", event.target.value)} className={INPUT_CLASS} />
        </label>

        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-ink">Title</span>
          <input type="text" value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="A short headline for the entry" className={INPUT_CLASS} />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Place name</span>
          <input type="text" value={form.placeName} onChange={(event) => update("placeName", event.target.value)} placeholder="e.g. Princeton University" className={INPUT_CLASS} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Categories</span>
          <input type="text" list="journal-category-options" value={form.categoriesText} onChange={(event) => update("categoriesText", event.target.value)} placeholder="FAMILY, PERSONAL" className={INPUT_CLASS} />
          <span className="mt-1 block text-xs text-muted">Comma-separated</span>
        </label>

        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-ink">Tags</span>
          <input type="text" list="journal-tag-options" value={form.tagsText} onChange={(event) => update("tagsText", event.target.value)} placeholder="Trinity Milestone Museum" className={INPUT_CLASS} />
          <span className="mt-1 block text-xs text-muted">Space-separated</span>
        </label>

        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-ink">Content</span>
          <textarea value={form.content} onChange={(event) => update("content", event.target.value)} placeholder="What happened today…" rows={6} className={`${INPUT_CLASS} resize-y`} />
        </label>
      </div>

      <JournalLocationPicker value={locations} onChange={setLocations} />

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" onClick={handleFetchWeather} disabled={isFetchingWeather}>
          {isFetchingWeather ? "Fetching…" : "Fetch today's weather"}
        </Button>
        {weather ? (
          <span className="text-sm text-ink">
            {weather.temp}
            {weather.unit} · {weather.description}
            <button
              type="button"
              onClick={() => setWeather(null)}
              aria-label="Clear weather"
              className="ml-2 text-muted hover:text-red-400"
            >
              &times;
            </button>
          </span>
        ) : (
          <span className="text-xs text-muted">Uses this entry&apos;s first location, or your default location.</span>
        )}
      </div>

      <datalist id="journal-category-options">
        {categoryOptions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <datalist id="journal-tag-options">
        {tagOptions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={isBusy || form.date === ""}>
          {isBusy ? "Saving…" : "Save entry"}
        </Button>
        <Button variant="secondary" onClick={reset} disabled={isBusy}>
          Clear
        </Button>
      </div>
    </div>
  );
}
