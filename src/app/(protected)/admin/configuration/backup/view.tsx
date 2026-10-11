"use client";

// Administration → Configuration → Backup Data.
//
// Two folder panels and a schedule panel. Each folder is a text box plus Browse…
// plus Check access — the same trio as the HSA receipt root, and for the same
// reason: the path is the *server's*, so a browser file dialog cannot supply it and
// `access(W_OK)` cannot be trusted to say it is writable.
//
// Narrow screens: every panel is a single column at both widths, and the one
// multi-column element (the input + its two buttons) collapses with `max-lg:flex-col`.
// The number and time inputs are capped with `sm:max-w-xs`, a max-width, which cannot
// regress the narrow layout.

import { useState } from "react";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { FolderBrowser } from "@/components/folder-browser";
import { UtcTime } from "@/components/utc-time";
// Types only, straight from the type module rather than the lib index: that index
// re-exports the runner, which opens the SQLite connection.
import {
  BACKUP_INTERVALS,
  BACKUP_INTERVAL_LABELS,
  MAX_KEEP_COUNT,
  MIN_KEEP_COUNT,
  type BackupInterval,
  type BackupSettings,
} from "@/lib/backup/types";
import type { ScheduledRun } from "@/lib/scheduled-jobs/types";
import {
  browseBackupFoldersAction,
  checkBackupFolderAction,
  runBackupNowAction,
  saveBackupSettingsAction,
} from "./actions";
import { PAGE_CONTAINER } from "../../../page-container";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export interface BackupDataViewProps {
  settings: BackupSettings;
  /** The HSA receipt root — the folder attachments are copied *from*. Read-only here. */
  attachmentSourceRoot: string;
  lastRun?: ScheduledRun;
}

/**
 * One folder row: a text box, a Browse… button and a Check access button.
 *
 * Check deliberately does not save — it validates the typed-but-unsaved value, so a
 * reader finds out a path is wrong before committing it.
 */
function FolderField({
  label,
  hint,
  placeholder,
  value,
  onChange,
  isBusy,
  onBusyChange,
  onNotice,
}: {
  label: string;
  hint: string;
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
  isBusy: boolean;
  onBusyChange: (busy: boolean) => void;
  onNotice: (notice: { ok: boolean; text: string }) => void;
}) {
  const [isBrowsing, setIsBrowsing] = useState(false);

  async function check() {
    onBusyChange(true);
    const result = await checkBackupFolderAction(value);
    onBusyChange(false);
    onNotice({ ok: result.ok, text: result.ok ? (result.message ?? "") : (result.error ?? "") });
  }

  return (
    <div className="mt-4">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">{label}</span>
        <div className="flex gap-2 max-lg:flex-col">
          <input
            className={`${INPUT_CLASS} flex-1 font-mono`}
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
          />
          <Button variant="secondary" disabled={isBusy} onClick={() => setIsBrowsing(true)}>
            Browse…
          </Button>
          <Button variant="secondary" disabled={isBusy} onClick={check}>
            Check access
          </Button>
        </div>
      </label>
      <p className="mt-1 text-xs text-muted">{hint}</p>

      {isBrowsing && (
        <FolderBrowser
          startPath={value}
          onBrowse={browseBackupFoldersAction}
          onCancel={() => setIsBrowsing(false)}
          onPick={(picked) => {
            onChange(picked);
            setIsBrowsing(false);
          }}
        />
      )}
    </div>
  );
}

