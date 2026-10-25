"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { Comments } from "@/components/comments";
import { EncryptionPrompt } from "@/components/encryption-prompt";
import {
  ENTRY_ENCRYPTION_EXPLAINER_TITLE,
  EntryEncryptionExplainer,
} from "@/components/entry-encryption-explainer";
import { CollapsibleCard } from "@/components/collapsible-card";
import { FullscreenStage, canGoFullscreen } from "@/components/fullscreen-stage";
import { Tabs } from "@/components/tabs";
import { TokenPicker } from "@/components/token-picker";
import { TreeIcon } from "@/components/tree-icons";
import { useCurrentPosition } from "@/components/use-current-position";
import type { DashboardTextureItem } from "@/lib/dashboard-texture";
import {
  applyPrefillTemplate,
  contentFontFamily,
  contentSizeClass,
  handwritingSizeClass,
  nextContentSizeUp,
  resolveJournalContentTexture,
  type JournalHandwritingSize,
  type JournalPreferences,
  type JournalPrefillFormValues,
  type JournalPrefillTemplate,
} from "@/lib/journal";
import {
  createEncryptedJournalEntryAction,
  createJournalEntryAction,
  fetchWeatherAction,
  reverseGeocodeAction,
  type EntryWeatherInput,
  type JournalLocationInput,
} from "./journal-actions";
import { JournalLocationPicker } from "./journal-location-picker";
// Clips on the entry form. Imported here, in presentation, so `src/lib/journal`
// still knows nothing about clips — the layering note in migration 0155.
import type { ClipSummary } from "@/lib/clips";
import { linkClipAction } from "./clips-actions";
import { JournalEntryClipsField } from "./journal-entry-clips-field";

// The lock toggle's two faces. Inline stroked SVGs rather than an emoji padlock:
// an emoji renders in the font's own colours and sizing, so it can't follow the
// theme's ink colour or sit on the Button's baseline the way every other glyph
// in the app does. Same shape and stroke weight as the viewer's icons.
//
// The two differ only in the shackle — closed sits on the body, open is lifted
// and hinged to one side — so the state reads at a glance without the colour
// being the only cue.
function LockClosedIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function LockOpenIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 7.5-1.9" />
    </svg>
  );
}

// "Save entry encrypted", as a glyph. A key, deliberately *not* another padlock:
// it sits inches from the lock toggle above and the two mean entirely different
// things — that one is an edit guard you can undo, this one seals the text under
// a password and cannot be undone without it. Two padlocks side by side would
// read as two strengths of the same thing.
function KeyIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <circle cx="8" cy="8" r="4.5" />
      <path d="M11.2 11.2L20 20M17 17l-2 2M14 14l-2 2" />
    </svg>
  );
}

// Every field's shape except its size, so a field that sets its own size does
// not emit two conflicting `text-*` classes. Tailwind v4 puts both in the same
// layer, where the winner is decided by the order they appear in the generated
// stylesheet rather than in the class attribute — so "append the override" is
// not reliable, and the only safe fix is to leave the base size out.
const INPUT_BASE_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/** The ordinary form field: the shape above at the standard 14px. */
const INPUT_CLASS = `${INPUT_BASE_CLASS} text-sm`;

const pad2 = (value: number) => String(value).padStart(2, "0");

// Local calendar date as YYYY-MM-DD (not UTC), so the default matches the user's day.
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

// Local wall-clock time as HH:MM:SS, matching the Time input's `step={1}`.
//
// Read in the browser for the same reason `todayIso` is: the time on an entry is
// the moment the writer is living in, not the server's instant, so resolving it
// server-side would stamp a late-evening entry with the wrong hour (and, past
// midnight UTC, the wrong day) for anyone in another timezone. Same rule the
// prefill templates' "current time" follows — see migration 0062.
function nowIso(): string {
  const now = new Date();
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
}

// The handwriting sheet's type, for the in-card field and the fullscreen stage.
//
// `font-script-journal`, NOT `font-script` — the two are different settings as of
// migrations/0137 (design.md → *The two exceptions*). `font-script` is the Daily
// Quote's face; this surface has its own, chosen on Administration → Display
// Settings → Script Fonts, because a hand you read a paragraph back in wants to be
// steadier than a hand for a line you glance at. Both default to Great Vibes, so
// this renders exactly as it did before the split until somebody changes one.
//
// The size comes from the module's `handwritingSize` preference, whose smallest
// offered value is the 20px floor design.md sets — so the floor holds wherever
// this is called without a check here. Deliberately no `max-lg:` step-down: 18px
// script on a phone is the least readable combination in the app, and an explicitly
// chosen size shouldn't be silently overridden on a narrow screen.
//
// Note the size is NOT adjusted per face, though the faces differ in how large
// they look at the same size — Kalam and Caveat read bigger than the copperplates.
// Left alone deliberately: the size is the writer's explicit choice in the module's
// own Preferences, and silently scaling it to compensate would override a setting
// its owner can see. The Script Fonts screen says so instead.
function handwritingClass(size: JournalHandwritingSize): string {
  return `font-script-journal leading-relaxed ${handwritingSizeClass(size)}`;
}

