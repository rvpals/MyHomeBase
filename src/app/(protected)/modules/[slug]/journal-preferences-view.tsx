"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import type { JournalPreferences, JournalTemperatureUnit } from "@/lib/journal";
import type { PhotoArchiveDiagnosis } from "@/lib/journal-photos";
import { checkPhotoAccessAction, saveJournalPreferencesAction } from "./journal-actions";
import { JournalLocationField, type PickedLocation } from "./journal-location-field";

const SELECT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 font-mono text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

interface AccessReport {
  diagnosis: PhotoArchiveDiagnosis;
  checkedPath: string;
  isFromSetting: boolean;
}

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
  const [photoRoot, setPhotoRoot] = useState(preferences.photoRoot);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const [isChecking, setIsChecking] = useState(false);
  const [report, setReport] = useState<AccessReport | undefined>(undefined);
  const [checkError, setCheckError] = useState<string | undefined>(undefined);

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
        photoRoot,
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

  /**
   * Checks the path currently in the box, saved or not — so a value can be tested before
   * committing it. That is the point of the button: the failure it diagnoses (a share the
   * app cannot read) is invisible until something actually tries to read it.
   */
  async function handleCheckAccess() {
    setIsChecking(true);
    setCheckError(undefined);
    setReport(undefined);
    try {
      const result = await checkPhotoAccessAction(photoRoot);
      if (!result.ok || !result.diagnosis) {
        setCheckError(result.error ?? "Could not check the photo folder.");
        return;
      }
      setReport({
        diagnosis: result.diagnosis,
        checkedPath: result.checkedPath ?? photoRoot,
        isFromSetting: result.isFromSetting ?? false,
      });
    } finally {
      setIsChecking(false);
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

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Photo folder</span>
          <input
            type="text"
            value={photoRoot}
            onChange={(event) => setPhotoRoot(event.target.value)}
            placeholder="/volume1/MEDIA/PHOTO/BY YEAR"
            spellCheck={false}
            autoComplete="off"
            className={INPUT_CLASS}
          />
        </label>
        <p className="text-xs text-muted">
          The full path to the archive the journal entry viewer looks in for pictures taken on an
          entry&apos;s date. Read-only — nothing is ever written there. Expected layout: a folder
          per year, holding <code className="font-mono">YYYY-MM</code> folders for a month&apos;s
          loose photos and <code className="font-mono">YYYY-MM-DD Some event</code> folders for a
          single day. Only <code className="font-mono">.jpg</code> and{" "}
          <code className="font-mono">.jpeg</code> are read.
        </p>
        <p className="text-xs text-muted">
          Each install has its own — <code className="font-mono">/volume1/MEDIA/PHOTO/BY YEAR</code>{" "}
          on the NAS, a <code className="font-mono">{"//SERVER/SHARE/…"}</code> path from Windows. Spaces
          are fine; don&apos;t add quotes. Leave blank to switch the feature off.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={handleCheckAccess} disabled={isChecking}>
            {isChecking ? "Checking…" : "Check Access"}
          </Button>
          <span className="text-xs text-muted">
            Tests the path in the box — save afterwards to keep it.
          </span>
        </div>

        {checkError && <p className="text-sm text-red-400">{checkError}</p>}
        {report && <AccessReportPanel report={report} />}
      </div>

      <div className="border-t border-line pt-4">
        <Button onClick={handleSave} disabled={isBusy}>
          {isBusy ? "Saving…" : "Save preferences"}
        </Button>
      </div>
    </div>
  );
}

/**
 * The Check Access result.
 *
 * Shows the folders it actually found rather than a bare "OK": the whole reason this
 * panel exists is that a pass/fail verdict could not distinguish a wrong path from an
 * unreadable share, so the evidence is the useful part.
 */