export function BackupDataView({ settings, attachmentSourceRoot, lastRun }: BackupDataViewProps) {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [attachmentRoot, setAttachmentRoot] = useState(settings.attachmentRoot);
  const [databaseRoot, setDatabaseRoot] = useState(settings.databaseRoot);
  // A string, not a number: an empty box must stay empty while being retyped rather
  // than snapping to 0, and the schema coerces on save.
  const [keepCount, setKeepCount] = useState(String(settings.keepCount));
  const [interval, setInterval] = useState<BackupInterval>(settings.interval);
  const [startTime, setStartTime] = useState(settings.startTime);

  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string }>();

  async function save() {
    setIsBusy(true);
    const result = await saveBackupSettingsAction({
      enabled,
      attachmentRoot,
      databaseRoot,
      keepCount: Number(keepCount),
      interval,
      startTime,
    });
    setIsBusy(false);
    setNotice({ ok: result.ok, text: result.ok ? (result.message ?? "") : (result.error ?? "") });
  }

  async function runNow() {
    setIsBusy(true);
    setNotice({ ok: true, text: "Backing up — this can take a while." });
    const result = await runBackupNowAction();
    setIsBusy(false);
    setNotice({ ok: result.ok, text: result.ok ? (result.message ?? "") : (result.error ?? "") });
  }

  return (
    <div className={PAGE_CONTAINER}>
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Configuration
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Backup Data</h1>
      <p className="mt-2 text-sm text-muted">
        Where the application&apos;s attachment files and database are copied to. Both folders
        are paths on the machine running MyHomeBase, not on your phone or laptop — so Browse
        lists the server&apos;s own folders.
      </p>

      {notice && (
        <p className={`mt-4 text-sm ${notice.ok ? "text-emerald-300" : "text-red-300"}`}>
          {notice.text}
        </p>
      )}

      {/* ------------------------------------------------------------- Attachments */}
      <div className="mt-6">
        <CollapsibleCard title="Attachment files" defaultOpen>
          <p className="text-sm text-muted">
            Every attachment that has changed since the last backup is copied across. If a file
            of the same name is already in the backup folder and the newer one is replacing it,
            the existing copy is renamed with the date and time first — so an older version is
            never overwritten.
          </p>

          <div className="mt-3 rounded-md border border-line bg-paper p-3 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              Copied from (HSA receipt folder)
            </p>
            {attachmentSourceRoot === "" ? (
              <p className="mt-1 text-amber-300">
                Not set. Choose it on Household → Configuration, or there will be nothing to
                back up.
              </p>
            ) : (
              <p className="mt-1 break-all font-mono text-ink">{attachmentSourceRoot}</p>
            )}
          </div>

          <FolderField
            label="Back attachments up to"
            placeholder="//NAS_DS223/backup/attachments"
            hint="The folder the attachment files are copied into."
            value={attachmentRoot}
            onChange={setAttachmentRoot}
            isBusy={isBusy}
            onBusyChange={setIsBusy}
            onNotice={setNotice}
          />
        </CollapsibleCard>
      </div>

      {/* --------------------------------------------------------------- Database */}
      <div className="mt-6">
        <CollapsibleCard title="Database files" defaultOpen>
          <p className="text-sm text-muted">
            A consistent snapshot of the database is taken while the app keeps running, then
            compressed into one archive named for the moment it was taken.
          </p>

          <FolderField
            label="Back the database up to"
            placeholder="//NAS_DS223/backup/database"
            hint="The folder the compressed archives are written to."
            value={databaseRoot}
            onChange={setDatabaseRoot}
            isBusy={isBusy}
            onBusyChange={setIsBusy}
            onNotice={setNotice}
          />

          <label className="mt-4 block text-sm sm:max-w-xs">
            <span className="mb-1 block font-medium text-ink">How many backups to keep?</span>
            <input
              type="number"
              min={MIN_KEEP_COUNT}
              max={MAX_KEEP_COUNT}
              value={keepCount}
              onChange={(event) => setKeepCount(event.target.value)}
              className={INPUT_CLASS}
            />
            <span className="mt-1 block text-xs text-muted">
              This will backup database files and only keep the last {keepCount || "n"} backups,
              meaning the older backup would be erased. Between {MIN_KEEP_COUNT} and{" "}
              {MAX_KEEP_COUNT}.
            </span>
          </label>
        </CollapsibleCard>
      </div>

      {/* --------------------------------------------------------------- Schedule */}
      <div className="mt-6">
        <CollapsibleCard title="Schedule" defaultOpen>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-brass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
            />
            <span>
              <span className="block font-medium text-ink">Run on a schedule</span>
              <span className="block text-xs text-muted">
                Off means the backup never runs on its own. &ldquo;Run backup now&rdquo; still
                works either way.
              </span>
            </span>
          </label>

          <label className="mt-4 block text-sm sm:max-w-xs">
            <span className="mb-1 block font-medium text-ink">Backup interval</span>
            <select
              value={interval}
              onChange={(event) => setInterval(event.target.value as BackupInterval)}
              className={INPUT_CLASS}
            >
              {BACKUP_INTERVALS.map((option) => (
                <option key={option} value={option}>
                  {BACKUP_INTERVAL_LABELS[option]}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-4 block text-sm sm:max-w-xs">
            <span className="mb-1 block font-medium text-ink">Start at</span>
            <input
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              className={INPUT_CLASS}
            />
            <span className="mt-1 block text-xs text-muted">
              The time of day the schedule is anchored to, in the server&apos;s local time.
            </span>
          </label>

          {lastRun && (
            <p className="mt-4 text-xs text-muted">
              Last run <UtcTime stamp={lastRun.lastRunAt} /> — {lastRun.status ?? "interrupted"}
              {lastRun.detail ? ` (${lastRun.detail})` : ""}.
            </p>
          )}

          <div className="mt-4 flex gap-2 max-lg:flex-col">
            <Button variant="primary" disabled={isBusy} onClick={save}>
              Save settings
            </Button>
            <Button variant="secondary" disabled={isBusy} onClick={runNow}>
              {isBusy ? "Working…" : "Run backup now"}
            </Button>
          </div>
        </CollapsibleCard>
      </div>
    </div>
  );
}