/**
 * Splits a prefill template's delimited text into names. Templates predate the
 * pickers and still store "FAMILY, PERSONAL" as one string, so a template's
 * value has to be broken up before it can become chips. A name the template
 * carries that no longer exists as a category/tag still becomes a chip and gets
 * registered on save — the same thing typing it would have done.
 */
function splitNames(text: string, separator: string | RegExp): string[] {
  const seen = new Set<string>();
  return text
    .split(separator)
    .map((name) => name.trim())
    .filter((name) => {
      if (name === "" || seen.has(name.toLowerCase())) return false;
      seen.add(name.toLowerCase());
      return true;
    });
}

const emptyForm = (date: string, time: string) => ({
  date,
  time,
  title: "",
  placeName: "",
  categories: [] as string[],
  tags: [] as string[],
  content: "",
});

/**
 * Values a caller can seed the form with, instead of a blank entry stamped with
 * the current clock.
 *
 * Added for Review Data's Merge, which proposes an entry assembled from several
 * others and needs the reader to edit it before it is saved. Every field is
 * optional and anything omitted falls back to what a blank form would have had,
 * so this cannot half-fill the form into an invalid state.
 *
 * Deliberately *not* the prefill-template path: a template fills only the fields
 * you have left blank and is chosen from a dropdown inside the form, whereas
 * this is the form's starting point, decided by the screen that mounted it.
 */
export interface JournalEntryFormInitialValues {
  date?: string;
  time?: string;
  title?: string;
  content?: string;
  placeName?: string;
  categories?: string[];
  tags?: string[];
}

/** Applies `initialValues` over a blank form stamped with the current clock. */
function seededForm(initialValues: JournalEntryFormInitialValues | undefined) {
  const blank = emptyForm(todayIso(), nowIso());
  if (!initialValues) return blank;
  return {
    ...blank,
    ...(initialValues.date ? { date: initialValues.date } : {}),
    ...(initialValues.time ? { time: initialValues.time } : {}),
    ...(initialValues.title !== undefined ? { title: initialValues.title } : {}),
    ...(initialValues.content !== undefined ? { content: initialValues.content } : {}),
    ...(initialValues.placeName !== undefined ? { placeName: initialValues.placeName } : {}),
    ...(initialValues.categories ? { categories: initialValues.categories } : {}),
    ...(initialValues.tags ? { tags: initialValues.tags } : {}),
  };
}