function AccessReportPanel({ report }: { report: AccessReport }) {
  const { diagnosis, checkedPath, isFromSetting } = report;
  const { rootCheck } = diagnosis;
  const isOk = rootCheck.kind === "ok";

  return (
    <div
      className={`rounded-lg border p-3 ${
        isOk ? "border-emerald-500/40 bg-emerald-500/5" : "border-red-500/40 bg-red-500/5"
      }`}
    >
      <p className={`text-sm font-medium ${isOk ? "text-emerald-400" : "text-red-400"}`}>
        {isOk ? "The app can read this folder." : rootProblemHeadline(rootCheck.kind, checkedPath)}
      </p>

      <dl className="mt-2 flex flex-col gap-1 text-xs">
        <Row label="Path checked">
          <code className="font-mono break-all">{checkedPath === "" ? "(blank)" : checkedPath}</code>
        </Row>
        <Row label="Source">
          {isFromSetting ? "This screen's setting" : "MYHOMEBASE_PHOTO_ROOT (environment)"}
        </Row>

        {!isOk && <Row label="What to do">{rootProblemFix(rootCheck.kind)}</Row>}

        {isOk && (
          <>
            <Row label="Year folders">
              {diagnosis.yearFolderCount === 0
                ? "None found — the folder is readable but has no sub-folders."
                : `${diagnosis.yearFolderCount} found`}
            </Row>
            {diagnosis.yearFolders.length > 0 && (
              <Row label="Names">
                <code className="font-mono break-all">
                  {diagnosis.yearFolders.join(", ")}
                  {diagnosis.truncatedYears && " …"}
                </code>
              </Row>
            )}
            <Row label={`Folder for ${diagnosis.sampleYear}`}>
              {diagnosis.sampleYearExists
                ? `${diagnosis.sampleFolderCount} sub-folder${diagnosis.sampleFolderCount === 1 ? "" : "s"}`
                : `No ${diagnosis.sampleYear} folder (fine if nothing is filed for that year yet)`}
            </Row>
            {diagnosis.sampleFolders.length > 0 && (
              <Row label="Examples">
                <code className="font-mono break-all">
                  {diagnosis.sampleFolders.join(" · ")}
                  {diagnosis.truncatedFolders && " …"}
                </code>
              </Row>
            )}
            {diagnosis.samplePhotoCount !== undefined && (
              <Row label="Photos">
                {/* The end-to-end proof: files are readable, not just folder names. */}
                {diagnosis.samplePhotoCount > 0 ? (
                  <>
                    {diagnosis.samplePhotoCount} JPEG
                    {diagnosis.samplePhotoCount === 1 ? "" : "s"} in{" "}
                    <code className="font-mono break-all">{diagnosis.samplePhotoFolder}</code> — the
                    app can read files, not just folder names.
                  </>
                ) : (
                  "Folder names are readable, but no JPEGs were found in the first few folders. That is fine if those months hold only RAW files or nothing yet."
                )}
              </Row>
            )}
          </>
        )}
      </dl>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 uppercase tracking-wide text-muted sm:w-40">{label}</dt>
      <dd className="min-w-0 flex-1 text-ink">{children}</dd>
    </div>
  );
}

function rootProblemHeadline(kind: string, path: string): string {
  const shown = path === "" ? "(blank)" : path;
  switch (kind) {
    case "not-configured":
      return "No photo folder is set.";
    case "missing":
      return `Nothing exists at ${shown}.`;
    case "no-permission":
      return `${shown} exists, but the app isn't allowed to read it.`;
    case "not-a-directory":
      return `${shown} is a file, not a folder.`;
    default:
      return `Couldn't reach ${shown}.`;
  }
}

/**
 * The fix for each cause, in the order they're worth trying. Specific on purpose —
 * "check your configuration" is what made the original failure hard to act on.
 */
function rootProblemFix(kind: string): string {
  switch (kind) {
    case "not-configured":
      return "Type the archive's full path in the box above, then press Check Access.";
    case "missing":
      return "Check the volume and the exact spelling and capitalisation. On the NAS a share lives under /volume1 or /volume2, and the path is case-sensitive there even though Windows isn't.";
    case "no-permission":
      return "Give the user the app runs as read access to that shared folder — on DSM, Control Panel → Shared Folder → Edit → Permissions. A folder you can list over SMB or in an admin shell can still be denied to the app's own account.";
    case "not-a-directory":
      return "Point the path at the folder that contains the year folders, not at a file inside it.";
    default:
      return "The path is set but the filesystem didn't answer. If the archive is on another machine, check that the share is mounted and the host is up.";
  }
}
