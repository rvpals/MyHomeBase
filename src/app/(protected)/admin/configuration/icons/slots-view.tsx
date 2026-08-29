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
  return (
    <section className="mt-12">
      <h2 className="font-display text-2xl font-semibold text-ink">Icon positions</h2>
      <p className="mt-2 text-sm text-muted">
        Replace the icon in one specific place without changing the set everywhere. Uploads
        apply to <span className="font-medium text-ink">{setName}</span> only — pick a
        different set above and each position starts from that set&apos;s own glyph again.
      </p>
      <p className="mt-2 text-sm text-muted">
        An <span className="font-medium text-ink">SVG</span> is tinted to the theme accent
        like the built-in icons. A PNG or JPEG keeps its own colors, so it won&apos;t match
        the theme. Keep files under {Math.round(ICON_OVERRIDE_MAX_BYTES / 1024)} KB.
      </p>
      <p className="mt-2 text-sm text-muted">
        Uploaded images are tidied up automatically: a flattened transparency checkerboard
        (what you get exporting to JPEG) is turned back into real transparency, empty margin
        is cropped, and the result is stored as a 256px PNG. So a big export is fine —
        it&apos;ll come out small and sharp. A photo is left alone rather than guessed at.
      </p>

      {groups.map((entry) => (
        <div key={entry.group} className="mt-6">
          <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
            {entry.group}
          </p>
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
      ))}
    </section>
  );
}
