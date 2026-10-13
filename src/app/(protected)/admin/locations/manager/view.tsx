"use client";

// The Location Manager: the list of saved places, a search box and filter
// chips, and an add/edit popup that reuses the entry form's map picker.
//
// The library is the *source* an entry copies from, so this screen is where
// places are created and corrected. Deleting one never touches an entry that
// already used it — see migration 0101.
//
// Route-local rather than registered: nothing outside Admin -> Locations
// renders this.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import { TreeIcon } from "@/components/tree-icons";
import type {
  LocationTaxonomyKind,
  SaveLocationInput,
  SavedLocation,
  SavedLocationWithUsage,
} from "@/lib/sys-locations";
import { LocationPickerField, type PickedLocation } from "../location-field";
import { LocationDedupModal } from "../dedup-view";
import { FilterChip, formatCoords } from "../filter-chip";
import {
  createSavedLocationAction,
  deleteSavedLocationAction,
  findLocationsAtPointAction,
  reverseGeocodeAction,
  saveLocationTaxonomyAction,
  searchSavedLocationsAction,
  updateSavedLocationAction,
} from "../actions";

// Leaflet touches `window`, so the map inside the editor is loaded client-only —
// same reason and same treatment as the entry form's picker.
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

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/**
 * One labelled row of toggleable chips, plus a "+" that defines a new name
 * without leaving the popup.
 *
 * The quick-add exists because the alternative is abandoning a half-filled
 * location to go to Location Meta Data and come back. Name only — a description
 * is the kind of thing you write when you're curating the list, not when you're
 * mid-way through filing a place, and Location Meta Data stays the screen for
 * that. The name is the key the pairings carry, so this is the same call the
 * meta-data screen makes: `saveLocationTaxonomyAction` upserts, which means
 * re-typing a name that already exists quietly selects it rather than erroring.
 */
