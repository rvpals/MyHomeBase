"use client";

import { useMemo, useState } from "react";
// Imported from the leaf modules, NOT from `@/lib/culling`. This is a client
// component, and the module's barrel re-exports the file store and the use-cases —
// which pull in `node:fs` and `sharp`, neither of which can be bundled for a browser.
// These two files are pure and safe to ship.
import { DEFAULT_CULL_IMAGES, MAX_CULL_CEILING, MIN_CULL_IMAGES } from "@/lib/culling/config";
import { CULLING_MODULE_SLUG, CULLING_SETTING_KEYS } from "@/lib/culling/settings";
import { useAdminSettings } from "../../admin-shell";

// The photo-culling ceiling, on the Application configuration page.
//
// Admin-only rather than a control in Picture Gallery itself, because this governs how
// long one request may spend reading the NAS — a system resource limit, not a
// per-reader preference. The same reasoning, and the same shape, as the SQLite upload
// cap it sits beside.
//
// It edits the module-setting draft the admin shell already holds for
// `picture-gallery`, so it saves through the page's existing Save button and needs no
// action of its own.

export function CullCapControl() {
  const { moduleSettings, updateModuleSetting, addModuleSetting } = useAdminSettings();

  const entries = useMemo(
    () => moduleSettings[CULLING_MODULE_SLUG] ?? [],
    [moduleSettings],
  );
  const index = entries.findIndex((entry) => entry.key === CULLING_SETTING_KEYS.maxCullImages);
  const stored = index === -1 ? undefined : Number(entries[index].value);

  const [count, setCount] = useState(() =>
    String(
      Number.isFinite(stored) && (stored as number) > 0
        ? Math.round(stored as number)
        : DEFAULT_CULL_IMAGES,
    ),
  );

  const parsed = Number(count);
  const isValid =
    Number.isInteger(parsed) && parsed >= MIN_CULL_IMAGES && parsed <= MAX_CULL_CEILING;

  function commit(nextValue: string) {
    setCount(nextValue);

    const next = Number(nextValue);
    if (!Number.isInteger(next) || next < MIN_CULL_IMAGES || next > MAX_CULL_CEILING) return;

    // Picture Gallery may have no settings row yet — the module ships with none — so
    // the first edit has to create one before it can be written.
    if (index === -1) {
      addModuleSetting(CULLING_MODULE_SLUG);
      const appended = entries.length;
      updateModuleSetting(
        CULLING_MODULE_SLUG,
        appended,
        "key",
        CULLING_SETTING_KEYS.maxCullImages,
      );
      updateModuleSetting(CULLING_MODULE_SLUG, appended, "value", String(next));
      return;
    }

    updateModuleSetting(CULLING_MODULE_SLUG, index, "value", String(next));
  }

  return (
    <div className="mt-6 border-t border-line pt-5">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">
          Photo culling — most photographs per pass
        </span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={MIN_CULL_IMAGES}
            max={MAX_CULL_CEILING}
            step={10}
            value={count}
            onChange={(event) => commit(event.target.value)}
            aria-describedby="cull-cap-hint"
            aria-invalid={!isValid}
            className="w-40 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          />
          <span className="text-sm text-muted">photographs</span>
        </div>
      </label>

      <p id="cull-cap-hint" className="mt-2 text-sm text-muted">
        How many photographs one culling pass will open and measure, in My Journal and in
        Picture Gallery. Between {MIN_CULL_IMAGES} and {MAX_CULL_CEILING};{" "}
        {DEFAULT_CULL_IMAGES} by default. Culling reads each file{" "}
        <strong className="text-ink">whole</strong>, unlike the date scan which reads only
        a header — so this limits <strong className="text-ink">how long one request may
        spend reading the archive</strong>, and a larger number means a slower pass, not a
        heavier one.
      </p>

      <p className="mt-1 text-sm text-muted">
        The default is an estimate — roughly a minute per {DEFAULT_CULL_IMAGES} over a
        network share — rather than a measured figure. Time a real run on your own archive
        before raising it far: a set spanning many folders is slower per photograph than
        the same count inside one.
      </p>

      {!isValid && (
        <p role="alert" className="mt-1 text-sm text-red-400">
          Give a whole number between {MIN_CULL_IMAGES} and {MAX_CULL_CEILING}. The last
          valid value is kept until this is corrected.
        </p>
      )}
    </div>
  );
}
