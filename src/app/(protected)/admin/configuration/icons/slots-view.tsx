"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/button";
import { SlotIcon } from "@/components/slot-icon";
import { ICON_OVERRIDE_MAX_BYTES, type IconOverride, type IconSlot } from "@/lib/icons";
import { clearIconOverrideAction, saveIconOverrideAction } from "../../actions";

/** One row: a slot, its current glyph, and the controls to replace or reset it. */
function SlotRow({
  slot,
  setId,
  initialOverride,
}: {
  slot: IconSlot;
  setId: string;
  initialOverride?: IconOverride;
}) {
  const [override, setOverride] = useState(initialOverride);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;

    // Checked here as well as in the lib for the reason the carousel control gives: an
    // oversized file otherwise gets read and posted, and what comes back is a framework
    // body-limit error rather than something a reader can act on.
    if (file.size > ICON_OVERRIDE_MAX_BYTES) {
      setError(
        `That file is ${Math.round(file.size / 1024)} KB — keep it under ${Math.round(
          ICON_OVERRIDE_MAX_BYTES / 1024,
        )} KB.`,
      );
      if (fileInput.current) fileInput.current.value = "";
      return;
    }

    setIsBusy(true);
    setError(undefined);
    try {
      const body = new FormData();
      body.set("slotId", slot.id);
      body.set("setId", setId);
      body.set("icon", file);

      const result = await saveIconOverrideAction(body);
      if (result.ok) {
        // The page revalidates, but this keeps the row honest until it does.
        setOverride({ slotId: slot.id, setId, updatedAt: new Date().toISOString() });
      } else {
        setError(result.error);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read that file.");
    } finally {
      setIsBusy(false);
      // Cleared so re-picking the *same* file still fires a change event.
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function handleReset() {
    setIsBusy(true);
    setError(undefined);
    const result = await clearIconOverrideAction(slot.id, setId);
    if (result.ok) setOverride(undefined);
    else setError(result.error);
    setIsBusy(false);
  }

  const isCustom = Boolean(override);

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line p-3 max-lg:gap-3">
      <span className="flex shrink-0 items-center gap-2">
        <span className="flex h-12 w-12 items-center justify-center rounded-lg border border-line bg-paper text-brass-dark">
          {/* Renders through the same component the app uses, so this preview cannot
              disagree with what the card shows. */}
          <SlotIcon slot={slot} className="h-6 w-6" />
        </span>
        {/* Actual size. 20px is the largest a slot icon ever renders (the compact
            "Sections" trigger on a phone), 16px is every nav row and card header — so
            these two are the only sizes that matter, and a glyph that dies at 16px should
            be obvious here rather than after a deploy. */}
        <span
          className="flex h-12 w-9 flex-col items-center justify-center gap-1 rounded-lg border border-line bg-paper text-brass-dark"
          title="Actual size: 20px (phone section bar) and 16px (nav rows, card headers)"
        >
          <SlotIcon slot={slot} className="h-5 w-5" />
          <SlotIcon slot={slot} className="h-4 w-4" />
        </span>
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{slot.label}</p>
        {/* The click path to this icon. Several labels read alike out of context — every
            module has a "Dashboard" — so this is what tells them apart. */}
        <p className="mt-0.5 text-xs text-muted">{slot.where}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span className="font-mono">{slot.id}</span>
          <span aria-hidden="true">·</span>
          <span>{isCustom ? "Custom icon" : `Using the set's ${slot.defaultConcept} glyph`}</span>
          {/* Said plainly, because the alternative is an upload that appears to work and
              changes nothing on screen. */}
          {!slot.wired && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-brass-dark">Not yet wired up — uploads won&apos;t show yet</span>
            </>
          )}
        </p>
        {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-2 max-lg:w-full">
        <input
          ref={fileInput}
          type="file"
          accept="image/svg+xml,image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(event) => handleFile(event.target.files?.[0])}
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={isBusy}
          onClick={() => fileInput.current?.click()}
        >
          {isCustom ? "Replace" : "Upload"}
        </Button>
        {isCustom && (
          <Button size="sm" variant="secondary" disabled={isBusy} onClick={handleReset}>
            Reset
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The per-slot override list: every named icon position in the app, each replaceable.
 *
 * Driven entirely by `ICON_SLOTS`, so a newly registered slot appears here without this
 * file changing.
 */
export function IconSlotsView({
  groups,
  setId,
  setName,
  overrides,
}: {
  groups: { group: string; slots: IconSlot[] }[];
  setId: string;
  setName: string;
  overrides: Record<string, IconOverride>;
}) {
  const [activeGroup, setActiveGroup] = useState<string>(groups[0]?.group ?? "");
  const [filter, setFilter] = useState("");

  const needle = filter.trim().toLowerCase();
  const isFiltering = needle.length > 0;

  // Matched across `label`, `where` and `id`. `where` is the click path ("Admin →
  // Configuration → Icons"), which is how someone who knows the screen but not the
  // slug finds a row; `id` is how someone who has seen the slug in the code finds it.
  const matchedGroups = groups
    .map((entry) => ({
      group: entry.group,
      slots: isFiltering
        ? entry.slots.filter((slot) =>
            `${slot.label} ${slot.where} ${slot.id} ${slot.defaultConcept}`
              .toLowerCase()
              .includes(needle),
          )
        : entry.slots,
    }))
    .filter((entry) => entry.slots.length > 0);

  // A query searches every group, not just the open tab: a reader looking for one icon
  // knows what it *is*, rarely which group it was filed under — a within-tab filter
  // would miss the row and say nothing was found. So while filtering, the tabs step
  // aside and matches render grouped by where they came from.
  const totalSlots = groups.reduce((total, entry) => total + entry.slots.length, 0);
  const matchCount = matchedGroups.reduce((total, entry) => total + entry.slots.length, 0);

  return (
    <section>
      <p className="text-sm text-muted">
        Replace the icon in one specific place without changing the set everywhere. Uploads
        apply to <span className="font-medium text-ink">{setName}</span> only — pick a
        different set in the Icon Sets tab and each position starts from that set&apos;s own glyph again.
      </p>
      <p className="mt-3 text-sm text-muted">
        An <span className="font-medium text-ink">SVG</span> is tinted to the theme accent
        like the built-in icons. A PNG or JPEG keeps its own colors, so it won&apos;t match
        the theme. Keep files under {Math.round(ICON_OVERRIDE_MAX_BYTES / 1024)} KB.
      </p>
      <p className="mt-3 text-sm text-muted">
        Uploaded images are tidied up automatically: a flattened transparency checkerboard
        (what you get exporting to JPEG) is turned back into real transparency, empty margin
        is cropped, and the result is stored as a 256px PNG. So a big export is fine —
        it&apos;ll come out small and sharp. A photo is left alone rather than guessed at.
      </p>

      <div className="mt-6">
        <label htmlFor="icon-slot-filter" className="sr-only">
          Filter icon positions
        </label>
        <input
          id="icon-slot-filter"
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter by name, location or id…"
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
        <p className="mt-2 text-xs text-muted">
          {isFiltering
            ? `${matchCount} of ${totalSlots} positions, across every group`
            : `${totalSlots} positions in ${groups.length} groups`}
        </p>
      </div>

      {/* Group tabs — hidden while filtering, when results span every group anyway. */}
      {!isFiltering && (
        <div className="mt-6 flex flex-wrap gap-2 border-b border-line pb-3">
          {groups.map((entry) => (
            <button
              key={entry.group}
              type="button"
              onClick={() => setActiveGroup(entry.group)}
              className={`px-3 py-2 text-sm font-medium transition ${
                activeGroup === entry.group
                  ? "border-b-2 border-brass text-ink"
                  : "text-muted hover:text-ink"
              }`}
            >
              {entry.group}
            </button>
          ))}
        </div>
      )}

      {isFiltering ? (
        matchCount === 0 ? (
          <p className="mt-6 rounded-lg border border-line p-6 text-center text-sm text-muted">
            No icon position matches “{filter.trim()}”. Try part of a name, a screen it
            appears on, or its id.
          </p>
        ) : (
          // Grouped under headings rather than one flat list: two slots can share a label
          // ("Dashboard" belongs to every module), so the group is what tells them apart.
          matchedGroups.map((entry) => (
            <div key={entry.group} className="mt-6">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
                {entry.group}
              </h3>
              <div className="mt-3 space-y-3">
                {entry.slots.map((slot) => (
                  <SlotRow
                    key={slot.id}
                    slot={slot}
                    setId={setId}
                    initialOverride={overrides[slot.id]}
                  />
                ))}
              </div>
            </div>
          ))
        )
      ) : (
        groups.map((entry) => (
          activeGroup === entry.group && (
            <div key={entry.group} className="mt-6 space-y-3">
              {entry.slots.map((slot) => (
                <SlotRow
                  key={slot.id}
                  slot={slot}
                  setId={setId}
                  initialOverride={overrides[slot.id]}
                />
              ))}
            </div>
          )
        ))
      )}
    </section>
  );
}
