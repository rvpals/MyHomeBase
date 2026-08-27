"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import type { AutoImportRunSummary, ExpenseSettings } from "@/lib/expense";
import Link from "next/link";
import { runAutoImportNowAction, saveExpenseFolderAction } from "./expense-actions";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/**
 * What to import: the watched folder, and a manual run to try it.
 *
 * *When* to import -- the master switch and the interval -- moved to Administration
 * -> Background Tasks, where all three of the app's timed jobs are armed together.
 * This screen still shows whether the service is armed, read-only, because a folder
 * with nothing watching it is the confusing half of the old arrangement.
 */
export function ExpenseSettingsView({ settings }: { settings: ExpenseSettings }) {
  const router = useRouter();
  const [path, setPath] = useState(settings.autoImportPath);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [lastRun, setLastRun] = useState<AutoImportRunSummary | undefined>(undefined);

  // Read-only status, derived from what the admin screen saved. `isEnabled` is the
  // same three-way conjunction `isAutoImportEnabled` applies on the server.
  const intervalMinutes = settings.autoImportIntervalMinutes;
  const isConfigured = settings.autoImportPath !== "" && intervalMinutes > 0;
  const isEnabled = settings.autoImportEnabled && isConfigured;
  const isDirty = path.trim() !== settings.autoImportPath;

  async function handleSave() {
    setIsSaving(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await saveExpenseFolderAction(path);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage("Settings saved.");
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRunNow() {
    setIsRunning(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await runAutoImportNowAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setLastRun(result.summary);
      router.refresh();
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Drop statement CSVs into a folder and the server imports them on a timer — applying the
        auto-categorise rules and skipping anything already imported.
      </p>

      <div className="rounded-md border border-line bg-paper p-3 text-xs text-muted">
        <p className="font-medium text-ink">How the folder is read</p>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-4">
          <li>
            <strong className="text-ink">One sub-folder per card</strong>, named after it:
            <span className="mt-1 block font-mono text-[11px] leading-5">
              /csv_import/Visa&nbsp;Gold/*.csv &rarr; the &ldquo;Visa Gold&rdquo; account
              <br />
              /csv_import/Amex/*.csv &nbsp;&nbsp;&nbsp;&rarr; the &ldquo;Amex&rdquo; account
            </span>
            The files inside can be named anything. The sub-folder name also picks the saved import
            mapping of the same name (if you only have one saved mapping, that one is used).
          </li>
          <li>
            A CSV left loose at the top level is reported as a problem rather than imported — move
            it into a card sub-folder.
          </li>
          <li>
            After a file is processed it&apos;s renamed to{" "}
            <span className="font-mono">&lt;name&gt;_&lt;timestamp&gt;.backup</span>, so the
            original is kept and it isn&apos;t imported twice. A file that fails becomes{" "}
            <span className="font-mono">.failed</span> — fix the cause and rename it back to{" "}
            <span className="font-mono">.csv</span> to retry.
          </li>
          <li>Only <span className="font-mono">*.csv</span> files are looked at.</li>
          <li>
            Imports are attributed to the first administrator account, since no one is signed in.
          </li>
          <li>
            The service is switched on and scheduled under{" "}
            <strong className="text-ink">Administration &rarr; Background Tasks</strong>. Clearing
            the folder here also stops it, whatever that switch says.
          </li>
        </ul>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {message && <p className="text-sm text-emerald-400">{message}</p>}

      <label className="block text-sm sm:max-w-md">
        <span className="mb-1 block font-medium text-ink">CSV auto-import folder</span>
        <input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder="/volume1/statements"
          className={`${INPUT_CLASS} font-mono`}
        />
        <span className="mt-1 block text-xs text-muted">
          A path on the server, not your PC — e.g. a NAS share folder.
        </span>
      </label>

      <p className="text-xs text-muted">
        Background service:{" "}
        {isEnabled ? (
          <span className="text-emerald-400">
            on — every {intervalMinutes} minute(s), checked once a minute
          </span>
        ) : (
          <span className="text-muted">
            off
            {!settings.autoImportEnabled
              ? " — switched off"
              : settings.autoImportPath === ""
                ? " — no folder set"
                : " — the interval is 0"}
          </span>
        )}
        . The switch and the interval live in{" "}
        <Link href="/admin/background-tasks" className="text-brass hover:underline">
          Administration &rarr; Background Tasks
        </Link>
        , along with when this job last ran.{" "}
        <strong className="text-ink">Run import now</strong> below works either way, so you can
        test a folder before arming the service.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button onClick={handleSave} disabled={isSaving || !isDirty}>
          {isSaving ? "Saving…" : "Save folder"}
        </Button>
        <Button variant="secondary" onClick={handleRunNow} disabled={isRunning}>
          {isRunning ? "Running…" : "Run import now"}
        </Button>
      </div>

      {lastRun && (
        <div className="rounded-md border border-line bg-paper p-3 text-sm">
          {!lastRun.ran ? (
            <p className="text-muted">Nothing ran: {lastRun.reason}</p>
          ) : lastRun.files.length === 0 ? (
            <p className="text-muted">No CSV files found in the folder.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-xs">
              {lastRun.files.map((file) => (
                <li
                  key={`${file.cardFolder}/${file.fileName}`}
                  className={file.status === "failed" ? "text-red-400" : "text-ink"}
                >
                  <span className="font-mono">
                    {file.cardFolder === "" ? file.fileName : `${file.cardFolder}/${file.fileName}`}
                  </span>{" "}
                  — {file.detail}
                  {file.renamedTo && (
                    <span className="text-muted"> (renamed to {file.renamedTo})</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
