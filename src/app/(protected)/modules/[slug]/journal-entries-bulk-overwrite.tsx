"use client";

// The "Bulk overwrite" dialog behind the Entries screen's tick-boxes, used by
// both tabs (Main and Log) — the sibling of journal-entries-bulk-edit.tsx.
//
// Route-local for the same reason that one is: it is one screen's form over one
// module's fields, built from `Modal`, `TokenPicker`, `Button` and `BulkConfirm`,
// all of which are already in components.md.
//
// **Why a second dialog rather than a mode on the first.** Bulk edit already
// carries a `Replace` mode per field, so overwriting was always *possible* — it
// just had to be selected three times, once per field, with Add sitting next to
// it as the default. This dialog is that same server call with every mode pinned
// to `replace`: no mode buttons to get wrong, and overwrite as the stated
// premise of the screen rather than one of three readings of it. The field set,
// the pickers and the action are deliberately identical to the sibling's.
//
// **Tick to overwrite.** As in bulk edit, a field does nothing until its
// checkbox is on, and only ticked fields are sent. The meaning of the tick is
// what differs: there it is "change this field", here it is "replace this field
// outright".
//
// **The empty-list case is the dangerous one.** `replace` is the one mode the
// library accepts with no names, because "replace with nothing" is how a field
// gets cleared (see assertNamesPresent in src/lib/journal/bulk-edit.ts). That
// makes a ticked-but-empty field a silent wipe of every selected entry, so it is
// called out in red *and* routed through a `BulkConfirm` — the only path in this
// dialog that confirms. A fully-populated overwrite applies straight away; its
// warnings are on the screen the reader is already reading.
//
// **Narrow behaviour:** no field grid to collapse — every field is a stacked
// label/control pair at all widths, and `Modal` is already responsive. The
// address tab's map carries the same `max-lg:h-48` the sibling gives it.

import { useState } from "react";
import { BulkConfirm } from "@/components/bulk-confirm";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import { Tabs } from "@/components/tabs";
import { TokenPicker } from "@/components/token-picker";
import { isDuplicateLocation } from "@/lib/sys-locations";
import type { BulkEntryEditInput, JournalEntry } from "@/lib/journal";
import { LocationPickerField, type PickedLocation } from "@/app/(protected)/admin/locations/location-field";
import { JournalLocationLibraryPicker } from "./journal-location-library-picker";
import type { JournalLocationInput } from "./journal-actions";
import { bulkEditJournalEntriesAction, type BulkRefreshScope } from "./journal-bulk-actions";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export interface JournalEntriesBulkOverwriteProps {
  /** The ticked rows. Only their ids are sent; the rest is for the count. */
  selected: JournalEntry[];
  categoryOptions: string[];
  tagOptions: string[];
  /**
   * The saved-location library's own category/tag names, for the chips on the
   * "From your saved places" tab. Deliberately separate from the two above, as
   * in the sibling dialog: a *place* category ("Trailhead") and an *entry*
   * category are unrelated rows in unrelated tables.
   */
  locationCategoryOptions: string[];
  locationTagOptions: string[];
  /** Which list the caller wants back after the write. */
  scope: BulkRefreshScope;
  onCancel: () => void;
  /** Handed the refreshed rows and the one-line summary to show. */
  onApplied: (entries: JournalEntry[], message: string) => void;
}