export function JournalEntryForm({
  categoryOptions,
  tagOptions,
  preferences,
  contentTextures = [],
  prefillTemplates = [],
  locationCategoryOptions = [],
  locationTagOptions = [],
  initialValues,
  initialLocations,
  onSaved,
  onSavingChange,
  saveLabel,
}: {
  categoryOptions: string[];
  tagOptions: string[];
  preferences: JournalPreferences;
  /**
   * The app texture library, so `preferences.contentTextureId` — a pointer, not
   * bytes — can be resolved to a picture.
   *
   * Defaults to empty, which resolves to the hand-drawn `.paper-texture` sheet.
   * That keeps the form renderable by a caller that hasn't read the library:
   * the preference degrades to the look the field had before it existed, rather
   * than the form refusing to mount.
   */
  contentTextures?: DashboardTextureItem[];
  /** Enabled templates only — the server filters, so anything here is offerable. */
  prefillTemplates?: JournalPrefillTemplate[];
  /**
   * The saved-location library's own category and tag lists, for the filter
   * chips on the location picker's "From location database" tab. Separate from
   * `categoryOptions`/`tagOptions` above, which are the entry's — see the 0101
   * migration log for why the two taxonomies are deliberately distinct.
   */
  locationCategoryOptions?: string[];
  locationTagOptions?: string[];
  /**
   * Starting values for the fields, instead of a blank entry. Review Data's
   * Merge uses this to hand over the entry it assembled from several others.
   * Absent on the New Entry screen, which wants a blank form.
   */
  initialValues?: JournalEntryFormInitialValues;
  /**
   * Starting pins for the location list, instead of an empty one.
   *
   * Separate from `initialValues` because locations are not a form *field*: they
   * live in their own state, are edited by the location picker rather than by
   * typing, and are an array of objects rather than a string. Folding them into
   * `JournalEntryFormInitialValues` would mean one prop whose members are set
   * through two different mechanisms.
   *
   * Used by Clone, which copies the source entry's pins so a recurring event
   * keeps its place. Absent on the New Entry screen and on Review Data's merge,
   * both of which start with no pins.
   */
  initialLocations?: JournalLocationInput[];
  /**
   * Called after a successful save. The New Entry screen leaves this off and
   * gets the default behaviour (clear the form, ready for the next entry);
   * Review Data's merge dialog uses it to close itself and refresh the list,
   * because a merge is one entry and re-blanking the form there would offer to
   * write a second.
   */
  onSaved?: () => void;
  /**
   * Raised with `true` when a save starts and `false` when it settles, so a
   * caller that wraps this form can show its own waiting state.
   *
   * Review Data's merge dialog uses it to raise a `BusyOverlay`: writing a
   * merged entry is a long write behind a dialog whose only other signal is the
   * Save button's label changing, which is exactly what that overlay is for. The
   * New Entry screen leaves it off — it is a page, not a dialog, and the button
   * label is signal enough there.
   *
   * The form still owns the flag; this only reports it. Nothing here waits on
   * the caller, so a caller that ignores it behaves exactly as before.
   */
  onSavingChange?: (isSaving: boolean) => void;
  /** Overrides the Save button's label — "Save merged entry" for a merge. */
  saveLabel?: string;
}) {
  const router = useRouter();
  // Date and time both start at the writer's current clock, unless the caller
  // seeded them. Lazy initialiser, so the clock is read when the form mounts
  // rather than on every render.
  const [form, setForm] = useState(() => seededForm(initialValues));
  // Seeded from `initialLocations` when the caller supplied pins (Clone), empty
  // otherwise. Copied rather than aliased, for the same reason the form's own
  // arrays are: adding a pin here must not reach back into the seed the server
  // built, which React keeps alive across re-renders.
  const [locations, setLocations] = useState<JournalLocationInput[]>(() => [
    ...(initialLocations ?? []),
  ]);
  // Clips chosen for this entry (migration 0155). Pending until the entry is
  // saved: on a new entry there is no row to link to, so `handleSave` writes the
  // links once it has an id. Not seeded from `initialValues` — cloning an entry
  // copies what the writer wrote, and the clips attached to the original support
  // *that* entry, not a new one that happens to start from the same text.
  const [clips, setClips] = useState<ClipSummary[]>([]);
  // Weather is held as three strings, not an EntryWeatherInput, because these
  // are text inputs: a half-typed temperature ("-", "1.") is not a number yet
  // and the field still has to let the writer get there. `typedWeather` below
  // folds them back into the object the action takes. The fetch buttons write
  // through the same fields, so a fetched reading can be corrected by hand.
  const [weatherTemp, setWeatherTemp] = useState("");
  const [weatherUnit, setWeatherUnit] = useState("");
  const [weatherDescription, setWeatherDescription] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);
  const [isFetchingWeather, setIsFetchingWeather] = useState(false);
  const [isLocatingAndFetching, setIsLocatingAndFetching] = useState(false);
  const [templateId, setTemplateId] = useState("");
  // Whether the "Save entry encrypted" dialog is open (migration 0131). The
  // password lives inside EncryptionPrompt and is handed straight to the action
  // -- this form never holds it, and a cancelled dialog leaves the draft alone.
  const [isEncryptPromptOpen, setIsEncryptPromptOpen] = useState(false);
  // Whether "Save entry" writes the entry already locked. A decision about the
  // save that hasn't happened yet, not a lock being applied now — hence the
  // outcome-stating label on the toggle rather than the viewer's "Lock".
  //
  // Deliberately not wired to "Save entry encrypted": that flow has no undo and
  // its own dialog, and adding a second seal to it from a control outside the
  // dialog would make an irreversible button mean two things. An encrypted
  // entry can still be locked afterwards from its own page.
  const [saveLocked, setSaveLocked] = useState(false);
  // Whether "Save entry" writes the entry already pinned, so it lands on the Journal
  // home screen's Pinned Entries card. Same shape as `saveLocked` above and for the
  // same reason: a decision about the save that hasn't happened yet, not a pin being
  // applied now — so it is a toggle beside Save, not a write.
  const [savePinned, setSavePinned] = useState(false);
  // Content-card view state. Both are transient: a mode you put the field into
  // for this sitting, not a stored preference, so they reset with the form.
  const [isHandwriting, setIsHandwriting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Resolved after mount, never during render: `canGoFullscreen` reads
  // `document.fullscreenEnabled`, which the server doesn't have, and rendering
  // the button on one and not the other is a hydration mismatch. Starts false so
  // the control is absent until known-supported — iOS Safari on iPhone has no
  // element fullscreen, and FullscreenStage's own note is that a dead button is
  // worse than no button.
  const [canFullscreen, setCanFullscreen] = useState(false);
  const { request: requestPosition } = useCurrentPosition();

  useEffect(() => {
    setCanFullscreen(canGoFullscreen());
  }, []);

  // Text fields only. Categories and tags are arrays and go through setTaxonomy.
  type TextField = Exclude<keyof ReturnType<typeof emptyForm>, "categories" | "tags">;

  function update(field: TextField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function setTaxonomy(field: "categories" | "tags", names: string[]) {
    setForm((current) => ({ ...current, [field]: names }));
  }

  // Re-reads the clock rather than restoring the mount-time values, so the next
  // entry of a sitting is stamped when it is written, not when the page loaded.
  //
  // With `initialValues` it goes back to those instead of to blank: on the merge
  // dialog "Clear" means "undo my edits to the proposal", and wiping to an empty
  // form there would throw away the assembled content with no way to get it back
  // short of closing the dialog and ticking the rows again.
  function reset() {
    setForm(seededForm(initialValues));
    // Back to the seeded pins, not to none — on a cloned form "Clear" means
    // "undo my edits", and wiping the copied locations would throw away the
    // part of the clone that is most tedious to re-pick by hand. Matches how
    // `seededForm` above treats the text fields.
    setLocations([...(initialLocations ?? [])]);
    // To none, unlike the pins above: clips are never seeded (cloning an entry
    // does not copy them — see the state declaration), so "none" *is* this
    // field's starting value. Clearing here also stops a failed attach leaving
    // the picks on screen to be silently re-attached to the next entry written.
    setClips([]);
    setWeatherTemp("");
    setWeatherUnit("");
    setWeatherDescription("");
    setTemplateId("");
    setIsHandwriting(false);
    // Back to unlocked for the next entry of the sitting: locking is a choice
    // made per entry, and a toggle that stayed on would quietly lock entries
    // the writer never asked to lock.
    setSaveLocked(false);
    // Unpinned again for the next entry, on the same rule: a toggle left on would
    // quietly pin every entry of the sitting to the home screen.
    setSavePinned(false);
  }

  // Fills the blank fields from a saved template. The merge itself is
  // `applyPrefillTemplate` in lib — this only maps between the form's field
  // names and the template's, and supplies the clock.
  //
  // `new Date()` here, in the browser, is deliberate: an entry's date is the
  // calendar day the writer is living in, so resolving a template's "current
  // date" on the server would file a late-evening entry under the wrong day for
  // anyone in a different timezone. See migration 0062.
  function handleApplyTemplate(rawId: string) {
    setTemplateId(rawId);
    if (rawId === "") return;
    const template = prefillTemplates.find((candidate) => String(candidate.id) === rawId);
    if (!template) return;

    setForm((current) => {
      const values: JournalPrefillFormValues = {
        date: current.date,
        time: current.time,
        title: current.title,
        content: current.content,
        placeName: current.placeName,
        categories: current.categories.join(", "),
        tags: current.tags.join(" "),
      };
      const filled = applyPrefillTemplate(template, values, new Date());
      return {
        ...current,
        date: filled.date,
        time: filled.time,
        title: filled.title,
        content: filled.content,
        placeName: filled.placeName,
        categories: splitNames(filled.categories, ","),
        tags: splitNames(filled.tags, /\s+/),
      };
    });
  }

  // Weather is fetched for the first picked location if there is one, otherwise
  // the default location from preferences.
  async function handleFetchWeather() {
    const source = locations[0] ?? preferences.defaultLocation;
    if (!source) {
      setError("Pick a location on the Misc tab, or set a default location in Preferences, to fetch weather.");
      return;
    }
    setIsFetchingWeather(true);
    setError(undefined);
    try {
      const result = await fetchWeatherAction(source.latitude, source.longitude, preferences.temperatureUnit);
      if (!result.ok || !result.weather) {
        setError(result.error ?? "Failed to fetch weather.");
        return;
      }
      const { temperature, unit, description } = result.weather;
      setWeatherTemp(String(temperature));
      setWeatherUnit(unit);
      setWeatherDescription(description);
    } finally {
      setIsFetchingWeather(false);
    }
  }

  // One press fills both fields: read GPS, name the point by reverse geocoding,
  // append it to the locations list, and fetch that point's weather. Each stage
  // keeps what the earlier ones produced — a failed name still lands the
  // coordinates, and failed weather still lands the location.
  async function handleGpsAndWeather() {
    setIsLocatingAndFetching(true);
    setError(undefined);
    try {
      const located = await requestPosition();
      if (!located.ok) {
        setError(located.error);
        return;
      }
      const { latitude, longitude } = located.position;

      const geocoded = await reverseGeocodeAction(latitude, longitude);
      const locationName = geocoded.ok && geocoded.place ? geocoded.place.displayName : "";
      setLocations((current) => [...current, { latitude, longitude, locationName }]);

      // Only fill the free-text Place name if it's still empty — never overwrite
      // something already typed.
      if (locationName !== "") {
        setForm((current) => (current.placeName === "" ? { ...current, placeName: locationName } : current));
      }

      const result = await fetchWeatherAction(latitude, longitude, preferences.temperatureUnit);
      if (!result.ok || !result.weather) {
        setError(result.error ?? "Got your location, but failed to fetch weather.");
        return;
      }
      const { temperature, unit, description } = result.weather;
      setWeatherTemp(String(temperature));
      setWeatherUnit(unit);
      setWeatherDescription(description);
    } finally {
      setIsLocatingAndFetching(false);
    }
  }

  // Mirrors the editor: the temperature is the anchor, so an empty one means the
  // entry records no weather, and a non-numeric one is refused on save rather
  // than silently dropping what was typed. `code` is 0 for anything typed by
  // hand -- only a fetched reading carries a real WMO code, and the viewer hides
  // the chip when it is 0.
  const trimmedTemp = weatherTemp.trim();
  const parsedTemp = trimmedTemp === "" ? undefined : Number(trimmedTemp);
  const isTempValid = parsedTemp === undefined || Number.isFinite(parsedTemp);
  const typedWeather: EntryWeatherInput | undefined =
    parsedTemp === undefined || !Number.isFinite(parsedTemp)
      ? undefined
      : {
          temp: parsedTemp,
          unit: weatherUnit.trim(),
          description: weatherDescription.trim(),
          code: 0,
        };

  /**
   * Links the clips picked on the form to the entry that was just written.
   *
   * Deliberately does not fail the save. The entry is already on disk by the time
   * this runs, and throwing away a written entry because a link could not be made
   * would be the worse outcome — the reader is told, and can attach it again from
   * the clip's own viewer.
   */
  async function attachPendingClips(entryId: number | undefined) {
    if (entryId === undefined || clips.length === 0) return;

    const failed: string[] = [];
    for (const clip of clips) {
      const result = await linkClipAction(clip.id, entryId);
      if (!result.ok) failed.push(clip.title || "(untitled)");
    }

    if (failed.length > 0) {
      setError(`The entry was saved, but these clips were not attached: ${failed.join(", ")}.`);
    } else {
      setClips([]);
    }
  }

  async function handleSave() {
    if (!isTempValid) {
      setError("Temperature must be a number, or empty to record no weather.");
      return;
    }
    setIsBusy(true);
    onSavingChange?.(true);
    setError(undefined);
    try {
      const result = await createJournalEntryAction({
        ...form,
        locations,
        weather: typedWeather,
        isLocked: saveLocked,
        isPinned: savePinned,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // The clips picked on the form are linked now, because only now does the
      // entry have a row to link to. Failures are reported but do not fail the
      // save: the entry is written, and losing the typed entry over a link that
      // can be re-made by hand would be the worse trade.
      await attachPendingClips(result.entryId);

      // A caller that supplied `onSaved` owns what happens next — the merge
      // dialog closes itself and reloads its list. Without one, the form clears
      // and is ready for the next entry, which is what New Entry wants.
      if (onSaved) {
        onSaved();
      } else {
        reset();
      }
      router.refresh(); // re-fetch the recent-entries list on the server
    } finally {
      setIsBusy(false);
      onSavingChange?.(false);
    }
  }

  /**
   * Saves the draft already sealed — the "Save entry encrypted" button.
   *
   * One action, not save-then-encrypt: two calls would put the plaintext on disk
   * in between, and a failure after the first would leave an entry the writer
   * believes is encrypted and isn't.
   *
   * On failure the dialog stays open with the message, so the typed password
   * isn't lost along with the draft.
   */
  async function handleSaveEncrypted(password: string, hint: string) {
    if (!isTempValid) {
      setError("Temperature must be a number, or empty to record no weather.");
      return;
    }
    setIsBusy(true);
    onSavingChange?.(true);
    setError(undefined);
    try {
      const result = await createEncryptedJournalEntryAction(
        { ...form, locations, weather: typedWeather, isPinned: savePinned },
        password,
        hint,
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setIsEncryptPromptOpen(false);
      // The clips go on a sealed entry too: a link records what supports what and
      // reveals nothing about the entry's contents.
      await attachPendingClips(result.entryId);
      // Same contract as handleSave: a caller that supplied `onSaved` owns what
      // happens next, otherwise the form clears for the next entry.
      if (onSaved) {
        onSaved();
      } else {
        reset();
      }
      router.refresh();
    } finally {
      setIsBusy(false);
      onSavingChange?.(false);
    }
  }

  // Resolved once for both copies of the field — the one in the card and the one
  // on the fullscreen stage — so they can't drift to different sizes.
  const cursiveClass = handwritingClass(preferences.handwritingSize);

  // The chosen Content background, or `undefined` for the hand-drawn
  // `.paper-texture` sheet. Resolved here for the same reason as the size: two
  // copies of the field, one answer.
  //
  // Unlike the cursive sheet this draws whether Handwriting is on or off — it
  // is the Content field's background, not a handwriting affordance.
  const contentTexture = resolveJournalContentTexture(
    preferences.contentTextureId,
    contentTextures,
    preferences.contentTextureOpacity,
  );

  // The picture goes on an absolutely-positioned underlay rather than on the
  // wrapper itself, because the library's opacity has to fade *the picture* and
  // not the text sitting on it. `opacity` on the wrapper would take the
  // textarea with it. Same reason the app-texture CSS rules use a layer.
  //
  // A function rather than one element reused twice: the two call sites round
  // their corners differently (the card's field is `rounded-md`, the fullscreen
  // sheet `rounded-lg`), and that is the only thing they disagree on. The URL
  // and the opacity come from one resolved value either way.
  const contentTextureLayer = (radiusClass: string) =>
    contentTexture ? (
      <span
        aria-hidden
        // `tile` repeats the picture at its natural size, `cover` stretches one
        // copy — the library row's own choice, as the resolver documents. Two
        // properties rather than one shorthand, because size and repeat have to
        // disagree between the modes (the same pair `app-texture` emits).
        className={`pointer-events-none absolute inset-0 bg-center ${radiusClass}`}
        style={{
          backgroundImage: contentTexture.backgroundImage,
          backgroundSize: contentTexture.mode === "tile" ? "auto" : "cover",
          backgroundRepeat: contentTexture.mode === "tile" ? "repeat" : "no-repeat",
          opacity: contentTexture.opacity,
        }}
      />
    ) : undefined;

  // The inline style both copies of the Content field carry.
  //
  // An omitted property leaves the class to do its job, which is what each
  // unset preference means: `text-ink` for the colour and the theme's body
  // face for the font, both following a theme switch rather than freezing at
  // whatever the theme was when the preference was saved.
  //
  // The FACE applies in both modes, cursive included — it is the field's font
  // and `font-script-journal` overrides it in the class when Handwriting is on.
  // The SIZE does not: that is `cursiveClass`'s job in cursive mode, and
  // `contentSizeClass` below only reaches the plain state.
  const contentFamily = contentFontFamily(preferences.contentFont);
  const contentTextStyle: CSSProperties | undefined =
    preferences.contentTextColor || contentFamily
      ? {
          ...(preferences.contentTextColor ? { color: preferences.contentTextColor } : {}),
          ...(contentFamily ? { fontFamily: contentFamily } : {}),
        }
      : undefined;

  // The plain (non-cursive) size. Resolved once for both copies of the field,
  // for the same reason `cursiveClass` is.
  const plainSizeClass = contentSizeClass(preferences.contentFontSize);

  // The fullscreen stage has always drawn the plain field one step larger than
  // the card does (it was `text-base` against the card's `text-sm`), because a
  // sheet centred on a black stage carries a bigger size comfortably. That
  // relationship is kept rather than dropped: the reader's choice sets the
  // card, and the stage stays one step up — except at the top of the scale,
  // where there is nothing above to step to.
  const plainFullscreenSizeClass = contentSizeClass(
    nextContentSizeUp(preferences.contentFontSize),
  );

  // The two tab bodies, built here rather than inline in the `items` array so
  // the JSX below stays readable. Both close over the one `form` state above.
  const mainTab = (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Date</span>
          <input type="date" value={form.date} onChange={(event) => update("date", event.target.value)} className={INPUT_CLASS} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Time</span>
          <input type="time" step={1} value={form.time} onChange={(event) => update("time", event.target.value)} className={INPUT_CLASS} />
        </label>

        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-ink">Title</span>
          <input type="text" value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="A short headline for the entry" className={INPUT_CLASS} />
        </label>

        <TokenPicker
          label="Categories"
          value={form.categories}
          onChange={(names) => setTaxonomy("categories", names)}
          options={categoryOptions}
          allowCreate
          createPlaceholder="Filter or add a category…"
        />
        <TokenPicker
          label="Tags"
          value={form.tags}
          onChange={(names) => setTaxonomy("tags", names)}
          options={tagOptions}
          allowCreate
          createPlaceholder="Filter or add a tag…"
        />
      </div>

      {/* Content gets a card of its own: it is the entry, and the two controls
          in the header act on it alone rather than on the form. `headerAction`
          keeps them visible even when the card is shut. */}
      <CollapsibleCard
        title="Content"
        defaultOpen
        headerAction={
          <div className="flex flex-wrap items-center gap-2">
            {canFullscreen && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setIsFullscreen(true)}
                title="Show just the content box, filling the screen"
              >
                Full screen
              </Button>
            )}
            {/* On/off is carried by the variant swap. Deliberately no
                `ariaLabel`: `Button` renders it as `aria-label`, which would
                *replace* the visible "Handwriting" text and leave the accessible
                name not matching the label. `Button` also whitelists only
                `ariaExpanded`/`ariaControls`, so `aria-pressed` isn't available
                — the hint lives in `title`, as its doc prescribes. */}
            <Button
              size="sm"
              variant={isHandwriting ? "primary" : "secondary"}
              onClick={() => setIsHandwriting((on) => !on)}
              title="Using cursive font"
            >
              Handwriting
            </Button>
          </div>
        }
      >
        {/* A toggle over the same textarea, not a preview pane: the writer keeps
            typing in cursive rather than having to leave the mode to edit. The
            sheet texture goes on the wrapper and the field turns transparent so
            it sits *on* the paper instead of stacking a second surface over it. */}
        {/* `relative` so the texture underlay can be absolutely positioned
            against this wrapper. A chosen picture replaces `.paper-texture`
            rather than stacking on it — two fibre layers read as noise — and
            draws in both modes, while the hand-drawn sheet stays tied to
            Handwriting as it always was. */}
        {/* With a texture and Handwriting off, the border moves from the field
            to this wrapper: the field has to go transparent for the picture to
            show through, and a transparent field keeping `INPUT_CLASS` would
            draw its border *inside* the textured area rather than around it.
            Handwriting mode has never drawn a border here, textured or not. */}
        <div
          className={`relative ${
            contentTexture
              ? `rounded-md ${isHandwriting ? "" : "border border-line"}`
              : isHandwriting
                ? "rounded-md paper-texture"
                : ""
          }`}
        >
          {contentTextureLayer("rounded-md")}
          <textarea
            value={form.content}
            onChange={(event) => update("content", event.target.value)}
            placeholder="What happened today…"
            aria-label="Content"
            rows={18}
            // `relative` lifts the field above the texture underlay; without a
            // position it would paint under the picture.
            style={contentTextStyle}
            className={
              isHandwriting || contentTexture
                ? `relative w-full resize-y border-0 bg-transparent px-3 py-2 text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
                    // Cursive carries its own size; the plain state takes the
                    // reader's Content font size, which defaults to the same
                    // `text-sm` the other fields use.
                    isHandwriting ? cursiveClass : plainSizeClass
                  }`
                : // The size-free base, so this is the only `text-*` on the
                  // element — see `INPUT_BASE_CLASS`.
                  `${INPUT_BASE_CLASS} resize-y ${plainSizeClass}`
            }
          />
        </div>
      </CollapsibleCard>

      {/* Below the writing, because a clip is what supports what you just wrote.
          On a new entry the picks are held until Save — the field says so — since
          there is no entry row to link them to until then. */}
      <JournalEntryClipsField
        value={clips}
        onChange={setClips}
        categoryOptions={categoryOptions}
        tagOptions={tagOptions}
      />
    </div>
  );

  const miscTab = (
    <div className="flex flex-col gap-4">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Place name</span>
        <input type="text" value={form.placeName} onChange={(event) => update("placeName", event.target.value)} placeholder="e.g. Princeton University" className={INPUT_CLASS} />
      </label>

      <JournalLocationPicker
        value={locations}
        onChange={setLocations}
        libraryCategoryOptions={locationCategoryOptions}
        libraryTagOptions={locationTagOptions}
      />

      {/* Both weather controls sit on this tab with the locations they read: GPS
          + Weather appends to the list above and fills the Place name field, so
          the button and everything it writes to are on one screen. */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="secondary"
          onClick={handleGpsAndWeather}
          disabled={isLocatingAndFetching}
          title="Use this device's location to add a location and fetch its weather"
        >
          {isLocatingAndFetching ? "Locating…" : "GPS + Weather"}
        </Button>
        <Button size="sm" variant="secondary" onClick={handleFetchWeather} disabled={isFetchingWeather}>
          {isFetchingWeather ? "Fetching…" : "Fetch today's weather"}
        </Button>
        <span className="text-xs text-muted">Uses this entry&apos;s first location, or your default location.</span>
      </div>

      {/* The same reading, typeable. The buttons above fill these fields rather
          than writing somewhere the writer can't reach: an entry written up the
          next morning, or one from a place the forecast never covered, still had
          weather. Clearing the temperature clears the reading, matching the
          editor and the repository, where temp is what makes weather exist. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[6rem_6rem_1fr]">
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-muted">Temperature</span>
          <input
            type="text"
            inputMode="decimal"
            value={weatherTemp}
            onChange={(event) => setWeatherTemp(event.target.value)}
            placeholder="18"
            className={INPUT_CLASS}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-muted">Unit</span>
          <input
            type="text"
            value={weatherUnit}
            onChange={(event) => setWeatherUnit(event.target.value)}
            placeholder="°C"
            className={INPUT_CLASS}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-muted">Description</span>
          <input
            type="text"
            value={weatherDescription}
            onChange={(event) => setWeatherDescription(event.target.value)}
            placeholder="Light rain"
            className={INPUT_CLASS}
          />
        </label>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Write a new entry. Pick categories and tags from the dropdowns, or type a new one to create it.
      </p>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Above the fields, because it acts on all of them. Hidden entirely when
          no template is enabled, rather than shown empty — a dropdown with
          nothing in it is a dead control. Full width on a phone, and it stays
          full width on desktop too: it is a header for the grid below, not a
          member of it. */}
      {prefillTemplates.length > 0 && (
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Select prefill template</span>
          <select
            value={templateId}
            onChange={(event) => handleApplyTemplate(event.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">Start from a template…</option>
            {prefillTemplates.map((template) => (
              <option key={template.id} value={String(template.id)}>
                {template.name}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-muted">
            Fills the fields you have left blank. Anything you have already typed is kept.
          </span>
        </label>
      )}

      {/* Two tabs, and the form state that feeds them stays up here rather than
          inside either panel. `Tabs` unmounts the panel it isn't showing, so a
          Misc field owned by the Misc panel would lose what was typed into it
          the moment the writer flipped back to Main. */}
      <Tabs
        items={[
          { key: "main", label: "Main", content: mainTab },
          { key: "misc", label: "Misc", content: miscTab },
        ]}
      />

      {/* Outside the tab strip on purpose: a Save button that disappears on one
          of two tabs is a trap, and the error line above has to stay readable
          from Main even when a Misc action raised it. */}
      <div className="flex flex-wrap gap-2">
        {/* Sits before Save because it modifies what Save does. It is a toggle,
            not an action: nothing is locked until the entry is saved. Icon only,
            so the state has to carry entirely in the glyph and the fill —
            `primary` (filled brass) when it will save locked, `secondary` when
            it won't, on top of the open/closed shackle. `title` and `ariaLabel`
            both spell the outcome out, since there is no visible text, and
            `aria-pressed` is what makes a screen reader announce it as a
            two-state control rather than a button that locks something now.

            Hidden on the merge dialog (`saveLabel` set) for the same reason the
            encrypt button is: that flow saves one assembled entry and has its
            own controls, and locking it there would block the edit it exists to
            allow. Same row as Save/Clear, so on a phone it wraps with them —
            no layout of its own. */}
        {saveLabel === undefined && (
          <Button
            variant={saveLocked ? "primary" : "secondary"}
            onClick={() => setSaveLocked((current) => !current)}
            disabled={isBusy}
            ariaPressed={saveLocked}
            title={
              saveLocked
                ? "Will save locked — click to save unlocked instead."
                : "Will save unlocked — click to save this entry locked."
            }
            ariaLabel={saveLocked ? "Save this entry locked" : "Save this entry unlocked"}
          >
            {saveLocked ? (
              <LockClosedIcon className="h-5 w-5" />
            ) : (
              <LockOpenIcon className="h-5 w-5" />
            )}
          </Button>
        )}
        {/* The pin, beside the lock and on exactly the same rule: it modifies what
            Save does rather than acting now, so it is a toggle in this row and not a
            write. Same `Button` shell as the lock — `primary` when it will save
            pinned, `secondary` when it won't — rather than the bare icon button the
            edit form uses on its card title, because here it has to sit on the
            baseline with Save and Clear and wrap with them on a phone.

            Shown on the merge dialog too, unlike the lock and encrypt buttons: those
            two are hidden there because locking blocks the edit the dialog exists to
            allow and encrypting has no undo, whereas pinning a merged entry is just a
            pin, and the entry it writes is as pin-able as any other. */}
        <Button
          variant={savePinned ? "primary" : "secondary"}
          onClick={() => setSavePinned((current) => !current)}
          disabled={isBusy}
          ariaPressed={savePinned}
          title={
            savePinned
              ? "Will save pinned — click to save unpinned instead."
              : "Will save unpinned — click to save this entry pinned."
          }
          ariaLabel={savePinned ? "Save this entry pinned" : "Save this entry unpinned"}
        >
          <TreeIcon name={savePinned ? "pushpin-filled" : "pushpin"} className="h-5 w-5" />
        </Button>
        <Button onClick={handleSave} disabled={isBusy || form.date === ""}>
          {isBusy ? "Saving…" : (saveLabel ?? "Save entry")}
        </Button>
        {/* Migration 0131. A second save, not a toggle beside the first: which
            button you press is the decision, and a checkbox that silently makes
            Save mean something irreversible is exactly the wrong shape for a
            choice with no undo. Offered only on a genuinely new entry -- a
            caller that passes `saveLabel` (Review Data's merge dialog) has its
            own one-entry flow, and that entry can be encrypted afterwards from
            its own page like any other.

            Icon only, like the lock toggle, so the row stays a row of controls
            rather than a wall of sentences — but it opens the confirm dialog
            rather than acting, so nothing irreversible happens on a misread
            glyph. The `Comments` explainer immediately after it is what carries
            the words now that the button doesn't. */}
        {saveLabel === undefined && (
          <Button
            variant="secondary"
            onClick={() => {
              setError(undefined);
              setIsEncryptPromptOpen(true);
            }}
            disabled={isBusy || form.date === ""}
            title="Save entry encrypted"
            ariaLabel="Save entry encrypted"
          >
            <KeyIcon className="h-5 w-5" />
          </Button>
        )}
        {/* The explanation, reachable without opening the dialog -- someone
            deciding whether to encrypt at all should not have to start the
            irreversible flow to read what it does. Same prose the dialog shows. */}
        {saveLabel === undefined && (
          <span className="flex items-center">
            <Comments
              title={ENTRY_ENCRYPTION_EXPLAINER_TITLE}
              content={<EntryEncryptionExplainer />}
              size="md"
            />
          </span>
        )}
        <Button variant="secondary" onClick={reset} disabled={isBusy}>
          Clear
        </Button>
      </div>

      {/* The same dialog the entry page uses to encrypt an existing entry, so
          the warning wording and the confirm-password rule are identical in both
          places rather than written twice. */}
      {isEncryptPromptOpen && (
        <EncryptionPrompt
          asModal
          mode="encrypt"
          heading="Save this entry encrypted"
          actionLabel="Save encrypted"
          error={error}
          isBusy={isBusy}
          onSubmit={handleSaveEncrypted}
          onCancel={() => {
            setIsEncryptPromptOpen(false);
            setError(undefined);
          }}
        />
      )}

      {/* Mounted only while fullscreen, per FullscreenStage's contract: it
          requests fullscreen on mount and reports every way out — Escape, the
          browser's own control, a rejected request — through `onExit`. The
          textarea below is a second element bound to the same state, so what is
          typed here is already in the form when the stage closes. */}
      {isFullscreen && (
        <FullscreenStage onExit={() => setIsFullscreen(false)} label="Journal entry content">
          {/* A sheet centred on the black stage rather than edge-to-edge text: a
              full-width line on a 27" monitor is unreadable.
              `.paper-texture` is only the fibre overlay — it carries no tint of
              its own (design.md), so on the stage's black it needs
              `bg-paper-raised` under it to read as a sheet at all. The card on
              the page gets that surface for free; here it has to be asked for. */}
          {/* `bg-paper-raised` in both modes, not just under the texture: the
              stage is black but `--ink` follows the theme, so a light theme's
              dark ink directly on black would be unreadable. The sheet gives the
              text the same surface it has on the page. */}
          {/* The same two preferences as the in-card field, from the same
              resolved values — so the sheet a writer sees here is the one they
              configured, and the two copies can't drift. `relative` anchors the
              texture underlay; `bg-paper-raised` stays underneath it either
              way, for the reason above. */}
          <div
            className={`relative h-full w-full max-w-4xl overflow-hidden rounded-lg bg-paper-raised p-8 ${
              !contentTexture && isHandwriting ? "paper-texture" : ""
            }`}
          >
            {contentTextureLayer("rounded-lg")}
            <textarea
              value={form.content}
              onChange={(event) => update("content", event.target.value)}
              placeholder="What happened today…"
              autoFocus
              aria-label="Content"
              style={contentTextStyle}
              className={`relative h-full w-full resize-none border-0 bg-transparent p-4 text-ink focus-visible:outline-none ${
                isHandwriting ? cursiveClass : plainFullscreenSizeClass
              }`}
            />
          </div>
        </FullscreenStage>
      )}
    </div>
  );
}
