"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { FullscreenStage, canGoFullscreen } from "@/components/fullscreen-stage";
import { Tabs } from "@/components/tabs";
import { TokenPicker } from "@/components/token-picker";
import { useCurrentPosition } from "@/components/use-current-position";
import {
  applyPrefillTemplate,
  handwritingSizeClass,
  type JournalHandwritingSize,
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

const pad2 = (value: number) => String(value).padStart(2, "0");

// Local calendar date as YYYY-MM-DD (not UTC), so the default matches the user's day.
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

// Local wall-clock time as HH:MM:SS, matching the Time input's `step={1}`.
//
// Read in the browser for the same reason `todayIso` is: the time on an entry is
// the moment the writer is living in, not the server's instant, so resolving it
// server-side would stamp a late-evening entry with the wrong hour (and, past
// midnight UTC, the wrong day) for anyone in another timezone. Same rule the
// prefill templates' "current time" follows — see migration 0062.
function nowIso(): string {
  const now = new Date();
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
}

// The handwriting sheet's type, for the in-card field and the fullscreen stage.
//
// `font-script` is the app's one decorative face (design.md → *The one exception*).
// The size comes from the module's `handwritingSize` preference, whose smallest
// offered value is the 20px floor that section sets — so the floor holds wherever
// this is called without a check here. Deliberately no `max-lg:` step-down: 18px
// script on a phone is the least readable combination in the app, and an explicitly
// chosen size shouldn't be silently overridden on a narrow screen.
function handwritingClass(size: JournalHandwritingSize): string {
  return `font-script leading-relaxed ${handwritingSizeClass(size)}`;
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

const emptyForm = (date: string, time: string) => ({
  date,
  time,
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
  locationCategoryOptions = [],
  locationTagOptions = [],
}: {
  categoryOptions: string[];
  tagOptions: string[];
  preferences: JournalPreferences;
  /** Enabled templates only — the server filters, so anything here is offerable. */
  prefillTemplates?: JournalPrefillTemplate[];
  /**
   * The saved-location library's own category and tag lists, for the filter
   * chips on the location picker's "From location database" tab. Separate from
   * `categoryOptions`/`tagOptions` above, which are the entry's — see the 0101
   * migration log for why the two taxonomies are deliberately distinct.
   */
  locationCategoryOptions?: string[];
  locationTagOptions?: string[];
}) {
  const router = useRouter();
  // Date and time both start at the writer's current clock. Lazy initialiser, so
  // the clock is read when the form mounts rather than on every render.
  const [form, setForm] = useState(() => emptyForm(todayIso(), nowIso()));
  const [locations, setLocations] = useState<JournalLocationInput[]>([]);
  const [weather, setWeather] = useState<EntryWeatherInput | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);
  const [isFetchingWeather, setIsFetchingWeather] = useState(false);
  const [isLocatingAndFetching, setIsLocatingAndFetching] = useState(false);
  const [templateId, setTemplateId] = useState("");
  // Content-card view state. Both are transient: a mode you put the field into
  // for this sitting, not a stored preference, so they reset with the form.
  const [isHandwriting, setIsHandwriting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Resolved after mount, never during render: `canGoFullscreen` reads
  // `document.fullscreenEnabled`, which the server doesn't have, and rendering
  // the button on one and not the other is a hydration mismatch. Starts false so
  // the control is absent until known-supported — iOS Safari on iPhone has no
  // element fullscreen, and FullscreenStage's own note is that a dead button is
  // worse than no button.
  const [canFullscreen, setCanFullscreen] = useState(false);
  const { request: requestPosition } = useCurrentPosition();

  useEffect(() => {
    setCanFullscreen(canGoFullscreen());
  }, []);

  // Text fields only. Categories and tags are arrays and go through setTaxonomy.
  type TextField = Exclude<keyof ReturnType<typeof emptyForm>, "categories" | "tags">;

  function update(field: TextField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function setTaxonomy(field: "categories" | "tags", names: string[]) {
    setForm((current) => ({ ...current, [field]: names }));
  }

  // Re-reads the clock rather than restoring the mount-time values, so the next
  // entry of a sitting is stamped when it is written, not when the page loaded.
  function reset() {
    setForm(emptyForm(todayIso(), nowIso()));
    setLocations([]);
    setWeather(null);
    setTemplateId("");
    setIsHandwriting(false);
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
      setError("Pick a location on the Misc tab, or set a default location in Preferences, to fetch weather.");
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

  // Resolved once for both copies of the field — the one in the card and the one
  // on the fullscreen stage — so they can't drift to different sizes.
  const cursiveClass = handwritingClass(preferences.handwritingSize);

  // The two tab bodies, built here rather than inline in the `items` array so
  // the JSX below stays readable. Both close over the one `form` state above.
  const mainTab = (
    <div className="flex flex-col gap-4">
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

        <TokenPicker
          label="Categories"
          value={form.categories}
          onChange={(names) => setTaxonomy("categories", names)}
          options={categoryOptions}
          allowCreate
          createPlaceholder="New category, e.g. FAMILY"
        />
        <TokenPicker
          label="Tags"
          value={form.tags}
          onChange={(names) => setTaxonomy("tags", names)}
          options={tagOptions}
          allowCreate
          createPlaceholder="New tag, e.g. Museum"
        />
      </div>

      {/* Content gets a card of its own: it is the entry, and the two controls
          in the header act on it alone rather than on the form. `headerAction`
          keeps them visible even when the card is shut. */}
      <CollapsibleCard
        title="Content"
        defaultOpen
        headerAction={
          <div className="flex flex-wrap items-center gap-2">
            {canFullscreen && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setIsFullscreen(true)}
                title="Show just the content box, filling the screen"
              >
                Full screen
              </Button>
            )}
            {/* On/off is carried by the variant swap. Deliberately no
                `ariaLabel`: `Button` renders it as `aria-label`, which would
                *replace* the visible "Handwriting" text and leave the accessible
                name not matching the label. `Button` also whitelists only
                `ariaExpanded`/`ariaControls`, so `aria-pressed` isn't available
                — the hint lives in `title`, as its doc prescribes. */}
            <Button
              size="sm"
              variant={isHandwriting ? "primary" : "secondary"}
              onClick={() => setIsHandwriting((on) => !on)}
              title="Using cursive font"
            >
              Handwriting
            </Button>
          </div>
        }
      >
        {/* A toggle over the same textarea, not a preview pane: the writer keeps
            typing in cursive rather than having to leave the mode to edit. The
            sheet texture goes on the wrapper and the field turns transparent so
            it sits *on* the paper instead of stacking a second surface over it. */}
        <div className={isHandwriting ? "rounded-md paper-texture" : ""}>
          <textarea
            value={form.content}
            onChange={(event) => update("content", event.target.value)}
            placeholder="What happened today…"
            aria-label="Content"
            rows={18}
            className={
              isHandwriting
                ? `w-full resize-y border-0 bg-transparent px-3 py-2 text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${cursiveClass}`
                : `${INPUT_CLASS} resize-y`
            }
          />
        </div>
      </CollapsibleCard>
    </div>
  );

  const miscTab = (
    <div className="flex flex-col gap-4">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Place name</span>
        <input type="text" value={form.placeName} onChange={(event) => update("placeName", event.target.value)} placeholder="e.g. Princeton University" className={INPUT_CLASS} />
      </label>

      <JournalLocationPicker
        value={locations}
        onChange={setLocations}
        libraryCategoryOptions={locationCategoryOptions}
        libraryTagOptions={locationTagOptions}
      />

      {/* Both weather controls sit on this tab with the locations they read: GPS
          + Weather appends to the list above and fills the Place name field, so
          the button and everything it writes to are on one screen. */}
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
    </div>
  );

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

      {/* Two tabs, and the form state that feeds them stays up here rather than
          inside either panel. `Tabs` unmounts the panel it isn't showing, so a
          Misc field owned by the Misc panel would lose what was typed into it
          the moment the writer flipped back to Main. */}
      <Tabs
        items={[
          { key: "main", label: "Main", content: mainTab },
          { key: "misc", label: "Misc", content: miscTab },
        ]}
      />

      {/* Outside the tab strip on purpose: a Save button that disappears on one
          of two tabs is a trap, and the error line above has to stay readable
          from Main even when a Misc action raised it. */}
      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={isBusy || form.date === ""}>
          {isBusy ? "Saving…" : "Save entry"}
        </Button>
        <Button variant="secondary" onClick={reset} disabled={isBusy}>
          Clear
        </Button>
      </div>

      {/* Mounted only while fullscreen, per FullscreenStage's contract: it
          requests fullscreen on mount and reports every way out — Escape, the
          browser's own control, a rejected request — through `onExit`. The
          textarea below is a second element bound to the same state, so what is
          typed here is already in the form when the stage closes. */}
      {isFullscreen && (
        <FullscreenStage onExit={() => setIsFullscreen(false)} label="Journal entry content">
          {/* A sheet centred on the black stage rather than edge-to-edge text: a
              full-width line on a 27" monitor is unreadable.
              `.paper-texture` is only the fibre overlay — it carries no tint of
              its own (design.md), so on the stage's black it needs
              `bg-paper-raised` under it to read as a sheet at all. The card on
              the page gets that surface for free; here it has to be asked for. */}
          {/* `bg-paper-raised` in both modes, not just under the texture: the
              stage is black but `--ink` follows the theme, so a light theme's
              dark ink directly on black would be unreadable. The sheet gives the
              text the same surface it has on the page. */}
          <div
            className={`h-full w-full max-w-4xl overflow-hidden rounded-lg bg-paper-raised p-8 ${
              isHandwriting ? "paper-texture" : ""
            }`}
          >
            <textarea
              value={form.content}
              onChange={(event) => update("content", event.target.value)}
              placeholder="What happened today…"
              autoFocus
              aria-label="Content"
              className={`h-full w-full resize-none border-0 bg-transparent p-4 text-ink focus-visible:outline-none ${
                isHandwriting ? cursiveClass : "text-base"
              }`}
            />
          </div>
        </FullscreenStage>
      )}
    </div>
  );
}