function TaxonomyChoices({
  kind,
  title,
  options,
  selected,
  onToggle,
  onCreated,
  icons,
  onSaveTaxonomy,
}: {
  kind: LocationTaxonomyKind;
  title: string;
  options: string[];
  selected: string[];
  onToggle: (option: string) => void;
  onCreated: (name: string) => void;
  /** Name -> icon URL. A missing entry just means that name has no icon. */
  icons: Record<string, string>;
  /** Defines a new name. Injected — see the modal's `actions` prop. */
  onSaveTaxonomy: (
    kind: LocationTaxonomyKind,
    input: { name: string; description: string },
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleAdd() {
    const name = draft.trim();
    if (name === "") return;
    setError(undefined);
    // Already on the list: just tick it, and don't spend a round trip saying so.
    if (options.includes(name)) {
      if (!selected.includes(name)) onToggle(name);
      setDraft("");
      setIsAdding(false);
      return;
    }
    setIsBusy(true);
    try {
      const result = await onSaveTaxonomy(kind, { name, description: "" });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onCreated(name);
      setDraft("");
      setIsAdding(false);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-ink">{title}</span>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setError(undefined);
            setIsAdding((previous) => !previous);
          }}
          ariaLabel={`Add a ${kind}`}
          ariaExpanded={isAdding}
          title={`Add a ${kind}`}
          className="px-2 py-0.5"
        >
          +
        </Button>
      </div>

      {isAdding && (
        <div className="flex gap-2">
          <input
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            // Enter saves: the popup has no form around it, so nothing else
            // would submit, and reaching for the mouse here is the slow path.
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleAdd();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setIsAdding(false);
                setDraft("");
              }
            }}
            placeholder={`New ${kind} name`}
            className={INPUT_CLASS}
          />
          <Button size="sm" onClick={handleAdd} disabled={isBusy || draft.trim() === ""}>
            {isBusy ? "Adding…" : "Add"}
          </Button>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {options.length === 0 ? (
        <p className="text-xs text-muted">
          None defined yet — add one with +, or manage the list under Locations → Location
          Meta Data.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {options.map((option) => (
            <FilterChip
              key={option}
              label={option}
              iconUrl={icons[option]}
              isActive={selected.includes(option)}
              onToggle={() => onToggle(option)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The server actions `EditSavedLocationModal` needs. See its `actions` prop for
 * why they are injected.
 */
export interface EditLocationActions {
  create: (input: SaveLocationInput) => Promise<{ ok: boolean; error?: string }>;
  update?: (
    input: SaveLocationInput & { id: number },
  ) => Promise<{ ok: boolean; error?: string }>;
  findAtPoint: (
    latitude: number,
    longitude: number,
    excludeId?: number,
  ) => Promise<{ ok: boolean; locations?: SavedLocation[]; error?: string }>;
  reverseGeocode: (
    latitude: number,
    longitude: number,
  ) => Promise<{ ok: boolean; place?: { displayName: string }; error?: string }>;
  saveTaxonomy: (
    kind: LocationTaxonomyKind,
    input: { name: string; description: string },
  ) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * The admin screens' bundle: every action behind `requireAdmin()`.
 *
 * Module-level so its identity is stable across renders — rebuilding it inline
 * would hand the popup a new object on every keystroke.
 */
export const ADMIN_EDIT_LOCATION_ACTIONS: EditLocationActions = {
  create: createSavedLocationAction,
  update: updateSavedLocationAction,
  findAtPoint: findLocationsAtPointAction,
  reverseGeocode: reverseGeocodeAction,
  saveTaxonomy: (kind, input) => saveLocationTaxonomyAction(kind, input),
};

/** Add/edit popup. `location` undefined means "new". */
export function EditSavedLocationModal({
  location,
  initial,
  categoryOptions,
  tagOptions,
  categoryIcons,
  tagIcons,
  onClose,
  onSaved,
  actions,
}: {
  location?: SavedLocationWithUsage;
  /**
   * Starting values for a *new* place, when something outside this screen
   * already knows them — the journal entry form's "+" prefills the pin it is
   * offering to save. Ignored when `location` is given, which is an edit.
   */
  initial?: {
    name?: string;
    latitude: number;
    longitude: number;
    address?: string;
  };
  categoryOptions: string[];
  tagOptions: string[];
  categoryIcons: Record<string, string>;
  tagIcons: Record<string, string>;
  onClose: () => void;
  /**
   * Called after a successful write, before the modal closes.
   *
   * `router.refresh()` alone is not enough: it refetches the server's
   * `locations` prop, but a filtered list renders `results` — client state
   * from the search action, which a server refresh cannot reach. Without this
   * the reader edits a place and the old row stays on screen.
   */
  onSaved?: () => void;
  /**
   * The server actions this popup calls, injected rather than imported.
   *
   * It opens in two places with different gates: Admin → Locations (admin
   * only) and the journal entry form's "+" (anyone who can write an entry).
   * The actions are the same use-cases behind different `require*` calls, so
   * the popup takes them as a parameter instead of picking one and locking the
   * other caller out.
   */
  actions: EditLocationActions;
}) {
  const router = useRouter();
  const [name, setName] = useState(location?.name ?? initial?.name ?? "");
  const [description, setDescription] = useState(location?.description ?? "");
  const [address, setAddress] = useState(location?.address ?? initial?.address ?? "");
  const [categories, setCategories] = useState<string[]>(location?.categories ?? []);
  const [tags, setTags] = useState<string[]>(location?.tags ?? []);
  const [point, setPoint] = useState<PickedLocation | null>(
    location
      ? { latitude: location.latitude, longitude: location.longitude, name: location.name }
      : initial
        ? { latitude: initial.latitude, longitude: initial.longitude, name: initial.name ?? "" }
        : null,
  );
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  /**
   * Places already at the point being saved, once a save has been attempted and
   * refused. Null until then.
   *
   * Holding the rows rather than a boolean lets the warning name them, and
   * makes "has the reader already been warned about *this* point?" answerable:
   * nudging the pin clears it, so moving somewhere else re-checks rather than
   * inheriting a stale "save anyway".
   */
  const [duplicates, setDuplicates] = useState<SavedLocation[] | null>(null);
  // Names defined by the "+" inside this popup. They are saved server-side
  // immediately, but the props come from the page's server render, which only
  // catches up on the next refresh — and refreshing now would throw away the
  // half-filled form. So they're held here and merged into the chip lists.
  const [extraCategories, setExtraCategories] = useState<string[]>([]);
  const [extraTags, setExtraTags] = useState<string[]>([]);

  const categoryChoices = useMemo(
    () => [...categoryOptions, ...extraCategories.filter((name) => !categoryOptions.includes(name))],
    [categoryOptions, extraCategories],
  );
  const tagChoices = useMemo(
    () => [...tagOptions, ...extraTags.filter((name) => !tagOptions.includes(name))],
    [tagOptions, extraTags],
  );

  /**
   * The picker's own "name" field is ignored here — this form has its own, and
   * two name boxes in one popup would be a puzzle. What the picker is for is the
   * *point*, plus the address it reverse-geocodes on the way.
   */
  function handlePointChange(next: PickedLocation | null) {
    setPoint(next);
    // A new point is a new question: whatever was warned about belonged to the
    // old one, and keeping it would let a "save anyway" carry over to a place
    // nobody has checked.
    setDuplicates(null);
    // Only seed the address when it is still blank, so a hand-corrected address
    // survives nudging the pin — Nominatim's answer for a rural point is often a
    // road rather than the place the reader means.
    if (next && next.name !== "" && address.trim() === "") setAddress(next.name);
  }

  async function handleLookupAddress() {
    if (!point) return;
    setIsBusy(true);
    try {
      const result = await actions.reverseGeocode(point.latitude, point.longitude);
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
      // First attempt at this point: ask whether anything is already here, and
      // stop to say so. `duplicates` being set means the reader has seen the
      // warning for *this* point and pressed again, so the save goes through —
      // the check is a prompt, never a rule.
      if (duplicates === null) {
        const found = await actions.findAtPoint(point.latitude, point.longitude, location?.id);
        // A failed check must not block the save: the reader came here to
        // store a place, and losing that to a lookup error would be worse than
        // missing a warning. An empty array records "asked, nothing here".
        if (found.ok && found.locations && found.locations.length > 0) {
          setDuplicates(found.locations);
          return;
        }
        setDuplicates([]);
      }

      const input = {
        name,
        latitude: point.latitude,
        longitude: point.longitude,
        description,
        address,
        categories,
        tags,
      };
      const result =
        location && actions.update
          ? await actions.update({ ...input, id: location.id })
          : await actions.create(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      onSaved?.();
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

        <TaxonomyChoices
          kind="category"
          title="Categories"
          options={categoryChoices}
          icons={categoryIcons}
          selected={categories}
          onToggle={(option) => toggle(categories, option, setCategories)}
          onCreated={(created) => {
            setExtraCategories((previous) => [...previous, created]);
            setCategories((previous) => [...previous, created]);
          }}
          onSaveTaxonomy={actions.saveTaxonomy}
        />

        <TaxonomyChoices
          kind="tag"
          title="Tags"
          options={tagChoices}
          icons={tagIcons}
          selected={tags}
          onToggle={(option) => toggle(tags, option, setTags)}
          onCreated={(created) => {
            setExtraTags((previous) => [...previous, created]);
            setTags((previous) => [...previous, created]);
          }}
          onSaveTaxonomy={actions.saveTaxonomy}
        />

        <LocationPickerField value={point} onChange={handlePointChange} showName={false} />

        {/* Inline rather than a window.confirm: it survives the re-render, it
            is readable on a phone, and the rest of this dialog already reports
            inline. The button below becomes "Save anyway", so the second press
            is the confirmation — there is nothing extra to dismiss. */}
        {duplicates !== null && duplicates.length > 0 && (
          <p role="status" className="text-sm text-amber-400">
            We already have {duplicates.length === 1 ? "this location" : "locations"} with
            coordinates {formatCoords(duplicates[0].latitude, duplicates[0].longitude)}
            {" as "}
            {duplicates.map((place, index) => (
              <span key={place.id}>
                {index > 0 && ", "}
                <span className="font-medium">{place.name || "an unnamed place"}</span>
              </span>
            ))}
            . Are you sure you want to create a new location for the same GPS coordinate?
          </p>
        )}

        <div className="flex gap-2">
          <Button size="sm" onClick={handleSave} disabled={isBusy || !point}>
            {isBusy
              ? "Saving…"
              : duplicates !== null && duplicates.length > 0
                ? "Save anyway"
                : "Save location"}
          </Button>
          <Button size="sm" variant="secondary" onClick={onClose} disabled={isBusy}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function LocationManagerView({
  locations,
  categoryOptions,
  tagOptions,
  categoryIcons,
  tagIcons,
}: {
  locations: SavedLocationWithUsage[];
  categoryOptions: string[];
  tagOptions: string[];
  /** Name -> icon URL for each list. Names without an icon are simply absent. */
  categoryIcons: Record<string, string>;
  tagIcons: Record<string, string>;
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
  const [isDeduping, setIsDeduping] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  /**
   * Bumped after any write, to force the filtered list to refetch.
   *
   * `router.refresh()` handles the unfiltered list, which renders the server's
   * `locations` prop. It cannot help a filtered one: that renders `results`,
   * client state owned by the search effect below, whose other dependencies
   * (the query and the filters) do not change when a place is saved.
   */
  const [reloadToken, setReloadToken] = useState(0);
  /** The token the search effect last acted on, to tell a write from a keystroke. */
  const lastReloadToken = useRef(0);

  const isFiltered = query.trim() !== "" || activeCategories.length > 0 || activeTags.length > 0;

  /** Repaints both lists after a write, whichever one is on screen. */
  const reload = useCallback(() => {
    router.refresh();
    setReloadToken((token) => token + 1);
  }, [router]);

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
    const run = async () => {
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
    };
    // The debounce is there to collapse keystrokes. A write is one deliberate
    // act and the reader is watching for the row to change, so a reload
    // repaints at once rather than a quarter-second later. Comparing the token
    // against the last one seen distinguishes the two: a keystroke leaves it
    // unchanged, a write bumps it.
    const isReload = reloadToken !== lastReloadToken.current;
    lastReloadToken.current = reloadToken;
    if (isReload) {
      void run();
      return () => {
        cancelled = true;
      };
    }
    const timer = setTimeout(run, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `reloadToken` is a
    // signal to refetch, not a value the query is built from.
  }, [query, activeCategories, activeTags, isFiltered, reloadToken]);

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
        // The first category that actually has an icon gives the pin its face;
        // a place with none keeps the numbered pin. First rather than "best"
        // because the categories are an unordered set and any tie-break here
        // would be arbitrary — the reader controls it by ordering the category.
        iconUrl: place.categories.map((name) => categoryIcons[name]).find(Boolean),
        // Clicking a pin opens the same detail the row below shows, so the
        // overview map identifies a place on its own.
        label: place.name,
        address: place.address || undefined,
        chips: [...place.categories, ...place.tags],
      })),
    [shown, categoryIcons],
  );

  function toggleFilter(list: string[], value: string, set: (next: string[]) => void) {
    set(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  async function handleDelete(place: SavedLocationWithUsage) {
    // No usage warning: nothing references these places yet — see 0140.
    if (!window.confirm(`Delete "${place.name || "this place"}"?`)) return;
    const result = await deleteSavedLocationAction(place.id);
    if (result.ok) reload();
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
                  iconUrl={categoryIcons[option]}
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
                  iconUrl={tagIcons[option]}
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
          <LocationMap
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

              </li>
            ))}
          </ul>
        </>
      )}

      {isDeduping && (
        <LocationDedupModal
          onClose={() => {
            setIsDeduping(false);
            reload();
          }}
        />
      )}
      {isAdding && (
        <EditSavedLocationModal
          categoryOptions={categoryOptions}
          tagOptions={tagOptions}
          categoryIcons={categoryIcons}
          tagIcons={tagIcons}
          onClose={() => setIsAdding(false)}
          onSaved={reload}
          actions={ADMIN_EDIT_LOCATION_ACTIONS}
        />
      )}
      {editing && (
        <EditSavedLocationModal
          location={editing}
          categoryOptions={categoryOptions}
          tagOptions={tagOptions}
          categoryIcons={categoryIcons}
          tagIcons={tagIcons}
          onClose={() => setEditing(undefined)}
          onSaved={reload}
          actions={ADMIN_EDIT_LOCATION_ACTIONS}
        />
      )}
    </div>
  );
}
