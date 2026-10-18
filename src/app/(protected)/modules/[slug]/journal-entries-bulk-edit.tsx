"use client";

// The "Bulk edit" dialog behind the Entries screen's tick-boxes, used by both
// tabs (Main and Log).
//
// Route-local, not a shared component: it is one screen's form over one
// module's fields. The reusable parts it is built from — `Modal`, `TokenPicker`,
// `Button` — are already in components.md.
//
// **Tick to enable.** A field does nothing until its checkbox is on, and only
// ticked fields are sent. This is the same shape as the Expense bulk edit, and
// for the same reason: a dialog of blank inputs is otherwise indistinguishable
// from "set all these to blank", which would be a quiet way to wipe a selection.
//
// **Modes, because these are lists.** Unlike Expense's single-valued fields, an
// entry holds *several* categories and tags, so "set this value" is not the only
// sensible instruction. Add appends, Remove strips, Replace overwrites — and
// Replace is called out in the hint, since it is the one that discards what the
// reader can't see on the rows.
//
// **Narrow behaviour:** the field grid is one column below 640px (`sm:` opens it
// to the label/control split), and `Modal` is already responsive.

import { useState } from "react";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import { Tabs } from "@/components/tabs";
import { TokenPicker } from "@/components/token-picker";
import { isDuplicateLocation } from "@/lib/sys-locations";
import type { BulkEntryEditInput, BulkNameMode, JournalEntry } from "@/lib/journal";
import { LocationPickerField, type PickedLocation } from "@/app/(protected)/admin/locations/location-field";
import { JournalLocationLibraryPicker } from "./journal-location-library-picker";
import type { JournalLocationInput } from "./journal-actions";
import { bulkEditJournalEntriesAction, type BulkRefreshScope } from "./journal-bulk-actions";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

const MODES: { value: BulkNameMode; label: string }[] = [
  { value: "add", label: "Add" },
  { value: "remove", label: "Remove" },
  { value: "replace", label: "Replace" },
];

export interface JournalEntriesBulkEditProps {
  /** The ticked rows. Only their ids are sent; the rest is for the count. */
  selected: JournalEntry[];
  categoryOptions: string[];
  tagOptions: string[];
  /**
   * The saved-location library's own category/tag names, for the chips on the
   * "From your saved places" tab. Deliberately separate from the two above:
   * a *place* category ("Trailhead") and an *entry* category are unrelated rows
   * in unrelated tables.
   */
  locationCategoryOptions: string[];
  locationTagOptions: string[];
  /** Which list the caller wants back after the write. */
  scope: BulkRefreshScope;
  onCancel: () => void;
  /** Handed the refreshed rows and the one-line summary to show. */
  onApplied: (entries: JournalEntry[], message: string) => void;
}

