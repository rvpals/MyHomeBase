"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { TokenPicker } from "@/components/token-picker";
import { useCurrentPosition } from "@/components/use-current-position";
import {
  applyPrefillTemplate,
  type JournalPreferences,
  type JournalPrefillFormValues,
  type JournalPrefillTemplate,
} from "@/lib/journal";
import {
  createJournalEntryAction,
  fetchWeatherAction,
  reverseGeocodeAction,
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

/**
 * Splits a prefill template's delimited text into names. Templates predate the
 * pickers and still store "FAMILY, PERSONAL" as one string, so a template's
 * value has to be broken up before it can become chips. A name the template
 * carries that no longer exists as a category/tag still becomes a chip and gets
 * registered on save — the same thing typing it would have done.
 */
function splitNames(text: string, separator: string | RegExp): string[] {
  const seen = new Set<string>();
  return text
    .split(separator)
    .map((name) => name.trim())
    .filter((name) => {
      if (name === "" || seen.has(name.toLowerCase())) return false;
      seen.add(name.toLowerCase());
      return true;
    });
}

const emptyForm = (date: string) => ({
  date,
  time: "",
  title: "",
  placeName: "",
  categories: [] as string[],
  tags: [] as string[],
  content: "",
});

export function JournalEntryForm({
  categoryOptions,
  tagOptions,
  preferences,
  prefillTemplates = [],
}: {
  categoryOptions: string[];
  tagOptions: string[];
  preferences: JournalPreferences;
  /** Enabled templates only — the server filters, so anything here is offerable. */
  prefillTemplates?: JournalPrefillTemplate[];
}) {
  const router = useRouter();
  const [form, setForm] = useState(() => emptyForm(todayIso()));
  const [locations, setLocations] = useState<JournalLocationInput[]>([]);
  const [weather, setWeather] = useState<EntryWeatherInput | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);
  const [isFetchingWeather, setIsFetchingWeather] = useState(false);
  const [isLocatingAndFetching, setIsLocatingAndFetching] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const { request: requestPosition } = useCurrentPosition();

  // Text fields only. Categories and tags are arrays and go through setTaxonomy.
  type TextField = Exclude<keyof ReturnType<typeof emptyForm>, "categories" | "tags">;

  function update(field: TextField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function setTaxonomy(field: "categories" | "tags", names: string[]) {
    setForm((current) => ({ ...current, [field]: names }));
  }

  function reset() {
    setForm(emptyForm(todayIso()));
    setLocations([]);
    setWeather(null);
    setTemplateId("");
  }

  // Fills the blank fields from a saved template. The merge itself is
  // `applyPrefillTemplate` in lib — this only maps between the form's field
  // names and the template's, and supplies the clock.
  //
  // `new Date()` here, in the browser, is deliberate: an entry's date is the
  // calendar day the writer is living in, so resolving a template's "current
  // date" on the server would file a late-evening entry under the wrong day for
  // anyone in a different timezone. See migration 0062.
  function handleApplyTemplate(rawId: string) {
    setTemplateId(rawId);
    if (rawId === "") return;
    const template = prefillTemplates.find((candidate) => String(candidate.id) === rawId);
    if (!template) return;

    setForm((current) => {
      const values: JournalPrefillFormValues = {
        date: current.date,
        time: current.time,
        title: current.title,
        content: current.content,
        placeName: current.placeName,
        categories: current.categories.join(", "),
        tags: current.tags.join(" "),
      };
      const filled = applyPrefillTemplate(template, values, new Date());
      return {
        ...current,
        date: filled.date,
        time: filled.time,
        title: filled.title,
        content: filled.content,
        placeName: filled.placeName,
        categories: splitNames(filled.categories, ","),
        tags: splitNames(filled.tags, /\s+/),
      };
    });
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

  // One press fills both fields: read GPS, name the point by reverse geocoding,
  // append it to the locations list, and fetch that point's weather. Each stage
  // keeps what the earlier ones produced — a failed name still lands the
  // coordinates, and failed weather still lands the location.
  async function handleGpsAndWeather() {
    setIsLocatingAndFetching(true);
    setError(undefined);
    try {
      const located = await requestPosition();
      if (!located.ok) {
        setError(located.error);
        return;
      }
      const { latitude, longitude } = located.position;

      const geocoded = await reverseGeocodeAction(latitude, longitude);
      const locationName = geocoded.ok && geocoded.place ? geocoded.place.displayName : "";
      setLocations((current) => [...current, { latitude, longitude, locationName }]);

      // Only fill the free-text Place name if it's still empty — never overwrite
      // something already typed.
      if (locationName !== "") {
        setForm((current) => (current.placeName === "" ? { ...current, placeName: locationName } : current));
      }

      const result = await fetchWeatherAction(latitude, longitude, preferences.temperatureUnit);
      if (!result.ok || !result.weather) {
        setError(result.error ?? "Got your location, but failed to fetch weather.");
        return;
      }
      const { temperature, unit, description, code } = result.weather;
      setWeather({ temp: temperature, unit, description, code });
    } finally {
      setIsLocatingAndFetching(false);
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
        Write a new entry. Pick categories and tags from the dropdowns, or type a new one to create it.
      </p>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Above the fields, because it acts on all of them. Hidden entirely when
          no template is enabled, rather than shown empty — a dropdown with
          nothing in it is a dead control. Full width on a phone, and it stays
          full width on desktop too: it is a header for the grid below, not a
          member of it. */}
      {prefillTemplates.length > 0 && (
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Select prefill template</span>
          <select
            value={templateId}
            onChange={(event) => handleApplyTemplate(event.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">Start from a template…</option>
            {prefillTemplates.map((template) => (
              <option key={template.id} value={String(template.id)}>
                {template.name}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-muted">
            Fills the fields you have left blank. Anything you have already typed is kept.
          </span>
        </label>
      )}

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
        <TokenPicker
          label="Categories"
          value={form.categories}
          onChange={(names) => setTaxonomy("categories", names)}
          options={categoryOptions}
          allowCreate
          createPlaceholder="New category, e.g. FAMILY"
        />

        <TokenPicker
          className="sm:col-span-2"
          label="Tags"
          value={form.tags}
          onChange={(names) => setTaxonomy("tags", names)}
          options={tagOptions}
          allowCreate
          createPlaceholder="New tag, e.g. Museum"
        />

        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-ink">Content</span>
          <textarea value={form.content} onChange={(event) => update("content", event.target.value)} placeholder="What happened today…" rows={6} className={`${INPUT_CLASS} resize-y`} />
        </label>
      </div>

      <JournalLocationPicker value={locations} onChange={setLocations} />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="secondary"
          onClick={handleGpsAndWeather}
          disabled={isLocatingAndFetching}
          title="Use this device's location to add a location and fetch its weather"
        >
          {isLocatingAndFetching ? "Locating…" : "GPS + Weather"}
        </Button>
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
