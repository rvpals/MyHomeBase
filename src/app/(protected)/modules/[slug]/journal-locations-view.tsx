"use client";

// The Location Manager: the list of saved places, a search box and filter
// chips, and an add/edit popup that reuses the entry form's map picker.
//
// The library is the *source* an entry copies from, so this screen is where
// places are created and corrected. Deleting one never touches an entry that
// already used it — see migration 0101.
//
// Route-local rather than registered: nothing outside My Journal renders this.

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import { TreeIcon } from "@/components/tree-icons";
import type { SavedLocationWithUsage } from "@/lib/journal-locations";
import { JournalLocationField, type PickedLocation } from "./journal-location-field";
import { JournalLocationDedupModal } from "./journal-location-dedup-view";
import { JournalLocationImportModal } from "./journal-location-import-panel";
import { reverseGeocodeAction } from "./journal-actions";
import {
  createSavedLocationAction,
  deleteSavedLocationAction,
  searchSavedLocationsAction,
  updateSavedLocationAction,
} from "./journal-locations-actions";

// Leaflet touches `window`, so the map inside the editor is loaded client-only —
// same reason and same treatment as the entry form's picker.
const JournalLocationMap = dynamic(
  () => import("./journal-location-map").then((module) => module.JournalLocationMap),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-64 place-items-center rounded-md border border-line text-sm text-muted">
        Loading map…
      </div>
    ),
  },
);

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export function formatCoords(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

/**
 * A toggleable filter chip.
 *
 * Chips rather than a multi-select: the lists are short, and the whole point of
 * the filters is to be one tap away on a phone, which a native multiple-select
 * is not.
 */
export function FilterChip({
  label,
  count,
  isActive,
  onToggle,
}: {
  label: string;
  count?: number;
  isActive: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isActive}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        isActive
          ? "border-brass bg-brass-soft text-ink"
          : "border-line bg-paper text-muted hover:text-ink"
      }`}
    >
      {label}
      {count !== undefined && <span className="ml-1.5 font-mono opacity-70">{count}</span>}
    </button>
  );
}

/** Add/edit popup. `location` undefined means "new". */
function EditSavedLocationModal({
  location,
  categoryOptions,
  tagOptions,
  onClose,
}: {
  location?: SavedLocationWithUsage;
  categoryOptions: string[];
  tagOptions: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(location?.name ?? "");
  const [description, setDescription] = useState(location?.description ?? "");
  const [address, setAddress] = useState(location?.address ?? "");
  const [categories, setCategories] = useState<string[]>(location?.categories ?? []);
  const [tags, setTags] = useState<string[]>(location?.tags ?? []);
  const [point, setPoint] = useState<PickedLocation | null>(
    location
      ? { latitude: location.latitude, longitude: location.longitude, name: location.name }
      : null,
  );
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  /**
   * The picker's own "name" field is ignored here — this form has its own, and
   * two name boxes in one popup would be a puzzle. What the picker is for is the
   * *point*, plus the address it reverse-geocodes on the way.
   */
  function handlePointChange(next: PickedLocation | null) {
    setPoint(next);
    // Only seed the address when it is still blank, so a hand-corrected address
    // survives nudging the pin — Nominatim's answer for a rural point is often a
    // road rather than the place the reader means.
    if (next && next.name !== "" && address.trim() === "") setAddress(next.name);
  }

  async function handleLookupAddress() {
    if (!point) return;
    setIsBusy(true);
    try {
      const result = await reverseGeocodeAction(point.latitude, point.longitude);
      if (result.ok && result.place) setAddress(result.place.displayName);
      else setError(result.error ?? "No address found for that point.");
    } finally {
      setIsBusy(false);
    }
  }

  function toggle(list: string[], value: string, set: (next: string[]) => void) {
    set(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  async function handleSave() {
    setError(undefined);
    if (!point) {
      setError("Pick a point on the map first.");
      return;
    }
    setIsBusy(true);
    try {
      const input = {
        name,
        latitude: point.latitude,
        longitude: point.longitude,
        description,
        address,
        categories,
        tags,
      };
      const result = location
        ? await updateSavedLocationAction({ ...input, id: location.id })
        : await createSavedLocationAction(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      onClose();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      size="lg"
      title={location ? `Edit "${location.name || "unnamed place"}"` : "Add a location"}
    >
      <div className="flex flex-col gap-3">
        {error && <p className="text-sm text-red-400">{error}</p>}

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Small World Coffee"
            className={INPUT_CLASS}
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Description</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="The one on Witherspoon"
            className={INPUT_CLASS}
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Address</span>
          <div className="flex gap-2">
            <input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Filled in from the map, or type your own"
              className={INPUT_CLASS}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={handleLookupAddress}
              disabled={isBusy || !point}
              title="Look the address up from the pin"
            >
              Look up
            </Button>
          </div>
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-ink">Categories</span>
          {categoryOptions.length === 0 ? (
            <p className="text-xs text-muted">
              None defined yet — add some under Locations → Location Meta Data.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {categoryOptions.map((option) => (
                <FilterChip
                  key={option}
                  label={option}
                  isActive={categories.includes(option)}
                  onToggle={() => toggle(categories, option, setCategories)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-ink">Tags</span>
          {tagOptions.length === 0 ? (
            <p className="text-xs text-muted">
              None defined yet — add some under Locations → Location Meta Data.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {tagOptions.map((option) => (
                <FilterChip
                  key={option}
                  label={option}
                  isActive={tags.includes(option)}
                  onToggle={() => toggle(tags, option, setTags)}
                />
              ))}
            </div>
          )}
        </div>

        <JournalLocationField value={point} onChange={handlePointChange} />

        <div className="flex gap-2">
          <Button size="sm" onClick={handleSave} disabled={isBusy || !point}>
            {isBusy ? "Saving…" : "Save location"}
          </Button>
          <Button size="sm" variant="secondary" onClick={onClose} disabled={isBusy}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function JournalLocationsView({
  locations,
  categoryOptions,
  tagOptions,
}: {
  locations: SavedLocationWithUsage[];
  categoryOptions: string[];
  tagOptions: string[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeCategories, setActiveCategories] = useState<string[]>([]);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  // The last search's rows. Only read while something is narrowing the list —
  // see `shown` below — so a stale set from a filter since cleared can't show.
  const [results, setResults] = useState<SavedLocationWithUsage[] | undefined>(undefined);
  const [editing, setEditing] = useState<SavedLocationWithUsage | undefined>(undefined);
  const [isAdding, setIsAdding] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDeduping, setIsDeduping] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const isFiltered = query.trim() !== "" || activeCategories.length > 0 || activeTags.length > 0;

  // Re-runs the search whenever the query or a filter changes, debounced so a
  // typed word is one round trip rather than one per letter. The filtering is
  // pushed to SQL (the taxonomy filters are joins) rather than done here.
  //
  // The unfiltered case doesn't clear `results` — it simply isn't read, because
  // `shown` below falls back to the server's list whenever nothing is narrowing.
  // Clearing it here would be a synchronous setState inside an effect.
  useEffect(() => {
    if (!isFiltered) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await searchSavedLocationsAction({
        query,
        categories: activeCategories,
        tags: activeTags,
      });
      if (cancelled) return;
      if (result.ok) {
        setResults(result.locations ?? []);
        setError(undefined);
      } else {
        setError(result.error);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, activeCategories, activeTags, isFiltered]);

  // Memoised so the pin list below keeps a stable identity across renders that
  // changed neither the filters nor the rows.
  const shown = useMemo(
    () => (isFiltered ? (results ?? []) : locations),
    [isFiltered, results, locations],
  );

  // The pins for the little overview map above the list — whatever is currently
  // listed, numbered to match it.
  const markers = useMemo(
    () =>
      shown.map((place, index) => ({
        latitude: place.latitude,
        longitude: place.longitude,
        number: index + 1,
      })),
    [shown],
  );

  function toggleFilter(list: string[], value: string, set: (next: string[]) => void) {
    set(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  async function handleDelete(place: SavedLocationWithUsage) {
    const used =
      place.usageCount === 0
        ? ""
        : ` ${place.usageCount} journal ${place.usageCount === 1 ? "entry keeps" : "entries keep"} the coordinates but stop pointing here.`;
    if (!window.confirm(`Delete "${place.name || "this place"}"?${used}`)) return;
    const result = await deleteSavedLocationAction(place.id);
    if (result.ok) router.refresh();
    else window.alert(result.error);
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search a name, description or address"
          className={`${INPUT_CLASS} max-w-sm flex-1`}
        />
        <Button size="sm" onClick={() => setIsAdding(true)}>
          Add a location
        </Button>
        {/* Secondary: adding one place by hand is the everyday act, building the
            library out of the journal is the one-off you do once. */}
        <Button size="sm" variant="secondary" onClick={() => setIsImporting(true)}>
          Create locations from existing journal entries
        </Button>
        {/* Also secondary, and last: tidying up is the rarest of the three, and
            it only has anything to do once the other two have filled the
            library. */}
        <Button size="sm" variant="secondary" onClick={() => setIsDeduping(true)}>
          Merging &amp; Dedup
        </Button>
      </div>

      {(categoryOptions.length > 0 || tagOptions.length > 0) && (
        <div className="flex flex-col gap-2">
          {categoryOptions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-muted">Categories</span>
              {categoryOptions.map((option) => (
                <FilterChip
                  key={option}
                  label={option}
                  isActive={activeCategories.includes(option)}
                  onToggle={() => toggleFilter(activeCategories, option, setActiveCategories)}
                />
              ))}
            </div>
          )}
          {tagOptions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-muted">Tags</span>
              {tagOptions.map((option) => (
                <FilterChip
                  key={option}
                  label={option}
                  isActive={activeTags.includes(option)}
                  onToggle={() => toggleFilter(activeTags, option, setActiveTags)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="text-sm text-muted">
          {isFiltered ? "No places match that." : "No saved places yet — add your first one."}
        </p>
      ) : (
        <>
          {/* Shorter on a phone: a `max-lg:` variant, so the desktop height is
              provably untouched (design.md → Reach for CSS first). */}
          <JournalLocationMap
            marker={null}
            markers={markers}
            center={null}
            heightClassName="h-80 max-lg:h-52"
          />

          <ul className="flex flex-col gap-1">
            {shown.map((place, index) => (
              <li
                key={place.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-paper px-3 py-1.5 text-sm"
              >
                <span className="shrink-0 font-mono text-xs text-muted">#{index + 1}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setEditing(place)}
                    aria-label={`Edit "${place.name || "unnamed place"}"`}
                    title="Edit"
                    className="text-muted hover:text-brass"
                  >
                    <TreeIcon name="pencil" className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(place)}
                    aria-label={`Delete "${place.name || "unnamed place"}"`}
                    title="Delete"
                    className="text-muted hover:text-red-400"
                  >
                    <TreeIcon name="trash" className="h-4 w-4" />
                  </button>
                </span>

                <span className="min-w-0 flex-1">
                  <span className="font-medium text-ink">
                    {place.name || <span className="text-muted">(unnamed)</span>}
                  </span>
                  {place.description && (
                    <span className="ml-2 text-muted">{place.description}</span>
                  )}
                  {place.address && (
                    <span className="block truncate text-xs text-muted">{place.address}</span>
                  )}
                  <span className="block font-mono text-xs text-muted">
                    {formatCoords(place.latitude, place.longitude)}
                  </span>
                </span>

                <span className="flex flex-wrap items-center gap-1">
                  {[...place.categories, ...place.tags].map((label) => (
                    <span
                      key={label}
                      className="rounded-full border border-line px-2 py-0.5 text-xs text-muted"
                    >
                      {label}
                    </span>
                  ))}
                </span>

                <span
                  className="shrink-0 font-mono text-xs text-muted"
                  title={`Used by ${place.usageCount} journal ${place.usageCount === 1 ? "entry" : "entries"}`}
                >
                  {place.usageCount}×
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {isImporting && <JournalLocationImportModal onClose={() => setIsImporting(false)} />}
      {isDeduping && <JournalLocationDedupModal onClose={() => setIsDeduping(false)} />}
      {isAdding && (
        <EditSavedLocationModal
          categoryOptions={categoryOptions}
          tagOptions={tagOptions}
          onClose={() => setIsAdding(false)}
        />
      )}
      {editing && (
        <EditSavedLocationModal
          location={editing}
          categoryOptions={categoryOptions}
          tagOptions={tagOptions}
          onClose={() => setEditing(undefined)}
        />
      )}
    </div>
  );
}
