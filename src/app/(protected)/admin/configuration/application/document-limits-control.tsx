"use client";

import { useMemo, useState } from "react";
// Imported from the leaf modules, NOT from `@/lib/documents`. This is a client
// component, and the module's barrel re-exports the repository and the file store —
// which pull in `better-sqlite3` and `node:fs`, neither of which can be bundled for a
// browser. These two files are pure and safe to ship. Same reason `UploadCapControl`
// imports from `@/lib/sqlite-browser/schema` rather than the barrel.
import {
  DEFAULT_DOCUMENT_MAX_FILES,
  DEFAULT_DOCUMENT_MAX_FILE_BYTES,
  DOCUMENT_MAX_FILES_CEILING,
  DOCUMENT_MAX_FILE_BYTES_CEILING,
  formatBytes,
} from "@/lib/documents/schema";
import { DOCUMENTS_MODULE_SLUG, DOCUMENT_SETTING_KEYS } from "@/lib/documents/settings";
import { useAdminSettings } from "../../admin-shell";

// The Document Library's upload limits, on the Application configuration page.
//
// Admin-only rather than controls in the module itself, because these govern how much
// of the NAS volume and of the server's memory one upload can take — a system resource
// limit, not a per-reader preference. The module's own Configuration screen shows them
// read-only so an armed limit still explains itself where it applies.
//
// They edit the module-setting draft the admin shell already holds for `documents`, so
// they save through the page's existing Save button and need no action of their own.

const MIN_MB = 1;
const MAX_MB = Math.round(DOCUMENT_MAX_FILE_BYTES_CEILING / (1024 * 1024));
const DEFAULT_MB = Math.round(DEFAULT_DOCUMENT_MAX_FILE_BYTES / (1024 * 1024));

const INPUT_CLASS =
  "w-40 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export function DocumentLimitsControl() {
  const { moduleSettings, updateModuleSetting, addModuleSetting } = useAdminSettings();

  const entries = useMemo(
    () => moduleSettings[DOCUMENTS_MODULE_SLUG] ?? [],
    [moduleSettings],
  );

  /**
   * Writes one key into the draft, creating its row when the module has none yet.
   *
   * `entries.length` is read at call time rather than captured: two controls on this
   * page write two different keys, and the second one appends after the first.
   */
  function commitSetting(key: string, value: string) {
    const index = entries.findIndex((entry) => entry.key === key);
    if (index === -1) {
      addModuleSetting(DOCUMENTS_MODULE_SLUG);
      const appended = entries.length;
      updateModuleSetting(DOCUMENTS_MODULE_SLUG, appended, "key", key);
      updateModuleSetting(DOCUMENTS_MODULE_SLUG, appended, "value", value);
      return;
    }
    updateModuleSetting(DOCUMENTS_MODULE_SLUG, index, "value", value);
  }

  const storedBytes = Number(
    entries.find((entry) => entry.key === DOCUMENT_SETTING_KEYS.maxFileBytes)?.value,
  );
  const storedCount = Number(
    entries.find((entry) => entry.key === DOCUMENT_SETTING_KEYS.maxFilesPerDocument)?.value,
  );

  // The box shows megabytes because that is how a person says a file size; the row
  // stores bytes because that is what every consumer compares against.
  const [megabytes, setMegabytes] = useState(() =>
    String(
      Number.isFinite(storedBytes) && storedBytes > 0
        ? Math.round(storedBytes / (1024 * 1024))
        : DEFAULT_MB,
    ),
  );
  const [fileCount, setFileCount] = useState(() =>
    String(
      Number.isInteger(storedCount) && storedCount > 0 ? storedCount : DEFAULT_DOCUMENT_MAX_FILES,
    ),
  );

  const parsedMb = Number(megabytes);
  const isSizeValid = Number.isInteger(parsedMb) && parsedMb >= MIN_MB && parsedMb <= MAX_MB;

  const parsedCount = Number(fileCount);
  const isCountValid =
    Number.isInteger(parsedCount) && parsedCount >= 1 && parsedCount <= DOCUMENT_MAX_FILES_CEILING;

  return (
    <div className="mt-6 border-t border-line pt-5">
      <span className="mb-1 block text-sm font-medium text-ink">
        Document Library — upload limits
      </span>

      <div className="flex flex-wrap gap-6">
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Largest file</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={MIN_MB}
              max={MAX_MB}
              step={1}
              value={megabytes}
              onChange={(event) => {
                setMegabytes(event.target.value);
                const next = Number(event.target.value);
                if (!Number.isInteger(next) || next < MIN_MB || next > MAX_MB) return;
                commitSetting(DOCUMENT_SETTING_KEYS.maxFileBytes, String(next * 1024 * 1024));
              }}
              aria-describedby="document-limits-hint"
              aria-invalid={!isSizeValid}
              className={INPUT_CLASS}
            />
            <span className="text-sm text-muted">MB</span>
          </div>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-muted">Files per document</span>
          <input
            type="number"
            min={1}
            max={DOCUMENT_MAX_FILES_CEILING}
            step={1}
            value={fileCount}
            onChange={(event) => {
              setFileCount(event.target.value);
              const next = Number(event.target.value);
              if (!Number.isInteger(next) || next < 1 || next > DOCUMENT_MAX_FILES_CEILING) return;
              commitSetting(DOCUMENT_SETTING_KEYS.maxFilesPerDocument, String(next));
            }}
            aria-describedby="document-limits-hint"
            aria-invalid={!isCountValid}
            className={INPUT_CLASS}
          />
        </label>
      </div>

      <p id="document-limits-hint" className="mt-2 text-sm text-muted">
        The largest single file the Document Library will accept, and how many files one
        document may hold. Up to {formatBytes(DOCUMENT_MAX_FILE_BYTES_CEILING)} and{" "}
        {DOCUMENT_MAX_FILES_CEILING} files; {DEFAULT_MB} MB and {DEFAULT_DOCUMENT_MAX_FILES}{" "}
        by default. An upload is buffered{" "}
        <strong className="text-ink">in memory</strong> on its way to the share, so the
        size limit bounds what one request can cost the server.
      </p>

      {(!isSizeValid || !isCountValid) && (
        <p role="alert" className="mt-1 text-sm text-red-400">
          {!isSizeValid && `Give a whole number of megabytes between ${MIN_MB} and ${MAX_MB}. `}
          {!isCountValid && `Give a whole number of files between 1 and ${DOCUMENT_MAX_FILES_CEILING}. `}
          The last valid value is kept until this is corrected.
        </p>
      )}
    </div>
  );
}