export function JournalEntriesBulkEdit({
  selected,
  categoryOptions,
  tagOptions,
  locationCategoryOptions,
  locationTagOptions,
  scope,
  onCancel,
  onApplied,
}: JournalEntriesBulkEditProps) {
  const [editCategories, setEditCategories] = useState(false);
  const [categoryMode, setCategoryMode] = useState<BulkNameMode>("add");
  const [categories, setCategories] = useState<string[]>([]);

  const [editTags, setEditTags] = useState(false);
  const [tagMode, setTagMode] = useState<BulkNameMode>("add");
  const [tags, setTags] = useState<string[]>([]);

  const [editPlaceName, setEditPlaceName] = useState(false);
  const [placeName, setPlaceName] = useState("");

  const [editLocations, setEditLocations] = useState(false);
  const [locationMode, setLocationMode] = useState<BulkNameMode>("add");
  /** The pins to apply. Assembled from either tab; the dialog does not care which. */
  const [locations, setLocations] = useState<JournalLocationInput[]>([]);
  /** The address-search tab's working point, before it is added to the list. */
  const [picked, setPicked] = useState<PickedLocation | null>(null);

  const [error, setError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  const nothingEnabled = !editCategories && !editTags && !editPlaceName && !editLocations;

  // Replace is the only mode that means something with an empty list ("clear
  // this field"), so it is the only one that may be applied without names.
  const categoriesIncomplete =
    editCategories && categoryMode !== "replace" && categories.length === 0;
  const tagsIncomplete = editTags && tagMode !== "replace" && tags.length === 0;
  const locationsIncomplete =
    editLocations && locationMode !== "replace" && locations.length === 0;

  async function handleApply() {
    const changes: BulkEntryEditInput = {};
    if (editCategories) changes.categories = { mode: categoryMode, names: categories };
    if (editTags) changes.tags = { mode: tagMode, names: tags };
    if (editPlaceName) changes.placeName = placeName;
    if (editLocations) changes.locations = { mode: locationMode, locations };

    setIsSaving(true);
    setError(undefined);
    try {
      const result = await bulkEditJournalEntriesAction(
        selected.map((entry) => entry.id),
        changes,
        scope,
      );
      if (!result.ok || !result.entries) {
        setError(result.error ?? "Failed to edit the selected entries.");
        return;
      }
      onApplied(result.entries, result.message ?? "Entries updated.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to edit the selected entries.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal
      title="Bulk edit entries"
      description={`${selected.length} ${selected.length === 1 ? "entry" : "entries"} selected. Only the fields you tick are changed; everything else is left alone.`}
      onClose={onCancel}
      isBusy={isSaving}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            disabled={
              isSaving ||
              nothingEnabled ||
              categoriesIncomplete ||
              tagsIncomplete ||
              locationsIncomplete
            }
            onClick={() => void handleApply()}
          >
            {isSaving ? "Applying…" : "Apply"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {error && <p className="text-sm text-red-400">{error}</p>}

        <NameField
          label="Categories"
          enabled={editCategories}
          onEnabledChange={setEditCategories}
          mode={categoryMode}
          onModeChange={setCategoryMode}
          value={categories}
          onChange={setCategories}
          options={categoryOptions}
          placeholder="Filter or add a category…"
        />

        <NameField
          label="Tags"
          enabled={editTags}
          onEnabledChange={setEditTags}
          mode={tagMode}
          onModeChange={setTagMode}
          value={tags}
          onChange={setTags}
          options={tagOptions}
          placeholder="Filter or add a tag…"
        />

        <div className="flex flex-col gap-2">
          <FieldToggle label="Place" enabled={editPlaceName} onEnabledChange={setEditPlaceName} />
          <input
            type="text"
            value={placeName}
            disabled={!editPlaceName}
            onChange={(event) => setPlaceName(event.target.value)}
            placeholder="e.g. Princeton University"
            aria-label="Place"
            className={`${INPUT_CLASS} disabled:opacity-40`}
          />
          {editPlaceName && placeName.trim() === "" && (
            <p className="text-xs text-muted">
              Left empty, this <span className="text-ink">clears</span> the place on every
              selected entry.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <FieldToggle
            label="Locations"
            enabled={editLocations}
            onEnabledChange={setEditLocations}
          />
          <div className="flex flex-wrap gap-1.5">
            {MODES.map((option) => (
              <Button
                key={option.value}
                variant={locationMode === option.value ? "primary" : "secondary"}
                disabled={!editLocations}
                onClick={() => setLocationMode(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>

          {editLocations && (
            <>
              {/* Two ways in, one list out. The dialog does not care which tab a
                  pin came from -- only a library pick carries a
                  `savedLocationId`, and that is what decides whether it counts
                  in Journal -> Saved Locations. */}
              <Tabs
                defaultActiveKey="library"
                items={[
                  {
                    key: "library",
                    label: "From your saved places",
                    content: (
                      <JournalLocationLibraryPicker
                        categoryOptions={locationCategoryOptions}
                        tagOptions={locationTagOptions}
                        onPick={(location) => {
                          // The same guard the entry form runs: refuse a place
                          // already in this list, whatever it is named there.
                          setLocations((previous) =>
                            isDuplicateLocation(previous, location)
                              ? previous
                              : [...previous, location],
                          );
                        }}
                      />
                    ),
                  },
                  {
                    key: "address",
                    label: "Search an address",
                    content: (
                      <div className="flex flex-col gap-2">
                        <LocationPickerField
                          value={picked}
                          onChange={setPicked}
                          showAddress
                          mapHeightClassName="h-64 max-lg:h-48"
                        />
                        <div>
                          <Button
                            variant="secondary"
                            disabled={picked === null}
                            onClick={() => {
                              if (!picked) return;
                              const location: JournalLocationInput = {
                                latitude: picked.latitude,
                                longitude: picked.longitude,
                                locationName: picked.name,
                                streetAddress: picked.streetAddress,
                                // No savedLocationId on purpose: this pin is not
                                // a library row, so it links to nothing and
                                // counts nowhere. Save it in Admin -> Locations
                                // first if you want it counted.
                              };
                              setLocations((previous) =>
                                isDuplicateLocation(previous, location)
                                  ? previous
                                  : [...previous, location],
                              );
                              setPicked(null);
                            }}
                          >
                            Add this point
                          </Button>
                        </div>
                        <p className="text-xs text-muted">
                          A point added this way is <span className="text-ink">not</span>{" "}
                          linked to a saved place, so it will not be counted in Saved
                          Locations. Add it in Admin → Locations first if you want it
                          counted.
                        </p>
                      </div>
                    ),
                  },
                ]}
              />

              {locations.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {locations.map((location, index) => (
                    <li
                      key={`${location.latitude},${location.longitude}`}
                      className="flex items-center justify-between gap-2 rounded-md border border-line px-2 py-1 text-sm"
                    >
                      <span className="min-w-0 truncate text-ink">
                        {location.locationName.trim() ||
                          location.streetAddress ||
                          `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`}
                        {location.savedLocationId === undefined && (
                          <span className="ml-2 text-xs text-muted">(not linked)</span>
                        )}
                      </span>
                      <Button
                        variant="secondary"
                        onClick={() =>
                          setLocations((previous) => previous.filter((_, i) => i !== index))
                        }
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              <p className="text-xs text-muted">{hintForLocations(locationMode)}</p>
            </>
          )}
        </div>

        <p className="text-xs text-muted">
          Locked entries are skipped — unlock one first if you meant to change it. Nothing here
          touches an entry&apos;s date, time, title or text.
        </p>
      </div>
    </Modal>
  );
}

/** The tick-box and label that gate one field. */
function FieldToggle({
  label,
  enabled,
  onEnabledChange,
}: {
  label: string;
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium text-ink">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(event) => onEnabledChange(event.target.checked)}
        className="h-4 w-4 accent-brass"
      />
      {label}
    </label>
  );
}

/**
 * One name-list field: the enable tick-box, the three modes, and the picker.
 *
 * The mode buttons are disabled rather than hidden while the field is off, so
 * the control doesn't change height when it's ticked — the dialog would
 * otherwise jump under the reader's cursor.
 */
function NameField({
  label,
  enabled,
  onEnabledChange,
  mode,
  onModeChange,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
  mode: BulkNameMode;
  onModeChange: (next: BulkNameMode) => void;
  value: string[];
  onChange: (next: string[]) => void;
  options: string[];
  placeholder: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FieldToggle label={label} enabled={enabled} onEnabledChange={onEnabledChange} />
        <div
          role="group"
          aria-label={`How to apply ${label.toLowerCase()}`}
          className="flex items-center gap-1"
        >
          {MODES.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={mode === option.value ? "primary" : "secondary"}
              disabled={!enabled}
              onClick={() => onModeChange(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <div className={enabled ? undefined : "pointer-events-none opacity-40"}>
        <TokenPicker
          label={label}
          value={value}
          onChange={onChange}
          options={options}
          allowCreate
          createPlaceholder={placeholder}
          hint={hintFor(label, mode)}
        />
      </div>
    </div>
  );
}

/**
 * The same three sentences the name fields get, worded for pins.
 *
 * `add` says "already there" explicitly because the duplicate rule is by
 * *coordinates*, not by name: an entry pinned at the playground under another
 * name is not given a second row, and a reader who does not know that would read
 * the skip as a bug.
 */
function hintForLocations(mode: BulkNameMode): string {
  if (mode === "add") {
    return "Appended to the locations each entry already has. An entry already pinned at one of these places keeps its own record of it, and gets no second row.";
  }
  if (mode === "remove") {
    return "Stripped from the selection, matched by coordinates whatever the entry names them. Other locations are left alone.";
  }
  return "Replaces every location on each selected entry. Left empty, this clears them.";
}

function hintFor(label: string, mode: BulkNameMode): string {
  const lower = label.toLowerCase();
  if (mode === "add") return `Appended to the ${lower} each entry already has.`;
  if (mode === "remove") return `Stripped from the selection. Other ${lower} are left alone.`;
  return `Replaces every entry's ${lower} outright — what they have now is discarded.`;
}
