"use client";

// The Attendance preferences. Deliberately small — these are the only settings
// the module needs; more can join them as key/value rows without a migration.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import type { AttendanceClass, AttendanceSettings } from "@/lib/attendance";
import { saveAttendanceSettingsAction } from "./attendance-actions";

const INPUT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

const LABEL_CLASS = "text-xs font-medium uppercase tracking-wide text-muted";

export function AttendanceConfigurationView({
  settings,
  classes,
}: {
  settings: AttendanceSettings;
  classes: AttendanceClass[];
}) {
  const router = useRouter();
  const [defaultClassId, setDefaultClassId] = useState(
    settings.defaultClassId ? String(settings.defaultClassId) : "",
  );
  const [reportDefaultsToToday, setReportDefaultsToToday] = useState(
    settings.reportDefaultsToToday,
  );
  const [cardsUseLastNameFirst, setCardsUseLastNameFirst] = useState(
    settings.cardsUseLastNameFirst,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  async function handleSave() {
    setIsSaving(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await saveAttendanceSettingsAction({
        defaultClassId: defaultClassId ? Number(defaultClassId) : undefined,
        reportDefaultsToToday,
        cardsUseLastNameFirst,
      });
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

  return (
    <div className="flex flex-col gap-6">
      <label className="flex max-w-md flex-col gap-1">
        <span className={LABEL_CLASS}>Default class on the home screen</span>
        <select
          value={defaultClassId}
          onChange={(event) => setDefaultClassId(event.target.value)}
          className={INPUT_CLASS}
        >
          <option value="">No default — ask every time</option>
          {classes.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <span className="text-sm text-muted">
          The home screen opens on this class, so you don&apos;t pick it every morning.
        </span>
      </label>

      <label className="flex max-w-md items-start gap-3">
        <input
          type="checkbox"
          checked={reportDefaultsToToday}
          onChange={(event) => setReportDefaultsToToday(event.target.checked)}
          className="mt-1"
        />
        <span>
          <span className="block text-sm text-ink">Report opens on today</span>
          <span className="block text-sm text-muted">
            Turn this off to open on the most recent day that actually has attendance — useful if
            you print yesterday&apos;s register the next morning.
          </span>
        </span>
      </label>

      <label className="flex max-w-md items-start gap-3">
        <input
          type="checkbox"
          checked={cardsUseLastNameFirst}
          onChange={(event) => setCardsUseLastNameFirst(event.target.checked)}
          className="mt-1"
        />
        <span>
          <span className="block text-sm text-ink">
            Use Last Name, First Name in attendance card
          </span>
          <span className="block text-sm text-muted">
            Cards on the home screen read <em>Chen, Ava</em> instead of <em>Ava Chen</em> — the
            order a paper register is usually in. The list view is unchanged.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving…" : "Save settings"}
        </Button>
        {message && <p className="text-sm text-emerald-400">{message}</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
