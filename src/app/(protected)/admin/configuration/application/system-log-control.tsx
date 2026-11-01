"use client";

import { useEffect, useState, useTransition } from "react";

// Imported from the leaf modules, NOT from `@/lib/system-log`. This is a client
// component, and the module's barrel re-exports `SqliteSystemLogRepository` — which
// pulls in better-sqlite3, and cannot be bundled for a browser. These two files are
// pure and safe to ship. Same rule, and the same reason, as the upload-cap control
// importing from `sqlite-browser/schema` rather than from its index.
import {
  DEFAULT_SYSTEM_LOG_MAX_ROWS,
  SYSTEM_LOG_MAX_MAX_ROWS,
  SYSTEM_LOG_MIN_MAX_ROWS,
} from "@/lib/system-log/schema";
import type { SystemLogSettings } from "@/lib/system-log/types";
import {
  loadSystemLogSettingsAction,
  setSystemLogMaxRowsAction,
  setSystemLogSwitchAction,
} from "./system-log-actions";

// The system log's two switches, on the Application Configuration page.
//
// Writes immediately rather than through the page's Save button — see the note in
// `system-log-actions.ts` for why these rows are not part of the shell's draft.
//
// Phone and desktop: a stack of label-and-checkbox rows, which needs no breakpoint.
// The row cap input is `max-w-[12rem]` so it does not stretch across a wide screen,
// and the whole block inherits the page's single-column card.

const OFF_STATE: SystemLogSettings = {
  debugEnabled: false,
  operationalEnabled: false,
  maxRows: DEFAULT_SYSTEM_LOG_MAX_ROWS,
};

export function SystemLogControl() {
  const [settings, setSettings] = useState<SystemLogSettings>(OFF_STATE);
  const [rowCap, setRowCap] = useState(String(DEFAULT_SYSTEM_LOG_MAX_ROWS));
  const [loaded, setLoaded] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Read once on mount. The settings are not in the admin shell's draft, so there is
  // nothing to receive them as props from — see the actions file.
  useEffect(() => {
    let cancelled = false;
    void loadSystemLogSettingsAction().then((loadedSettings) => {
      if (cancelled) return;
      setSettings(loadedSettings);
      setRowCap(String(loadedSettings.maxRows));
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(kind: "debug" | "operational", enabled: boolean) {
    // Optimistic: the switch moves now and the server confirms. A checkbox that
    // waits for a round trip before moving reads as broken on the NAS.
    setSettings((current) =>
      kind === "debug"
        ? { ...current, debugEnabled: enabled }
        : { ...current, operationalEnabled: enabled },
    );
    startTransition(async () => {
      setSettings(await setSystemLogSwitchAction(kind, enabled));
    });
  }

  function commitRowCap(next: string) {
    setRowCap(next);
    const parsed = Number(next);
    if (
      !Number.isInteger(parsed) ||
      parsed < SYSTEM_LOG_MIN_MAX_ROWS ||
      parsed > SYSTEM_LOG_MAX_MAX_ROWS
    ) {
      return;
    }
    startTransition(async () => {
      setSettings(await setSystemLogMaxRowsAction(parsed));
    });
  }

  const capValue = Number(rowCap);
  const capIsValid =
    Number.isInteger(capValue) &&
    capValue >= SYSTEM_LOG_MIN_MAX_ROWS &&
    capValue <= SYSTEM_LOG_MAX_MAX_ROWS;

  return (
    <div className="mt-6 border-t border-line pt-5">
      <p className="font-medium text-ink">System log</p>
      <p className="mt-1 text-sm text-muted">
        What the application writes about itself, readable under{" "}
        <span className="font-medium text-ink">Administration → System Log</span>. Both are
        off until you switch them on.
      </p>

      <label className="mt-4 flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={settings.operationalEnabled}
          disabled={!loaded}
          onChange={(event) => toggle("operational", event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-brass"
        />
        <span>
          <span className="font-medium text-ink">OPERATIONAL messages</span>
          <span className="block text-muted">
            Routine activity — every scheduled job as it is triggered and as it finishes.
            Useful for confirming the server is doing what it should; the “Hello, world!”
            job alone writes about 2,900 lines a day at its default cadence.
          </span>
        </span>
      </label>

      <label className="mt-3 flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={settings.debugEnabled}
          disabled={!loaded}
          onChange={(event) => toggle("debug", event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-brass"
        />
        <span>
          <span className="font-medium text-ink">DEBUG messages</span>
          <span className="block text-muted">
            Detailed lines planted in specific places — for example, every document the
            text-indexing job reads, with how long it took and how much text came back.
            Verbose by design; switch it on while you are watching something.
          </span>
        </span>
      </label>

      <label className="mt-4 block text-sm">
        <span className="mb-1 block font-medium text-ink">Lines to keep</span>
        <input
          type="number"
          inputMode="numeric"
          min={SYSTEM_LOG_MIN_MAX_ROWS}
          max={SYSTEM_LOG_MAX_MAX_ROWS}
          value={rowCap}
          disabled={!loaded}
          onChange={(event) => commitRowCap(event.target.value)}
          className="w-full max-w-[12rem] rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
        <span className="mt-1 block text-xs text-muted">
          {capIsValid ? (
            <>
              The oldest lines are deleted once the log grows past this. Between{" "}
              {SYSTEM_LOG_MIN_MAX_ROWS.toLocaleString()} and{" "}
              {SYSTEM_LOG_MAX_MAX_ROWS.toLocaleString()}.
            </>
          ) : (
            <span className="text-danger">
              Enter a whole number between {SYSTEM_LOG_MIN_MAX_ROWS.toLocaleString()} and{" "}
              {SYSTEM_LOG_MAX_MAX_ROWS.toLocaleString()}.
            </span>
          )}
        </span>
      </label>

      {isPending ? <p className="mt-2 text-xs text-muted">Saving…</p> : null}
    </div>
  );
}
