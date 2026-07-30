"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import type { JournalPreferences, JournalTemperatureUnit } from "@/lib/journal";
import { saveJournalPreferencesAction } from "./journal-actions";
import { JournalLocationField, type PickedLocation } from "./journal-location-field";

const SELECT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export function JournalPreferencesView({ preferences }: { preferences: JournalPreferences }) {
  const router = useRouter();
  const [location, setLocation] = useState<PickedLocation | null>(
    preferences.defaultLocation
      ? {
          latitude: preferences.defaultLocation.latitude,
          longitude: preferences.defaultLocation.longitude,
          name: preferences.defaultLocation.name,
        }
      : null,
  );
  const [unit, setUnit] = useState<JournalTemperatureUnit>(preferences.temperatureUnit);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleSave() {
    setIsBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const next: JournalPreferences = {
        defaultLocation: location
          ? { latitude: location.latitude, longitude: location.longitude, name: location.name }
          : null,
        temperatureUnit: unit,
      };
      const result = await saveJournalPreferencesAction(next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage("Preferences saved.");
      router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Set a default location and temperature unit. New entries use the default location to fetch
        today&apos;s weather when you haven&apos;t picked a location on the entry itself.
      </p>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {message && <p className="text-sm text-emerald-400">{message}</p>}

      <div>
        <span className="mb-1 block text-sm font-medium text-ink">Default location</span>
        <JournalLocationField value={location} onChange={setLocation} />
      </div>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Temperature unit</span>
        <select value={unit} onChange={(event) => setUnit(event.target.value as JournalTemperatureUnit)} className={SELECT_CLASS}>
          <option value="fahrenheit">Fahrenheit (°F)</option>
          <option value="celsius">Celsius (°C)</option>
        </select>
      </label>

      <div>
        <Button onClick={handleSave} disabled={isBusy}>
          {isBusy ? "Saving…" : "Save preferences"}
        </Button>
      </div>
    </div>
  );
}