export function JournalEntriesBulkOverwrite({
  selected,
  categoryOptions,
  tagOptions,
  locationCategoryOptions,
  locationTagOptions,
  scope,
  onCancel,
  onApplied,
}: JournalEntriesBulkOverwriteProps) {
  const [overwriteCategories, setOverwriteCategories] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);

  const [overwriteTags, setOverwriteTags] = useState(false);
  const [tags, setTags] = useState<string[]>([]);

  const [overwritePlaceName, setOverwritePlaceName] = useState(false);
  const [placeName, setPlaceName] = useState("");

  const [overwriteLocations, setOverwriteLocations] = useState(false);
  /** The pins to apply. Assembled from either tab; the dialog does not care which. */
  const [locations, setLocations] = useState<JournalLocationInput[]>([]);
  /** The address-search tab's working point, before it is added to the list. */
  const [picked, setPicked] = useState<PickedLocation | null>(null);

  const [error, setError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  /** Set when Apply found a ticked-but-empty field and wants it confirmed. */
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);

  const nothingEnabled =
    !overwriteCategories && !overwriteTags && !overwritePlaceName && !overwriteLocations;

  // Which ticked fields would be *cleared* rather than set. Every one of these
  // is a legal `replace` with an empty list, which is exactly why they are
  // worth naming before the write rather than after it.
  const clearedFields: string[] = [];
  if (overwriteCategories && categories.length === 0) clearedFields.push("categories");
  if (overwriteTags && tags.length === 0) clearedFields.push("tags");
  if (overwritePlaceName && placeName.trim() === "") clearedFields.push("place");
  if (overwriteLocations && locations.length === 0) clearedFields.push("locations");

  async function applyOverwrite() {
    // Every field goes out as `replace` — that is the whole difference between
    // this dialog and the bulk edit it shares an action with.
    const changes: BulkEntryEditInput = {};
    if (overwriteCategories) changes.categories = { mode: "replace", names: categories };
    if (overwriteTags) changes.tags = { mode: "replace", names: tags };
    if (overwritePlaceName) changes.placeName = placeName;
    if (overwriteLocations) changes.locations = { mode: "replace", locations };

    setIsSaving(true);
    setError(undefined);
    try {
      const result = await bulkEditJournalEntriesAction(
        selected.map((entry) => entry.id),
        changes,
        scope,
      );
      if (!result.ok || !result.entries) {
        setError(result.error ?? "Failed to overwrite the selected entries.");
        setIsConfirmingClear(false);
        return;
      }
      onApplied(result.entries, result.message ?? "Entries updated.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Failed to overwrite the selected entries.",
      );
      setIsConfirmingClear(false);
    } finally {
      setIsSaving(false);
    }
  }

  /**
   * Apply, via the clear-confirmation when one is warranted.
   *
   * A populated overwrite applies straight away: the reader picked the names
   * they want and the dialog has already said, twice, that what is there now
   * goes. A ticked-but-empty field is the one case where pressing Apply reads
   * as "leave this alone" and means "wipe it", so that one stops to ask.
   */
  function handleApply() {
    if (clearedFields.length > 0) {
      setIsConfirmingClear(true);
      return;
    }
    void applyOverwrite();
  }

  if (isConfirmingClear) {
    return (
      <BulkConfirm
        title="Clear these fields?"
        description={
          <>
            {listFields(clearedFields)} {clearedFields.length === 1 ? "is" : "are"} ticked with
            nothing picked, so {clearedFields.length === 1 ? "it" : "they"} will be{" "}
            <span className="text-ink">emptied</span> on every selected entry rather than set
            to anything.
          </>
        }
        count={selected.length}
        noun={{ one: "entry", many: "entries" }}
        caveat={
          <>
            This cannot be undone from here — the old values are not kept anywhere. Locked
            entries are skipped.
          </>
        }
        confirmLabel="Clear and overwrite"
        isBusy={isSaving}
        onConfirm={() => void applyOverwrite()}
        onCancel={() => setIsConfirmingClear(false)}
      />
    );
  }

  return (
    <Modal
      title="Bulk overwrite entries"
      description={`${selected.length} ${selected.length === 1 ? "entry" : "entries"} selected. Every field you tick is replaced outright — what these entries hold now is discarded, whether or not you can see it on the rows.`}
      onClose={onCancel}
      isBusy={isSaving}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={isSaving || nothingEnabled}
            onClick={handleApply}
          >
            {isSaving ? "Overwriting…" : "Overwrite"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {error && <p className="text-sm text-red-400">{error}</p>}

        <p className="rounded-md border border-red-400/40 px-3 py-2 text-xs text-muted">
          This screen does not add to what is already there. Ticking{" "}
          <span className="text-ink">Categories</span> and picking CAR and FINANCE leaves every
          selected entry with exactly those two, whatever it had before. Use{" "}
          <span className="text-ink">Bulk edit</span> if you meant to add or remove a few.
        </p>

        <NameField
          label="Categories"
          enabled={overwriteCategories}
          onEnabledChange={setOverwriteCategories}
          value={categories}
          onChange={setCategories}
          options={categoryOptions}
          placeholder="Filter or add a category…"
        />

        <NameField
          label="Tags"
          enabled={overwriteTags}
          onEnabledChange={setOverwriteTags}
          value={tags}
          onChange={setTags}
          options={tagOptions}
          placeholder="Filter or add a tag…"
        />

        <div className="flex flex-col gap-2">
          <FieldToggle
            label="Place"
            enabled={overwritePlaceName}
            onEnabledChange={setOverwritePlaceName}
          />
          <input
            type="text"
            value={placeName}
            disabled={!overwritePlaceName}
            onChange={(event) => setPlaceName(event.target.value)}
            placeholder="e.g. Princeton University"
            aria-label="Place"
            className={`${INPUT_CLASS} disabled:opacity-40`}
          />
          {overwritePlaceName && (
            <p className={placeName.trim() === "" ? "text-xs text-red-400" : "text-xs text-muted"}>
              {placeName.trim() === ""
                ? "Nothing typed: this clears the place on every selected entry."
                : "Replaces the place on every selected entry."}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <FieldToggle
            label="Locations"
            enabled={overwriteLocations}
            onEnabledChange={setOverwriteLocations}
          />

          {overwriteLocations && (
            <>
              {/* Two ways in, one list out -- the same pair the sibling dialog
                  offers, and for the same reason: only a library pick carries a
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
                          A point added this way is <span className="text-ink">not</span> linked
                          to a saved place, so it will not be counted in Saved Locations. Add it
                          in Admin → Locations first if you want it counted.
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

              <p className={locations.length === 0 ? "text-xs text-red-400" : "text-xs text-muted"}>
                {locations.length === 0
                  ? "Nothing picked: this clears every location on every selected entry."
                  : "Replaces every location on each selected entry. The pins each entry holds now — its own names, addresses and saved-place links — are discarded."}
              </p>
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

/** "categories", "categories and tags", "categories, tags and locations". */
function listFields(fields: string[]): string {
  if (fields.length <= 1) return fields[0] ?? "";
  return `${fields.slice(0, -1).join(", ")} and ${fields[fields.length - 1]}`;
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
 * One name-list field: the enable tick-box and the picker.
 *
 * The sibling dialog's mode buttons are deliberately absent — there is one mode
 * here, and a row of buttons with a single option is a worse way to say that
 * than no row at all.
 */
function NameField({
  label,
  enabled,
  onEnabledChange,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
  value: string[];
  onChange: (next: string[]) => void;
  options: string[];
  placeholder: string;
}) {
  const lower = label.toLowerCase();
  return (
    <div className="flex flex-col gap-2">
      <FieldToggle label={label} enabled={enabled} onEnabledChange={onEnabledChange} />

      <div className={enabled ? undefined : "pointer-events-none opacity-40"}>
        <TokenPicker
          label={label}
          value={value}
          onChange={onChange}
          options={options}
          allowCreate
          createPlaceholder={placeholder}
          hint={
            enabled && value.length === 0
              ? `Nothing picked: this clears the ${lower} on every selected entry.`
              : `Replaces every selected entry's ${lower} outright — what they hold now is discarded, including ${lower} not listed here.`
          }
        />
      </div>
    </div>
  );
}
