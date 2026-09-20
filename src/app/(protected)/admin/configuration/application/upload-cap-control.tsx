"use client";

import { useMemo, useState } from "react";
// Imported from the leaf modules, NOT from `@/lib/sqlite-browser`. This is a
// client component, and the module's barrel re-exports the repository and the
// file store — which pull in `better-sqlite3` and `node:fs`, neither of which
// can be bundled for a browser. These three files are pure and safe to ship.
import { formatCap } from "@/lib/sqlite-browser/errors";
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  MAX_UPLOAD_CEILING_BYTES,
  MIN_UPLOAD_CAP_BYTES,
} from "@/lib/sqlite-browser/schema";
import { TOOLS_MODULE_SLUG, TOOLS_SETTING_KEYS } from "@/lib/sqlite-browser/settings";
import { useAdminSettings } from "../../admin-shell";

// The SQLite File Browser's upload cap, on the Application configuration page.
//
// Admin-only rather than a control in the Tools module itself, because this
// governs how much of the NAS volume one upload can take — a system resource
// limit, not a per-reader preference.
//
// It edits the module-setting draft the admin shell already holds for `tools`,
// so it saves through the page's existing Save button and needs no action of
// its own. The generic key/value editor on the Modules page can still reach
// the same row; this exists so the common case is a number in megabytes with
// a validated range, rather than a raw byte count typed into a text box.

const MIN_MB = Math.round(MIN_UPLOAD_CAP_BYTES / (1024 * 1024));
const MAX_MB = Math.round(MAX_UPLOAD_CEILING_BYTES / (1024 * 1024));
const DEFAULT_MB = Math.round(DEFAULT_MAX_UPLOAD_BYTES / (1024 * 1024));

export function UploadCapControl() {
  const { moduleSettings, updateModuleSetting, addModuleSetting } = useAdminSettings();

  const entries = useMemo(
    () => moduleSettings[TOOLS_MODULE_SLUG] ?? [],
    [moduleSettings],
  );
  const index = entries.findIndex((entry) => entry.key === TOOLS_SETTING_KEYS.maxUploadBytes);
  const storedBytes = index === -1 ? undefined : Number(entries[index].value);

  // The box shows megabytes because that is how a person says a file size; the
  // row stores bytes because that is what every consumer compares against.
  const [megabytes, setMegabytes] = useState(() =>
    String(
      Number.isFinite(storedBytes) && (storedBytes as number) > 0
        ? Math.round((storedBytes as number) / (1024 * 1024))
        : DEFAULT_MB,
    ),
  );

  const parsed = Number(megabytes);
  const isValid =
    Number.isInteger(parsed) && parsed >= MIN_MB && parsed <= MAX_MB;

  function commit(nextValue: string) {
    setMegabytes(nextValue);

    const next = Number(nextValue);
    if (!Number.isInteger(next) || next < MIN_MB || next > MAX_MB) return;

    const bytes = String(next * 1024 * 1024);

    // The Tools module may have no settings row yet — the module ships with
    // none — so the first edit has to create one before it can be written.
    if (index === -1) {
      addModuleSetting(TOOLS_MODULE_SLUG);
      const appended = entries.length;
      updateModuleSetting(
        TOOLS_MODULE_SLUG,
        appended,
        "key",
        TOOLS_SETTING_KEYS.maxUploadBytes,
      );
      updateModuleSetting(TOOLS_MODULE_SLUG, appended, "value", bytes);
      return;
    }

    updateModuleSetting(TOOLS_MODULE_SLUG, index, "value", bytes);
  }

  return (
    <div className="mt-6 border-t border-line pt-5">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">
          SQLite File Browser — upload limit
        </span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={MIN_MB}
            max={MAX_MB}
            step={1}
            value={megabytes}
            onChange={(event) => commit(event.target.value)}
            aria-describedby="upload-cap-hint"
            aria-invalid={!isValid}
            className="w-40 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          />
          <span className="text-sm text-muted">MB</span>
          {isValid && parsed >= 1024 && (
            <span className="text-sm text-muted">({formatCap(parsed * 1024 * 1024)})</span>
          )}
        </div>
      </label>

      <p id="upload-cap-hint" className="mt-2 text-sm text-muted">
        The largest SQLite file the Tools module will accept. Between {MIN_MB} MB and{" "}
        {formatCap(MAX_UPLOAD_CEILING_BYTES)}; {DEFAULT_MB} MB by default. Uploads stream
        to disk, so this limits <strong className="text-ink">space in the upload folder</strong>,
        not memory — each stored file keeps its full size until it is removed.
      </p>

      {!isValid && (
        <p role="alert" className="mt-1 text-sm text-red-400">
          Give a whole number of megabytes between {MIN_MB} and {MAX_MB}. The last valid
          value is kept until this is corrected.
        </p>
      )}
    </div>
  );
}
