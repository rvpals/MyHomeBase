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
import { CollapsibleCard } from "@/components/collapsible-card";
import { Comments } from "@/components/comments";
import { Modal } from "@/components/modal";
import { Tabs } from "@/components/tabs";
import { TreeIcon } from "@/components/tree-icons";
import { ViewModeSwitch, type ViewModeOption } from "@/components/view-mode-switch";
import { LocationFilterChips } from "@/components/location-filter-chips";
import { LocationGraphView } from "@/components/location-graph-view";
import { LocationVenn } from "@/components/location-venn";
import { SavedLocationRow } from "@/components/saved-location-row";
import {
  MAX_VENN_SETS,
  buildVennLayout,
  defaultVennNames,
  rankTaxonomyNames,
  type LocationTaxonomyKind,
  type SaveLocationInput,
  type SavedLocation,
  type SavedLocationWithUsage,
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
 * How the saved places are drawn. The same rows either way — this is one
 * dataset re-cut, which is why the control is a `ViewModeSwitch` and not
 * `Tabs`. List is the dense scan; Card gives each place room to show its
 * address, coordinates and chips without truncating.
 *
 * `venn` re-cuts the same rows again, by what they have in common: two or three
 * overlapping circles with each place's *name* sitting in the region its tags
 * put it in. It drops everything but the name on purpose — a region is a small
 * hole in a fixed picture, and an address or a chip row would not fit one.
 *
 * `graph` is the same question asked loosely: every place a dot, a line wherever
 * two places share a name, arranged by a physics simulation. The Venn is exact
 * about two or three names; the graph is approximate about all of them, so
 * clusters appear without having to be named first. They answer differently
 * enough to both be worth having.
 */
type LocationListView = "list" | "card" | "venn" | "graph";

const VIEW_OPTIONS: readonly ViewModeOption<LocationListView>[] = [
  { key: "list", label: "List", hint: "One compact row per place" },
  { key: "card", label: "Card", hint: "A roomier card per place" },
  { key: "venn", label: "Venn", hint: "Where the places overlap by tag or category" },
  { key: "graph", label: "Graph", hint: "Places joined wherever they share a tag" },
];

/**
 * Which taxonomy the Venn and the graph read. One at a time, never both at once:
 * tags and categories are independent axes, and mixing them would make an
 * overlap — or an edge — mean two unrelated things.
 *
 * Shared by both views deliberately. Switching List → Venn → Graph should not
 * silently change which axis you are looking at.
 */
const VENN_BASIS_OPTIONS: readonly ViewModeOption<LocationTaxonomyKind>[] = [
  { key: "tag", label: "Tags", hint: "Group the places by their tags" },
  { key: "category", label: "Categories", hint: "Group the places by their categories" },
];

/** Per-device, same reasoning as the view and map choices. */
const VENN_BASIS_STORAGE_KEY = "myhomebase:admin-location-manager-venn-basis";

/**
 * Per-device, so `localStorage` rather than a settings row: which shape suits
 * is a function of the screen you are looking at, and a phone and a desktop
 * wanting different answers is the normal case, not a conflict to resolve.
 */
const VIEW_STORAGE_KEY = "myhomebase:admin-location-manager-view";

/**
 * How much room the overview map takes.
 *
 * This is what used to be a second screen. Admin → Locations → Location Map was
 * this same library, the same filters and the same rows, differing only in that
 * the map led and the list was a rail beside it — so it is a size, not a place,
 * and it folded in here rather than staying a route of its own.
 *
 * `hidden` is new to the merge: the old Manager always paid for a map, which is
 * dead weight when you came to correct a dozen addresses.
 */
type MapMode = "compact" | "tall" | "hidden";

const MAP_OPTIONS: readonly ViewModeOption<MapMode>[] = [
  { key: "compact", label: "Compact", hint: "A short map above the list" },
  { key: "tall", label: "Tall", hint: "A large map with the list beside it" },
  { key: "hidden", label: "Hidden", hint: "The list only, no map" },
];

/**
 * Defaults to `compact`, which is what the Manager has always looked like.
 * Readers arriving from the retired Map screen are the ones being moved, so
 * they are the ones who re-pick; readers already here see no change.
 */
const MAP_STORAGE_KEY = "myhomebase:admin-location-manager-map";

/**
 * The graph's only control: which taxonomy joins the places.
 *
 * No name picker, unlike the Venn's — the graph reads *every* name at once,
 * which is the whole reason it exists alongside a diagram capped at three. The
 * axis is still a choice, and it is the same stored choice the Venn uses, so
 * switching between the two views does not silently change what you are
 * looking at.
 */
function GraphBasisPicker({
  basis,
  onBasisChange,
}: {
  basis: LocationTaxonomyKind;
  onBasisChange: (next: LocationTaxonomyKind) => void;
}) {
  return (
    <div className="rounded-md border border-line bg-paper-raised p-3">
      <ViewModeSwitch
        options={VENN_BASIS_OPTIONS}
        value={basis}
        onChange={onBasisChange}
        label="Connect by"
      />
    </div>
  );
}

/**
 * The Venn's own controls: which taxonomy to intersect on, and which two or
 * three of its names to draw.
 *
 * Route-local rather than a registered component, for the same reason
 * `LocationRowActions` is: it is this diagram's control panel, and nothing else
 * renders a Venn. Promote it if a second screen ever does.
 *
 * Deliberately separate from the Categories / Tags filter chips above, which do
 * a different job — those *narrow* which places are listed (AND semantics), these
 * choose which circles the remaining places are sorted into. Folding the two
 * together would mean picking a third tag could only ever shrink the diagram to
 * the places carrying all three, which is the one view a Venn exists to avoid.
 */
function VennPicker({
  basis,
  onBasisChange,
  choices,
  active,
  onToggle,
}: {
  basis: LocationTaxonomyKind;
  onBasisChange: (next: LocationTaxonomyKind) => void;
  choices: { name: string; count: number }[];
  active: string[];
  onToggle: (name: string) => void;
}) {
  const isFull = active.length >= MAX_VENN_SETS;
  const word = basis === "tag" ? "tags" : "categories";

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-paper-raised p-3">
      <div className="flex items-center justify-between gap-3 max-lg:flex-col max-lg:items-stretch">
        <ViewModeSwitch
          options={VENN_BASIS_OPTIONS}
          value={basis}
          onChange={onBasisChange}
          label="Intersect by"
        />
        <p className="text-xs text-muted">
          {active.length} of {MAX_VENN_SETS} circles
          {isFull ? " — deselect one to swap" : ""}
        </p>
      </div>

      {choices.length === 0 ? (
        <p className="text-xs text-muted">
          None of the places listed carry any {word}.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {choices.map((choice) => {
            const isActive = active.includes(choice.name);
            return (
              <FilterChip
                key={choice.name}
                label={choice.name}
                count={choice.count}
                isActive={isActive}
                /* A full diagram leaves the unpicked chips inert rather than
                   hidden: the reader still needs to see what else exists, and a
                   chip that vanishes on a third click reads as a bug. */
                onToggle={() => {
                  if (isActive || !isFull) onToggle(choice.name);
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Edit and delete for one place. Shared by both views so the two can't drift
 * apart — the glyphs stay hand-drawn `TreeIcon`s because row actions are not
 * places, so they take no icon slot (coding-guide.md → Icons).
 */
function LocationRowActions({
  place,
  onEdit,
  onDelete,
}: {
  place: SavedLocationWithUsage;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const label = place.name || "unnamed place";
  return (
    <>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit "${label}"`}
        title="Edit"
        className="text-muted hover:text-brass"
      >
        <TreeIcon name="pencil" className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete "${label}"`}
        title="Delete"
        className="text-muted hover:text-red-400"
      >
        <TreeIcon name="trash" className="h-4 w-4" />
      </button>
    </>
  );
}


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
  /**
   * Heading above the chips. Omitted inside a tab, where the tab's own label
   * already names the list and a second copy of the word would just be noise —
   * the "+" button then sits on its own line, which is what it needs anyway.
   */
  title?: string;
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
        {title && <span className="text-sm font-medium text-ink">{title}</span>}
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
   * Whether the Mapping box is open. Controlled rather than left to
   * `CollapsibleCard`'s remembered state, which is keyed by position on the
   * route and would hand a *new* location whatever the reader last left an
   * *edit* on — collapsed, most likely, hiding the one control a new location
   * cannot be saved without. So: open when there is no point yet.
   */
  const [isMapOpen, setIsMapOpen] = useState(!point);
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
      className="max-w-5xl"
      title={location ? `Edit "${location.name || "unnamed place"}"` : "Add a location"}
      /* How the whole screen works, behind the mark rather than inline: the
         explanation is worth having once and not worth the four lines it would
         cost above the first field every time the dialog opens. `titleAction`
         is Modal's slot for an affordance acting on this dialog — the glyph
         sits on the title line, left of the window chrome. */
      titleAction={
        <Comments
          title="How this screen works"
          content={
            <div className="flex flex-col gap-2">
              <p>
                A location is a <span className="text-ink">point on the map</span> plus
                the details you file it under. The point is the part that matters — it is
                what Save needs, and what everything else hangs off.
              </p>
              <p>
                Open <span className="text-ink">Mapping</span> at the bottom first and
                search for an address, or click the map. That sets the point and fills the
                address in for you.
              </p>
              <p>
                Then give it a <span className="text-ink">name</span> you will recognise,
                and add <span className="text-ink">categories and tags</span> so you can
                filter for it later in the location list.
              </p>
            </div>
          }
        />
      }
    >
      <div className="flex flex-col gap-4">
        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="panel-inset flex flex-col gap-3 rounded-md bg-paper p-3">
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
        </div>

        {/* Two tabs rather than both lists stacked: they are the same kind of
            answer to two questions, and only one is being filled in at a time.
            Uncontrolled — nothing outside the strip switches it. The counts ride
            on the labels so the tab you are not looking at still reports what it
            holds, which is the thing stacking them used to give you for free. */}
        <div className="panel-inset rounded-md bg-paper p-3">
          <Tabs
            items={[
              {
                key: "categories",
                label: `Categories${categories.length > 0 ? ` (${categories.length})` : ""}`,
                content: (
                  <TaxonomyChoices
                    kind="category"
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
                ),
              },
              {
                key: "tags",
                label: `Tags${tags.length > 0 ? ` (${tags.length})` : ""}`,
                content: (
                  <TaxonomyChoices
                    kind="tag"
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
                ),
              },
            ]}
            defaultActiveKey="categories"
          />
        </div>

        {/* Controlled, so it opens itself when there is no point yet: a new
            location cannot be saved without one, and a collapsed box would hide
            the only control that sets it. An edit arrives with a point already,
            so it opens collapsed and the map stays out of the way. */}
        <CollapsibleCard
          title="Mapping"
          open={isMapOpen}
          onOpenChange={setIsMapOpen}
          /* The pin rides on the header, because the coordinates and the Clear
             button live inside the picker — collapsed, nothing would say whether
             a point had been set, which is the one thing Save depends on. */
          headerAction={
            <span className="font-mono text-xs text-muted">
              {point ? formatCoords(point.latitude, point.longitude) : "No point set"}
            </span>
          }
        >
          <LocationPickerField
            value={point}
            onChange={handlePointChange}
            showName={false}
            mapHeightClassName="h-[28rem] max-lg:h-80"
            /* Beside Search, which is the control it explains — a mark on the
               card header would have sat a long way from the thing it is about. */
            searchAction={
              <Comments
                title="Setting the point"
                content={
                  <div className="flex flex-col gap-2">
                    <p>
                      Type a street address or a place name in the box and press{" "}
                      <span className="text-ink">Search</span>, then pick the right match
                      from the list underneath. The map jumps there and drops the pin.
                    </p>
                    <p>
                      If you already know where it is, click the map directly instead —
                      that drops the pin where you clicked and fills the address in from
                      it. Click again to nudge it.
                    </p>
                    <p>
                      Some places have no street address at all — a trailhead, a campsite,
                      a spot in a park. Clicking the map is how you save those.
                    </p>
                  </div>
                }
              />
            }
          />
        </CollapsibleCard>

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
  const [view, setView] = useState<LocationListView>("list");
  const [mapMode, setMapMode] = useState<MapMode>("compact");
  const [vennBasis, setVennBasis] = useState<LocationTaxonomyKind>("tag");
  /**
   * The names the Venn draws, or undefined to follow the most-used ones.
   *
   * Undefined rather than the computed default so the picker keeps tracking the
   * data until the reader overrides it: filter the list down and the circles
   * re-aim at what is actually on screen, but once you have swapped a circle by
   * hand that choice stands.
   *
   * Reset to undefined when the basis changes — a tag name is not a category
   * name, so carrying the selection across would leave three empty circles.
   */
  const [vennNames, setVennNames] = useState<string[] | undefined>(undefined);
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

  // Read on mount rather than in the `useState` initialiser: `window` does not
  // exist on the server, so touching it during the first render would make the
  // server and client markup disagree. Defaulting to "list" means the screen
  // renders exactly as it did before anyone has chosen.
  useEffect(() => {
    const storedView = window.localStorage.getItem(VIEW_STORAGE_KEY);
    const storedMap = window.localStorage.getItem(MAP_STORAGE_KEY);
    const storedBasis = window.localStorage.getItem(VENN_BASIS_STORAGE_KEY);
     
    // choices are unknowable during render; one extra render is the price of
    // correct hydration. Runs once on mount and never re-fires.
    if (
      storedView === "list" ||
      storedView === "card" ||
      storedView === "venn" ||
      storedView === "graph"
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing state to a prop or to browser-only data that is unknowable during render; runs on mount or when that input changes, not in a loop.
      setView(storedView);
    }
    if (storedMap === "compact" || storedMap === "tall" || storedMap === "hidden") {
       
      setMapMode(storedMap);
    }
    if (storedBasis === "tag" || storedBasis === "category") {
       
      setVennBasis(storedBasis);
    }
  }, []);

  function chooseView(next: LocationListView) {
    setView(next);
    window.localStorage.setItem(VIEW_STORAGE_KEY, next);
  }

  function chooseMapMode(next: MapMode) {
    setMapMode(next);
    window.localStorage.setItem(MAP_STORAGE_KEY, next);
  }

  /** Switching axis drops the hand-picked names — see `vennNames`. */
  function chooseVennBasis(next: LocationTaxonomyKind) {
    setVennBasis(next);
    setVennNames(undefined);
    window.localStorage.setItem(VENN_BASIS_STORAGE_KEY, next);
  }

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
     
    // signal to refetch, not a value the query is built from.
  }, [query, activeCategories, activeTags, isFiltered, reloadToken]);

  // Memoised so the pin list below keeps a stable identity across renders that
  // changed neither the filters nor the rows.
  const shown = useMemo(
    () => (isFiltered ? (results ?? []) : locations),
    [isFiltered, results, locations],
  );

  /**
   * Every name available to the Venn's picker, most-used first.
   *
   * Ranked over `shown`, not the whole library: the diagram sits below the
   * search box and the filter chips, so "most-used" has to mean most-used among
   * the places actually on screen.
   */
  const vennChoices = useMemo(
    () => (view === "venn" ? rankTaxonomyNames(shown, vennBasis) : []),
    [view, shown, vennBasis],
  );

  /** The names actually drawn: the reader's picks, else the most-used ones. */
  const activeVennNames = useMemo(
    () => vennNames ?? defaultVennNames(shown, vennBasis),
    [vennNames, shown, vennBasis],
  );

  const vennLayout = useMemo(
    () => (view === "venn" ? buildVennLayout(shown, activeVennNames, vennBasis) : undefined),
    [view, shown, activeVennNames, vennBasis],
  );

  /**
   * Adds a name if there is room, removes it if already drawn.
   *
   * Seeded from `activeVennNames` rather than `vennNames`, so the first click
   * edits the defaults the reader can see instead of starting from an empty set.
   */
  function toggleVennName(name: string) {
    const current = activeVennNames;
    if (current.includes(name)) {
      setVennNames(current.filter((entry) => entry !== name));
      return;
    }
    if (current.length >= MAX_VENN_SETS) return;
    setVennNames([...current, name]);
  }

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

      <LocationFilterChips
        categoryOptions={categoryOptions}
        tagOptions={tagOptions}
        categoryIcons={categoryIcons}
        tagIcons={tagIcons}
        activeCategories={activeCategories}
        activeTags={activeTags}
        onCategoriesChange={setActiveCategories}
        onTagsChange={setActiveTags}
      />

      {shown.length === 0 ? (
        <p className="text-sm text-muted">
          {isFiltered ? "No places match that." : "No saved places yet — add your first one."}
        </p>
      ) : (
        <>
          {/* The two controls that shape this screen, on one row: how big the
              map is, and how the rows are drawn. Both sit above the thing they
              change, and apart from the search row, which is about *which*
              places show — a different question. */}
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <ViewModeSwitch
              options={MAP_OPTIONS}
              value={mapMode}
              onChange={chooseMapMode}
              label="Map"
            />
            <ViewModeSwitch
              options={VIEW_OPTIONS}
              value={view}
              onChange={chooseView}
              label="View"
            />
          </div>

          {/* Tall puts the map first with the list as a rail beside it — the
              shape the retired Location Map screen had. Below 1024px the
              columns collapse to one, so narrow screens stack map-then-list in
              every mode and only the height differs. */}
          <div
            className={
              /* The tall map's split exists to put the *list* in a rail beside
                 it. The Venn and the graph are wide pictures that need their own
                 width, so they opt out and run full width under the map instead
                 — hence the view check here and not just on `mapMode`. */
              mapMode === "tall" && view !== "venn" && view !== "graph"
                ? "grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]"
                : "contents"
            }
          >
            {mapMode !== "hidden" && (
              /* Shorter on a phone via `max-lg:`, so the desktop height is
                 provably untouched (design.md → Reach for CSS first). */
              <LocationMap
                marker={null}
                markers={markers}
                center={null}
                heightClassName={
                  mapMode === "tall" ? "h-[64rem] max-lg:h-[32rem]" : "h-[40rem] max-lg:h-[26rem]"
                }
              />
            )}

            {/* One list in every mode — only the shape and the grid change.
                `.card-grid`, not `grid-cols-N max-lg:grid-cols-1`: the library
                is variable-length, so the column count should follow the space
                actually available (design.md → Collections size themselves).

                Beside a tall map the list scrolls to the map's height, so the
                two read against each other instead of the page running on past
                it. Full width, it simply runs down the page. */}
            {view === "graph" ? (
              /* Same substitution the Venn makes: one arrangement of the rows at
                 a time, or every place would be drawn twice. */
              <div className="min-w-0">
                <GraphBasisPicker basis={vennBasis} onBasisChange={chooseVennBasis} />
                <LocationGraphView
                  places={shown}
                  kind={vennBasis}
                  /* Clicking a node opens the same editor the other views open
                     from their row actions. */
                  onSelect={setEditing}
                  className="mt-3"
                />
              </div>
            ) : view === "venn" && vennLayout ? (
              /* The Venn replaces the list rather than sitting beside it: it is
                 the same rows in a different arrangement, so showing both would
                 draw every place twice. */
              <div className="min-w-0">
                <VennPicker
                  basis={vennBasis}
                  onBasisChange={chooseVennBasis}
                  choices={vennChoices}
                  active={activeVennNames}
                  onToggle={toggleVennName}
                />
                <LocationVenn
                  layout={vennLayout}
                  /* Clicking a name opens the same editor the other two views
                     open from their row actions. */
                  onSelect={setEditing}
                  className="mt-3"
                />
              </div>
            ) : (
              <ul
                className={`${view === "card" ? "card-grid gap-4" : "flex flex-col gap-1"} ${
                  mapMode === "tall"
                    ? "min-w-0 max-h-[64rem] overflow-y-auto max-lg:max-h-[36rem]"
                    : ""
                }`}
              >
                {shown.map((place, index) => (
                  <li key={place.id}>
                    <SavedLocationRow
                      place={place}
                      /* Narrowed because `view` also carries "venn", which this
                         row has no shape for — that branch renders above. */
                      shape={view === "card" ? "card" : "list"}
                      number={index + 1}
                      actions={
                        <LocationRowActions
                          place={place}
                          onEdit={() => setEditing(place)}
                          onDelete={() => handleDelete(place)}
                        />
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
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
