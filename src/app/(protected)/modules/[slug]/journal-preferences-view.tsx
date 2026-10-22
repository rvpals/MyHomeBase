"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { ColorField } from "@/components/color-field";
import type { DashboardTextureItem } from "@/lib/dashboard-texture";
import {
  HANDWRITING_SIZE_OPTIONS,
  type JournalHandwritingSize,
  type JournalPreferences,
  type JournalTemperatureUnit,
} from "@/lib/journal";
import type { PhotoArchiveDiagnosis } from "@/lib/journal-photos";
import { checkPhotoAccessAction, saveJournalPreferencesAction } from "./journal-actions";
import { restoreWordAction } from "./journal-word-actions";
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

/** `#RRGGBB` — the one shape the picker emits and the resolver stores. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function JournalPreferencesView({
  preferences,
  textures,
}: {
  preferences: JournalPreferences;
  /**
   * The app texture library — the same rows Administration → Configuration →
   * App Texture renders. Pictures are chosen here, never uploaded: this screen
   * stores a pointer, so an empty library is a normal state and gets a sentence
   * pointing at the admin screen rather than a second upload control.
   */
  textures: DashboardTextureItem[];
}) {
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
  const [handwritingSize, setHandwritingSize] = useState<JournalHandwritingSize>(
    preferences.handwritingSize,
  );
  const [reviewBeforeCalendarImport, setReviewBeforeCalendarImport] = useState(
    preferences.reviewBeforeCalendarImport,
  );
  const [contentTextureId, setContentTextureId] = useState(preferences.contentTextureId);
  const [contentTextureOpacity, setContentTextureOpacity] = useState(
    preferences.contentTextureOpacity,
  );
  // Held as the raw string rather than as `string | null`, because `ColorField`
  // raises every keystroke including invalid ones — a half-typed "#1A2" has to
  // survive in state or the field fights the typist. `""` is the unset state,
  // and the save below converts both "" and anything malformed back to null.
  const [contentTextColor, setContentTextColor] = useState(preferences.contentTextColor ?? "");
  // Held in state rather than read straight from the prop so a restore updates
  // the list immediately; the server action hands back the new list.
  const [excludedWords, setExcludedWords] = useState(preferences.excludedWords);
  const [restoring, setRestoring] = useState<string | undefined>(undefined);
  const [restoreError, setRestoreError] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const [isChecking, setIsChecking] = useState(false);
  const [report, setReport] = useState<AccessReport | undefined>(undefined);
  const [checkError, setCheckError] = useState<string | undefined>(undefined);

  async function handleRestore(word: string) {
    setRestoring(word);
    setRestoreError(undefined);
    try {
      const result = await restoreWordAction(word);
      if (!result.ok) {
        setRestoreError(result.error ?? `Failed to restore "${word}".`);
        return;
      }
      // The action hands back the stored list, so the chip row reflects what was
      // actually written rather than an optimistic guess.
      setExcludedWords(result.words ?? []);
      // The home screen's ranking is computed on the server and has to be
      // recomputed now this word counts again.
      router.refresh();
    } finally {
      setRestoring(undefined);
    }
  }

  // Blank is valid and means "use the theme's ink". Anything else has to be a
  // full #RRGGBB: the value becomes a CSS color, and the resolver would discard
  // a malformed one silently — so the screen says so instead of letting a save
  // look like it worked.
  const trimmedColor = contentTextColor.trim();
  const colorError =
    trimmedColor !== "" && !HEX_COLOR.test(trimmedColor)
      ? "Enter a 6-digit hex colour like #1A2B3C, or clear the field to use the theme's text colour."
      : undefined;

  async function handleSave() {
    if (colorError) {
      setError(colorError);
      return;
    }
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
        handwritingSize,
        reviewBeforeCalendarImport,
        // Carried through untouched. This form does not edit the word list — the
        // (x) buttons below write it directly — but the save behind this button
        // is *wholesale*, so omitting the field here would delete every stored
        // exclusion the moment anyone pressed Save.
        excludedWords,
        contentTextureId,
        contentTextureOpacity,
        // Normalized to upper case here as well as in the resolver, so the
        // value this screen sends is the one it would read back.
        contentTextColor: trimmedColor === "" ? null : trimmedColor.toUpperCase(),
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
        How this journal behaves and how the entry form looks. New entries use the default
        location to fetch today&apos;s weather when you haven&apos;t picked a location on the
        entry itself. One <strong className="font-medium text-ink">Save preferences</strong> at
        the bottom writes all three cards — the exception is the excluded-word list, where each
        ✕ saves on its own.
      </p>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {message && <p className="text-sm text-emerald-400">{message}</p>}

      {/* The temperature unit lives with the location rather than with the
          other writing settings: it exists to format the weather the default
          location fetches, so the two are one decision. */}
      <CollapsibleCard title="Location Preference" defaultOpen>
        <div className="flex flex-col gap-4">
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
        </div>
      </CollapsibleCard>

      <CollapsibleCard title="Preferences" defaultOpen>
        <div className="flex flex-col gap-4">
        {/* Options come from the lib table, not a second list here: a hardcoded
            copy is how a dropdown ends up offering a size the field can't draw. */}
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Handwriting font size</span>
          <select
            value={handwritingSize}
            onChange={(event) => setHandwritingSize(event.target.value as JournalHandwritingSize)}
            className={SELECT_CLASS}
          >
            {HANDWRITING_SIZE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} ({option.px}px)
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-muted">
            How large the cursive text is on a new entry&apos;s Content field with{" "}
            <strong className="font-medium text-ink">Handwriting</strong> switched on. The field&apos;s
            normal (non-cursive) size doesn&apos;t change, so it still matches the other fields.
          </span>
        </label>

        {/* Its own group: this one governs the Calendar Import section rather than
            how an entry is written or read, which is what everything above does. */}
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <span className="block text-sm font-medium text-ink">Calendar import</span>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="mt-1"
              checked={reviewBeforeCalendarImport}
              onChange={(event) => setReviewBeforeCalendarImport(event.target.checked)}
            />
            <span>
              Review existing journal entry before import from Calendar
              <span className="mt-0.5 block text-xs text-muted">
                With this on, starting an import from the Calendar Import section stops first and
                shows what the journal already holds on each date it is about to write into. You can
                then drop any of those dates from the run. Dates with no entry yet import straight
                through without asking.
              </span>
            </span>
          </label>
        </div>

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

        {/* Its own group, and the one block here that writes immediately rather
            than on Save: each (x) is its own action, so there is nothing to keep. */}
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <span className="block text-sm font-medium text-ink">Excluded words</span>
          <p className="text-xs text-muted">
            Words dismissed from the home screen&apos;s{" "}
            <span className="text-ink">Top 10 most frequently used words</span> with the ✕ beside
            them. These are on top of a built-in list of common English words (the, this, was) that
            is never ranked and can&apos;t be edited here. Removing a word from this list starts
            counting it again.
          </p>

          {restoreError && <p className="text-sm text-red-400">{restoreError}</p>}

          {excludedWords.length === 0 ? (
            <p className="text-sm text-muted">
              No words excluded yet. Dismiss one from the home screen&apos;s word list to add it
              here.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {excludedWords.map((word) => (
                <li
                  key={word}
                  className="flex items-center gap-1.5 rounded-full bg-brass-soft px-2.5 py-1 text-sm text-brass-dark"
                >
                  <span className="truncate">{word}</span>
                  <button
                    type="button"
                    onClick={() => handleRestore(word)}
                    disabled={restoring !== undefined}
                    title={`Count "${word}" again`}
                    aria-label={`Count "${word}" again`}
                    className="shrink-0 font-mono text-xs leading-none transition-colors hover:text-red-400 disabled:opacity-40"
                  >
                    {restoring === word ? "…" : "✕"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          </div>
        </div>
      </CollapsibleCard>

      <CollapsibleCard title="Journal Entry screen" defaultOpen>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Setting some preferences for the journal entry screen.
          </p>

          <ContentTextureField
            textures={textures}
            value={contentTextureId}
            onChange={setContentTextureId}
            opacity={contentTextureOpacity}
            onOpacityChange={setContentTextureOpacity}
            textColor={HEX_COLOR.test(contentTextColor.trim()) ? contentTextColor.trim() : undefined}
            disabled={isBusy}
          />

          <ColorField
            label="Color for content text"
            hint="What the Content field's text is written in. Leave blank to follow the theme's own text colour, which is what it does today."
            value={contentTextColor}
            onChange={setContentTextColor}
            error={colorError}
            disabled={isBusy}
          />
          {/* Clearing is its own control: `<input type="color">` has no empty
              state, so without this there would be no way back to the theme's
              ink once a colour had been picked. */}
          {contentTextColor !== "" && (
            <div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setContentTextColor("")}
                disabled={isBusy}
              >
                Use the theme&apos;s text colour
              </Button>
            </div>
          )}
        </div>
      </CollapsibleCard>

      <div className="border-t border-line pt-4">
        <Button onClick={handleSave} disabled={isBusy}>
          {isBusy ? "Saving…" : "Save preferences"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Picks the picture drawn behind the entry form's Content field.
 *
 * Route-local rather than a registered component, the same call
 * `NavTextureControl`, `ToolbarTextureField` and `ModuleTextureControl` all
 * make: each is one control bound to its own screen's state, and components.md
 * keeps page-specific UI out of the registry. This is the fourth copy of the
 * pattern, which is the point at which extracting it starts to look right — but
 * a fifth caller is the trigger, not a fourth, and the four differ in whether
 * they carry an opacity slider, a save button and an "app texture" scope.
 *
 * NO UPLOAD HERE. Pictures come from the app texture library and are managed on
 * Administration → Configuration → App Texture; this screen stores a pointer.
 *
 * THE STRENGTH IS THE JOURNAL'S OWN, not the library picture's — the same call
 * `NavTextureControl` and the personal toolbars make. A library picture's
 * opacity was tuned for whatever surface it last sat on, and the Content field
 * is a surface you stare at while writing an entry, so it gets its own knob.
 *
 * NARROW SCREENS: the grid steps 4 → 6 → 8 columns on plain responsive
 * variants, so it is the same component at every width. The preview is a fixed
 * small block that fits the narrowest layout.
 */
function ContentTextureField({
  textures,
  value,
  onChange,
  opacity,
  onOpacityChange,
  textColor,
  disabled,
}: {
  textures: DashboardTextureItem[];
  value: number | null;
  onChange: (next: number | null) => void;
  opacity: number;
  onOpacityChange: (next: number) => void;
  /**
   * The colour currently chosen for content text, when it is a valid hex —
   * so the preview shows the two settings together, which is how they are
   * actually read. `undefined` falls back to the theme's ink, exactly as the
   * real field does.
   */
  textColor?: string;
  disabled: boolean;
}) {
  // `v=` busts the serving route's 5-minute cache, so replacing a picture in
  // the library doesn't leave a stale thumbnail here.
  const thumbnail = (item: DashboardTextureItem) =>
    `/api/dashboard/texture?id=${item.id}&v=${encodeURIComponent(item.updatedAt)}`;

  // Undefined for "None", and also for a pointer at a picture that is no longer
  // in the library — a stale selection the resolver already treats as no
  // texture, so the slider and preview hide rather than showing a broken tile.
  const selected = textures.find((item) => item.id === value);

  return (
    <div>
      <span className="block text-xs font-medium uppercase tracking-wider text-muted">
        Content background texture
      </span>
      <p className="mt-1 text-xs text-muted">
        A picture drawn behind the Content field while you write. Pictures come from the
        application&apos;s texture library — add one under Administration → Configuration → App
        Texture, then pick it here. Each is drawn at the strength it was tuned to in the library.
      </p>

      {textures.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-muted">
          No pictures in the library yet. Add one under Administration → Configuration → App
          Texture, then pick it here.
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
          {/* "None" is a tile rather than a Clear button beside the grid, so
              turning the texture off is the same gesture as choosing one. */}
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            title="No texture — the plain sheet"
            aria-pressed={value === null}
            className={`flex aspect-square items-center justify-center rounded-md border bg-paper text-xs text-muted transition-colors ${
              value === null ? "border-brass ring-2 ring-brass" : "border-line hover:border-brass/50"
            }`}
          >
            None
          </button>

          {textures.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              disabled={disabled}
              // The picture's name, because a tile of an abstract texture at
              // 48px is not something a reader can identify by sight.
              title={item.name}
              aria-pressed={value === item.id}
              className={`overflow-hidden rounded-md border transition-colors ${
                value === item.id ? "border-brass ring-2 ring-brass" : "border-line hover:border-brass/50"
              }`}
            >
              {/* A plain <img>: these are same-origin, already-sized library
                  thumbnails behind a session-gated route, so next/image would
                  add an optimizer hop for no benefit. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumbnail(item)} alt={item.name} className="aspect-square w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {/* Shown only with a picture chosen — a strength slider for no texture is
          a control that does nothing, and hiding it says so more clearly than
          disabling it would. Same call `NavTextureControl` makes. */}
      {selected && (
        <>
          <div className="mt-4">
            <label
              htmlFor="journal-content-texture-opacity"
              className="flex items-baseline justify-between text-xs font-medium text-ink"
            >
              Strength
              <span className="font-mono text-muted">{Math.round(opacity * 100)}%</span>
            </label>
            <input
              id="journal-content-texture-opacity"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(event) => onOpacityChange(Number(event.target.value))}
              disabled={disabled}
              className="mt-2 w-full accent-brass"
            />
            <p className="mt-1 text-xs text-muted">
              This journal&apos;s own strength, not the picture&apos;s. A background you write
              on top of wants to sit further back than the same picture would behind a
              dashboard, so it is tuned here rather than inherited from the library.
            </p>
          </div>

          {/* The preview. A miniature of the field with lines of text on it, for
              the reason the texture gallery's own preview gives: judging a
              background without the thing that sits on it is guesswork. The
              chosen text colour is applied too, since these two settings are
              read together and a pale colour on a busy picture is exactly the
              combination worth catching before saving. */}
          <div className="mt-5">
            <p className="text-xs font-medium text-ink">Preview</p>
            <div className="relative mt-2 h-32 w-full max-w-sm overflow-hidden rounded-md border border-line bg-paper">
              <span
                aria-hidden
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: `url("${thumbnail(selected)}")`, opacity }}
              />
              {/* `currentColor` so one `color` drives every line, and the
                  fallback is the theme's ink exactly as the real field's is. */}
              <div
                className="relative space-y-2 p-3 text-ink"
                style={textColor ? { color: textColor } : undefined}
              >
                <div className="h-2 w-5/6 rounded-sm bg-current opacity-80" />
                <div className="h-2 w-full rounded-sm bg-current opacity-70" />
                <div className="h-2 w-4/6 rounded-sm bg-current opacity-70" />
                <div className="h-2 w-11/12 rounded-sm bg-current opacity-70" />
                <div className="h-2 w-1/2 rounded-sm bg-current opacity-60" />
              </div>
            </div>
          </div>
        </>
      )}
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
