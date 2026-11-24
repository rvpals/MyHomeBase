"use client";

// The one Journal entry form, for writing a new entry and for editing an existing
// one. Replaces `JournalEntryForm` (new) and `JournalEntryEditForm` (edit), which
// had drifted into two different layouts for the same fields.
//
// Layout (mock: docs/mocks/journal-entry-mock.html):
//
//   header      Edit: "Edit entry", date · #id, Pin.
//               New:  Lock, Pin, Encrypt (+ explainer) — toggles over the save.
//   Main        [New: prefill template] Date, Time, Title, Categories, Tags, Content
//   Location &  Weather (fetch buttons + typed reading), Place name, location
//   Weather     picker (list, search, library, map)
//   Misc        Edit: clips (attach/detach immediately) and read-only entry details.
//               New:  empty — there is no entry yet for any of it to describe.
//   strip       Save, Close, [New: Clear]. Sticky to the bottom of the screen.
//
// All form state lives here, above the tabs: `Tabs` unmounts the panel it isn't
// showing, so a field owned by a panel would lose its value on a tab switch.

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { Comments } from "@/components/comments";
import { EncryptionPrompt } from "@/components/encryption-prompt";
import {
  ENTRY_ENCRYPTION_EXPLAINER_TITLE,
  EntryEncryptionExplainer,
} from "@/components/entry-encryption-explainer";
import { FullscreenStage, canGoFullscreen } from "@/components/fullscreen-stage";
import { IconSelect, type IconSelectOption } from "@/components/icon-select";
import { Modal } from "@/components/modal";
import { SlotIcon } from "@/components/slot-icon";
import { Tabs } from "@/components/tabs";
import { TokenPicker } from "@/components/token-picker";
import { TreeIcon } from "@/components/tree-icons";
import { useCurrentPosition } from "@/components/use-current-position";
import type { ClipSummary } from "@/lib/clips";
import type { DashboardTextureItem } from "@/lib/dashboard-texture";
import { getIconSlot } from "@/lib/icons";
import {
  applyPrefillTemplate,
  applyTaxonomyCombo,
  describeTaxonomyCombo,
  searchTaxonomyCombos,
  contentFontFamily,
  contentSizeClass,
  handwritingSizeClass,
  nextContentSizeUp,
  resolveJournalContentTexture,
  type JournalEntry,
  type JournalHandwritingSize,
  type JournalPreferences,
  type JournalPrefillFormValues,
  type JournalPrefillTemplate,
  type JournalTaxonomyCombo,
} from "@/lib/journal";
import {
  createEncryptedJournalEntryAction,
  createJournalEntryAction,
  fetchWeatherAction,
  reverseGeocodeAction,
  updateEncryptedJournalEntryAction,
  updateJournalEntryAction,
  type EntryWeatherInput,
  type JournalLocationInput,
} from "./journal-actions";
import { JournalEntryClipsField } from "./journal-entry-clips-field";
import { JournalLocationPicker } from "./journal-location-picker";
import { journalPrefillTemplateIconUrl } from "./journal-shared";

// ---------------------------------------------------------------------------
// Glyphs for the New-mode header toggles. Inline stroked SVGs so they follow the
// theme's ink. Closed and open differ only in the shackle, so state never rides
// on colour alone. The key is deliberately not a third padlock: encrypting is
// irreversible and must not read as a stronger lock.

function LockClosedIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function LockOpenIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 7.5-1.9" />
    </svg>
  );
}

function KeyIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="8" cy="8" r="4.5" />
      <path d="M11.2 11.2L20 20M17 17l-2 2M14 14l-2 2" />
    </svg>
  );
}

// ---------------------------------------------------------------------------

// Every field's shape except its size, so a field that sets its own size never
// carries two conflicting `text-*` classes (Tailwind v4 orders those by the
// stylesheet, not the attribute).
const INPUT_BASE_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";
const INPUT_CLASS = `${INPUT_BASE_CLASS} text-sm`;

const pad2 = (value: number) => String(value).padStart(2, "0");

/** Local calendar date as YYYY-MM-DD (not UTC), so the default matches the writer's day. */
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** Local wall-clock time as HH:MM:SS — the Time field's double-click stamp. */
function nowIso(): string {
  const now = new Date();
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
}

// `font-script-journal`, not `font-script`: the journal's hand is its own setting
// (migration 0137). The size is the module's `handwritingSize` preference.
function handwritingClass(size: JournalHandwritingSize): string {
  return `font-script-journal leading-relaxed ${handwritingSizeClass(size)}`;
}

/**
 * Splits a prefill template's delimited text into names. Templates still store
 * "FAMILY, PERSONAL" as one string, so it has to be broken up into chips.
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

interface FormFields {
  date: string;
  time: string;
  title: string;
  placeName: string;
  categories: string[];
  tags: string[];
  content: string;
}

const emptyForm = (date: string): FormFields => ({
  date,
  time: "",
  title: "",
  placeName: "",
  categories: [],
  tags: [],
  content: "",
});

/**
 * Values a caller can seed a **new** entry with — Review Data's Merge, Clone, and
 * the Calendar's "New entry on this day". Every field is optional; anything
 * omitted falls back to a blank form.
 */
export interface JournalEntryInitialValues {
  date?: string;
  time?: string;
  title?: string;
  content?: string;
  placeName?: string;
  categories?: string[];
  tags?: string[];
}

/**
 * Applies `initialValues` over a blank form.
 *
 * `stamp` decides whether the clock is read for the date. False during render
 * (server and hydrating client must agree — a mismatched `<input type="date">`
 * shows nothing), true from the post-mount effect and from Clear. The time is
 * never stamped: an untimed entry is legitimate, and double-click sets it.
 */
function seededForm(initialValues: JournalEntryInitialValues | undefined, stamp: boolean): FormFields {
  const blank = emptyForm(stamp ? todayIso() : "");
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

function formFromEntry(entry: JournalEntry): FormFields {
  return {
    date: entry.date,
    time: entry.time,
    title: entry.title,
    placeName: entry.placeName,
    categories: entry.categories,
    tags: entry.tags,
    content: entry.content,
  };
}

function locationsFromEntry(entry: JournalEntry): JournalLocationInput[] {
  return entry.locations.map((location) => ({
    latitude: location.latitude,
    longitude: location.longitude,
    locationName: location.locationName,
    // Carried through because `updateEntry` rewrites the whole aggregate: an
    // edit that did not resubmit these would silently clear them (0151).
    streetAddress: location.streetAddress,
    savedLocationId: location.savedLocationId,
  }));
}

// The two field groups' icons. Module scope because the registry is static —
// `getIconSlot` is a lookup in a constant array, not I/O. One slot each covers
// both editors, since New and Edit are this same component.
const DATE_TIME_SLOT = getIconSlot("journal_group_date_time")!;
const CATEGORIES_TAGS_SLOT = getIconSlot("journal_group_categories_tags")!;

/**
 * The combo picker: a searchable list of saved combos, opened by the Categories
 * & Tags group's button.
 *
 * A `Modal` rather than a dropdown because a combo needs two lines to describe
 * (its name and what it holds) and the list wants a search box — which is why the
 * filtering rule is `searchTaxonomyCombos` in lib and not a `.includes` here: it
 * matches member names too, and the CLI applies the same rule.
 */
function ComboPicker({
  combos,
  onPick,
  onClose,
}: {
  combos: JournalTaxonomyCombo[];
  onPick: (combo: JournalTaxonomyCombo) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const matches = searchTaxonomyCombos(combos, query);

  return (
    <Modal
      title="Prefill Category/Tags Combo"
      description="Picking one replaces this entry's categories and tags with the combo's selection."
      onClose={onClose}
      size="sm"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="block text-sm">
          <span className="sr-only">Search the combos</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, description, category or tag…"
            className={INPUT_CLASS}
            autoFocus
          />
        </label>

        {matches.length === 0 ? (
          <p className="text-sm text-muted">
            {combos.length === 0 ? "No combos saved yet." : "No combo matches that."}
          </p>
        ) : (
          // Capped height so a long list scrolls inside the dialog rather than
          // pushing Cancel off a phone screen.
          <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
            {matches.map((combo) => (
              <li key={combo.id}>
                <button
                  type="button"
                  onClick={() => onPick(combo)}
                  className="w-full rounded-lg border border-line p-3 text-left transition-colors hover:bg-brass-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                >
                  <span className="block font-medium text-ink">{combo.name}</span>
                  {combo.description !== "" && (
                    <span className="mt-0.5 block text-sm text-muted">{combo.description}</span>
                  )}
                  <span className="mt-1 block text-xs text-muted">
                    {describeTaxonomyCombo(combo)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/** How the Misc tab names an entry's `source`. */
function sourceLabel(source: string): string {
  if (source === "") return "Written by hand";
  if (source === "ics") return "Calendar import (.ics)";
  if (source === "csv") return "CSV import";
  return source;
}

// ---------------------------------------------------------------------------

interface CommonProps {
  categoryOptions: string[];
  tagOptions: string[];
  /**
   * Saved taxonomy combos, for the Categories & Tags group's **Prefill
   * Category/Tags Combo** button (migration 0177).
   *
   * On `CommonProps` rather than on the New-mode props, unlike
   * `prefillTemplates`: a combo's whole reason to exist is that it also works on
   * an entry written months ago, where there is no template to start from.
   * Optional and defaulting to `[]`, so the button simply doesn't render for a
   * caller that hasn't got the list (the merge draft, which is a dialog over a
   * screen that never read it).
   */
  taxonomyCombos?: JournalTaxonomyCombo[];
  preferences: JournalPreferences;
  /** The app texture library, so the Content field's chosen picture resolves. */
  contentTextures?: DashboardTextureItem[];
  /** The location library's taxonomy, for the location picker's library tab. */
  locationCategoryOptions?: string[];
  locationTagOptions?: string[];
  /** Close was pressed (after confirming, if there were unsaved changes). */
  onClose: () => void;
  /**
   * Rendered inside a `Modal` (the merge draft, Review Data). The strip then
   * sticks to the bottom of the dialog's scroller instead of clearing the
   * page's bottom bar and music player, which the dialog already covers.
   */
  inDialog?: boolean;
}

export interface JournalEntryEditorNewProps extends CommonProps {
  mode: "new";
  /** Enabled templates only — the server filters. */
  prefillTemplates?: JournalPrefillTemplate[];
  initialValues?: JournalEntryInitialValues;
  /** Starting pins (Clone). Separate from `initialValues`: not a typed field. */
  initialLocations?: JournalLocationInput[];
  /**
   * Called after a successful save. Without it the form clears for the next
   * entry, which is what the New Entry screen wants.
   */
  onSaved?: () => void;
  /** Raised true/false around a save, so a wrapping dialog can show a busy state. */
  onSavingChange?: (isSaving: boolean) => void;
  /** Overrides the Save label — "Save merged entry". */
  saveLabel?: string;
  /**
   * Offer Lock and Encrypt in the header. Default true. The merge draft turns
   * them off: locking would block the edit it exists for, and encrypting has no
   * undo. The merged entry can be locked or encrypted from its own page.
   */
  allowSealing?: boolean;
}

export interface JournalEntryEditorEditProps extends CommonProps {
  mode: "edit";
  entry: JournalEntry;
  /**
   * The unlock password when `entry` is encrypted and unlocked. The save is
   * refused without it rather than writing plaintext over ciphertext.
   */
  encryptionPassword?: string;
  onSaved: () => void;
}

export type JournalEntryEditorProps = JournalEntryEditorNewProps | JournalEntryEditorEditProps;

export function JournalEntryEditor(props: JournalEntryEditorProps) {
  const {
    categoryOptions,
    tagOptions,
    taxonomyCombos = [],
    preferences,
    contentTextures = [],
    locationCategoryOptions = [],
    locationTagOptions = [],
    onClose,
    inDialog = false,
  } = props;
  const isEdit = props.mode === "edit";
  const entry = isEdit ? props.entry : undefined;
  const newProps = props.mode === "new" ? props : undefined;
  const prefillTemplates = newProps?.prefillTemplates ?? [];
  const allowSealing = newProps ? (newProps.allowSealing ?? true) : false;

  const router = useRouter();

  // New: the date starts blank and the effect below stamps the writer's clock
  // after mount, so server and client HTML agree. Edit: the entry's own values.
  const [form, setForm] = useState<FormFields>(() =>
    entry ? formFromEntry(entry) : seededForm(newProps?.initialValues, false),
  );
  const [locations, setLocations] = useState<JournalLocationInput[]>(() =>
    entry ? locationsFromEntry(entry) : [...(newProps?.initialLocations ?? [])],
  );
  // Held as three strings because a half-typed temperature ("-", "1.") is not a
  // number yet. Folded back into a reading on save; the fetch buttons write
  // through the same fields so a fetched reading can be corrected by hand.
  const [weatherTemp, setWeatherTemp] = useState(entry?.weather ? String(entry.weather.temp) : "");
  const [weatherUnit, setWeatherUnit] = useState(entry?.weather?.unit ?? "");
  const [weatherDescription, setWeatherDescription] = useState(entry?.weather?.description ?? "");
  const [isPinned, setIsPinned] = useState(entry?.isPinned ?? false);
  // New only: whether Save writes the entry already locked. A choice about the
  // save that hasn't happened yet, not a lock applied now.
  const [saveLocked, setSaveLocked] = useState(false);
  // Edit only: attached clips. Not part of Save — the field links and unlinks
  // immediately, so Close does not undo it.
  const [clips, setClips] = useState<ClipSummary[]>([]);

  const [activeTab, setActiveTab] = useState("main");
  const [templateId, setTemplateId] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);
  const [isFetchingWeather, setIsFetchingWeather] = useState(false);
  const [isLocatingAndFetching, setIsLocatingAndFetching] = useState(false);
  const [isComboPickerOpen, setIsComboPickerOpen] = useState(false);
  const [isEncryptPromptOpen, setIsEncryptPromptOpen] = useState(false);
  const [isConfirmingClose, setIsConfirmingClose] = useState(false);
  // Transient view state for this sitting, not stored preferences.
  const [isHandwriting, setIsHandwriting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Resolved after mount: `canGoFullscreen` reads `document`, and rendering the
  // button on one side only is a hydration mismatch.
  const [canFullscreen, setCanFullscreen] = useState(false);
  const { request: requestPosition } = useCurrentPosition();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only data unknowable during render; runs once on mount.
    setCanFullscreen(canGoFullscreen());
  }, []);

  // New: stamp the blank date with the writer's clock once, after mount — only
  // if nothing seeded or typed it first.
  useEffect(() => {
    if (isEdit) return;
    setForm((current) => (current.date !== "" ? current : { ...current, date: todayIso() }));
  }, [isEdit]);

  // --- unsaved-changes tracking ------------------------------------------------
  // Everything Save would write, as one comparable string. Clips are left out:
  // they are written the moment they change, so there is nothing to lose.
  const snapshot = JSON.stringify([
    form,
    locations,
    weatherTemp,
    weatherUnit,
    weatherDescription,
    isPinned,
    saveLocked,
  ]);
  // The snapshot as it stood once the form was ready — after the date stamp on a
  // new entry, which would otherwise count as an edit the writer never made.
  const [baseline, setBaseline] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (baseline !== undefined || form.date === "") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- records the post-stamp starting point once; guarded so it cannot loop.
    setBaseline(snapshot);
  }, [baseline, form.date, snapshot]);
  const isDirty = baseline !== undefined && snapshot !== baseline;

  function handleClose() {
    if (isDirty) {
      setIsConfirmingClose(true);
      return;
    }
    onClose();
  }

  // --- field helpers -----------------------------------------------------------
  type TextField = Exclude<keyof FormFields, "categories" | "tags">;

  function update(field: TextField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function setTaxonomy(field: "categories" | "tags", names: string[]) {
    setForm((current) => ({ ...current, [field]: names }));
  }

  /**
   * New only. Back to the starting values — the seed, if there was one, so on a
   * clone or merge draft "Clear" means "undo my edits", not "wipe the proposal".
   * Re-reads the clock, so the next entry of a sitting is stamped when written.
   */
  function reset() {
    const fresh = seededForm(newProps?.initialValues, true);
    setForm(fresh);
    setLocations([...(newProps?.initialLocations ?? [])]);
    setWeatherTemp("");
    setWeatherUnit("");
    setWeatherDescription("");
    setTemplateId("");
    setIsHandwriting(false);
    // Per-entry choices: a toggle left on would quietly lock or pin every entry
    // of the sitting.
    setSaveLocked(false);
    setIsPinned(false);
    setError(undefined);
    setBaseline(undefined);
  }

  // Fills the blank fields from a template. The merge itself is lib's
  // `applyPrefillTemplate`; `new Date()` here is deliberate — an entry's date is
  // the writer's calendar day (migration 0062).
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

  /**
   * The template picker's options, with each template's uploaded icon
   * (migration 0176). Built here rather than on the server because the URL is a
   * pure function of two fields the template already carries.
   */
  const templateOptions: IconSelectOption[] = prefillTemplates.map((template) => ({
    value: String(template.id),
    label: template.name,
    iconUrl: journalPrefillTemplateIconUrl(template),
  }));

  /**
   * Replaces both taxonomy fields with a combo's selection (migration 0177).
   *
   * The replace itself is lib's `applyTaxonomyCombo`; the **confirmation** is
   * here, because it is presentation. It is asked only when there is something to
   * lose — applying a combo to an untagged entry throws nothing away, and a
   * confirm on every pick would train the reader to dismiss the one that matters.
   */
  function handlePickCombo(combo: JournalTaxonomyCombo) {
    const hasExisting = form.categories.length > 0 || form.tags.length > 0;
    if (
      hasExisting &&
      !window.confirm(
        `Replace this entry's categories and tags with the combo "${combo.name}"?\n\n` +
          `${describeTaxonomyCombo(combo)}\n\nWhat is there now will be discarded.`,
      )
    ) {
      return;
    }
    const selection = applyTaxonomyCombo(combo);
    setForm((current) => ({
      ...current,
      categories: selection.categories,
      tags: selection.tags,
    }));
    setIsComboPickerOpen(false);
  }

  // --- weather -------------------------------------------------------------------

  // For the first location if there is one, otherwise the default location.
  async function handleFetchWeather() {
    const source = locations[0] ?? preferences.defaultLocation;
    if (!source) {
      setError("Add a location on this tab, or set a default location in Preferences, to fetch weather.");
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

  // One press: read GPS, name the point, append it to the locations, fetch its
  // weather. Each stage keeps what the earlier ones produced.
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

      // Fill Place name only while it is still empty — never overwrite typing.
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

  // The temperature is the anchor (as in the repository): empty means no
  // weather, non-numeric is refused on save rather than silently dropped.
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
          // The WMO code survives only while this is still exactly the reading
          // that was stored; typed-over weather goes back to 0 (no chip).
          code:
            entry?.weather &&
            parsedTemp === entry.weather.temp &&
            weatherUnit.trim() === entry.weather.unit &&
            weatherDescription.trim() === entry.weather.description
              ? entry.weather.code
              : 0,
        };

  // --- save --------------------------------------------------------------------

  function setSaving(saving: boolean) {
    setIsBusy(saving);
    newProps?.onSavingChange?.(saving);
  }

  /** After a successful new-entry save: the caller's handler, or clear for the next. */
  function finishNewSave() {
    if (newProps?.onSaved) newProps.onSaved();
    else reset();
    router.refresh();
  }

  async function handleSave() {
    if (!isTempValid) {
      setError("Temperature must be a number, or empty to record no weather.");
      setActiveTab("location");
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      if (entry) {
        // An encrypted entry saves in two parts: the text (needs the password)
        // first, so a wrong password leaves the entry untouched, then the
        // metadata through the ordinary path, which carries the ciphertext over.
        if (entry.isEncrypted) {
          const password = props.mode === "edit" ? props.encryptionPassword : undefined;
          if (password === undefined) {
            setError("This entry is locked. Unlock it before saving.");
            return;
          }
          const encryptedResult = await updateEncryptedJournalEntryAction(entry.id, password, {
            title: form.title,
            content: form.content,
          });
          if (!encryptedResult.ok) {
            setError(encryptedResult.error);
            return;
          }
        }
        const result = await updateJournalEntryAction(entry.id, {
          ...form,
          locations,
          weather: typedWeather,
          isPinned,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setBaseline(snapshot);
        if (props.mode === "edit") props.onSaved();
        return;
      }

      const result = await createJournalEntryAction({
        ...form,
        locations,
        weather: typedWeather,
        isLocked: saveLocked,
        isPinned,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      finishNewSave();
    } finally {
      setSaving(false);
    }
  }

  /**
   * New only — saves the draft already sealed. One action, not save-then-encrypt:
   * two calls would put the plaintext on disk in between. On failure the dialog
   * stays open so the typed password isn't lost.
   */
  async function handleSaveEncrypted(password: string, hint: string) {
    if (!isTempValid) {
      setError("Temperature must be a number, or empty to record no weather.");
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const result = await createEncryptedJournalEntryAction(
        { ...form, locations, weather: typedWeather, isPinned },
        password,
        hint,
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setIsEncryptPromptOpen(false);
      finishNewSave();
    } finally {
      setSaving(false);
    }
  }

  // --- content field appearance --------------------------------------------------
  // Resolved once for both copies of the field (in the tab and on the fullscreen
  // stage) so they can't drift.
  const cursiveClass = handwritingClass(preferences.handwritingSize);
  const contentTexture = resolveJournalContentTexture(
    preferences.contentTextureId,
    contentTextures,
    preferences.contentTextureOpacity,
  );
  // The picture sits on an underlay so its opacity fades the picture, not the text.
  const contentTextureLayer = (radiusClass: string) =>
    contentTexture ? (
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-0 bg-center ${radiusClass}`}
        style={{
          backgroundImage: contentTexture.backgroundImage,
          backgroundSize: contentTexture.mode === "tile" ? "auto" : "cover",
          backgroundRepeat: contentTexture.mode === "tile" ? "repeat" : "no-repeat",
          opacity: contentTexture.opacity,
        }}
      />
    ) : undefined;
  const contentFamily = contentFontFamily(preferences.contentFont);
  const contentTextStyle: CSSProperties | undefined =
    preferences.contentTextColor || contentFamily
      ? {
          ...(preferences.contentTextColor ? { color: preferences.contentTextColor } : {}),
          ...(contentFamily ? { fontFamily: contentFamily } : {}),
        }
      : undefined;
  const plainSizeClass = contentSizeClass(preferences.contentFontSize);
  // The fullscreen sheet stays one size step up from the in-tab field.
  const plainFullscreenSizeClass = contentSizeClass(nextContentSizeUp(preferences.contentFontSize));

  // --- tabs ----------------------------------------------------------------------

  const mainTab = (
    <div className="flex flex-col gap-4">
      {/* New only, and only when a template is enabled. Collapsed: starting
          from a template is the exception and shouldn't push Date down. */}
      {!isEdit && prefillTemplates.length > 0 && (
        <CollapsibleCard title="Prefill Template">
          <div className="text-sm">
            <span className="mb-1 block font-medium text-ink">Select prefill template</span>
            {/* IconSelect, not a native <select>: a template can carry an icon
                (migration 0176) and neither <select> nor <datalist> can render an
                image in an option. Strict (`allowFreeText={false}`) so it stays a
                picker — a typed template name means nothing here. */}
            <IconSelect
              options={templateOptions}
              value={templateId}
              onChange={handleApplyTemplate}
              allowFreeText={false}
              clearLabel="Start from a template…"
              placeholder="Start from a template…"
              ariaLabel="Select prefill template"
            />
            <span className="mt-1 block text-xs text-muted">
              Fills the fields you have left blank. Anything you have already typed is kept.
            </span>
          </div>
        </CollapsibleCard>
      )}

      {/* The when. Grouped so the pair reads as one fact about the entry rather
          than as two of six loose fields. Collapsing it is safe: the form state
          lives above these cards, so a collapsed group still saves the date the
          mount effect stamped. */}
      <CollapsibleCard
        title="Date/Time"
        titleIcon={<SlotIcon slot={DATE_TIME_SLOT} className="h-4 w-4" />}
        defaultOpen
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Date</span>
            <input type="date" value={form.date} onChange={(event) => update("date", event.target.value)} className={INPUT_CLASS} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Time</span>
            <input
              type="time"
              step={1}
              value={form.time}
              onChange={(event) => update("time", event.target.value)}
              onDoubleClick={() => update("time", nowIso())}
              title="Double-click to set the current time"
              className={INPUT_CLASS}
            />
            <span className="mt-1 block text-xs text-muted">
              Optional. Double-click to set the current time.
            </span>
          </label>
        </div>
      </CollapsibleCard>

      {/* Title sits between the two groups, ungrouped: it belongs to neither, and
          a one-field group box would be a frame around nothing. */}
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Title</span>
        <input type="text" value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="A short headline for the entry" className={INPUT_CLASS} />
      </label>

      <CollapsibleCard
        title="Categories & Tags"
        titleIcon={<SlotIcon slot={CATEGORIES_TAGS_SLOT} className="h-4 w-4" />}
        defaultOpen
      >
        <div className="flex flex-col gap-4">
          {/* First in the group, because picking a combo rewrites everything
              below it — a control that acts on the fields reads wrongly placed
              underneath them. Hidden when there are no combos: a button whose
              dialog is always empty is worse than no button. */}
          {taxonomyCombos.length > 0 && (
            <div>
              <Button size="sm" variant="secondary" onClick={() => setIsComboPickerOpen(true)}>
                Prefill Category/Tags Combo
              </Button>
              <span className="mt-1 block text-xs text-muted">
                Replaces both fields with a saved combo. Unlike a prefill template, this
                overwrites what is already there.
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        </div>
      </CollapsibleCard>

      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-ink">Content</span>
          <div className="flex shrink-0 items-center gap-1.5">
            {canFullscreen && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setIsFullscreen(true)}
                title="Show just the content box, filling the screen"
                ariaLabel="Show the content box full screen"
                className="!px-2 !py-1 !shadow-sm"
              >
                <TreeIcon name="window" className="h-4 w-4" />
              </Button>
            )}
            <Button
              size="sm"
              variant={isHandwriting ? "primary" : "secondary"}
              onClick={() => setIsHandwriting((on) => !on)}
              ariaPressed={isHandwriting}
              title={
                isHandwriting
                  ? "Writing in cursive — click for the plain font."
                  : "Writing in the plain font — click for cursive."
              }
              ariaLabel={isHandwriting ? "Turn handwriting off" : "Turn handwriting on"}
              className="!px-2 !py-1 !shadow-sm"
            >
              <TreeIcon name="new-journal" className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* A toggle over the same textarea, not a preview. A chosen picture
            replaces `.paper-texture` rather than stacking on it. */}
        <div
          className={`relative ${
            contentTexture
              ? "rounded-md border border-line"
              : isHandwriting
                ? "rounded-md border border-line paper-texture"
                : ""
          }`}
        >
          {contentTextureLayer("rounded-md")}
          <textarea
            value={form.content}
            onChange={(event) => update("content", event.target.value)}
            placeholder="What happened today…"
            aria-label="Content"
            rows={12}
            style={contentTextStyle}
            className={
              isHandwriting || contentTexture
                ? `relative w-full resize-y border-0 bg-transparent px-3 py-2 text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
                    isHandwriting ? cursiveClass : plainSizeClass
                  }`
                : `${INPUT_BASE_CLASS} resize-y ${plainSizeClass}`
            }
          />
        </div>
      </div>
    </div>
  );

  const locationTab = (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-3 rounded-xl border border-line bg-paper-raised p-4">
        <legend className="px-1 text-sm font-semibold text-ink">Weather</legend>
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
        {/* Three on one row on desktop; they stack on a phone, where narrow
            boxes side by side would be unusable. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[6rem_6rem_1fr]">
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted">Temperature</span>
            <input type="text" inputMode="decimal" value={weatherTemp} onChange={(event) => setWeatherTemp(event.target.value)} placeholder="18" className={INPUT_CLASS} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted">Unit</span>
            <input type="text" value={weatherUnit} onChange={(event) => setWeatherUnit(event.target.value)} placeholder="°C" className={INPUT_CLASS} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted">Description</span>
            <input type="text" value={weatherDescription} onChange={(event) => setWeatherDescription(event.target.value)} placeholder="Light rain" className={INPUT_CLASS} />
          </label>
        </div>
        <p className="text-xs text-muted">Clear the temperature to record no weather for this entry.</p>
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-xl border border-line bg-paper-raised p-4">
        <legend className="px-1 text-sm font-semibold text-ink">Locations</legend>
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
      </fieldset>
    </div>
  );

  // New: nothing — there is no entry yet for clips or details to belong to.
  const miscTab = entry ? (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-line bg-paper-raised p-4">
        {/* `entryId` given, so attach/detach take effect immediately — not part
            of Save, and Close does not undo them. */}
        <JournalEntryClipsField
          value={clips}
          onChange={setClips}
          entryId={entry.id}
          categoryOptions={categoryOptions}
          tagOptions={tagOptions}
        />
      </div>

      <div className="rounded-xl border border-line bg-paper-raised p-4">
        <h3 className="mb-3 text-sm font-semibold text-ink">Entry details</h3>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted">Entry ID</dt>
          <dd className="font-mono text-ink">{entry.id}</dd>
          <dt className="text-muted">Status</dt>
          <dd className="text-ink">
            {entry.isLocked ? "Locked" : "Not locked"} · {entry.isEncrypted ? "Encrypted" : "Not encrypted"}
          </dd>
          {entry.isEncrypted && entry.passwordHint !== "" && (
            <>
              <dt className="text-muted">Password hint</dt>
              <dd className="text-ink">{entry.passwordHint}</dd>
            </>
          )}
          <dt className="text-muted">Source</dt>
          <dd className="text-ink">{sourceLabel(entry.source)}</dd>
          <dt className="text-muted">External ID</dt>
          <dd className="break-all font-mono text-ink">{entry.externalId || "—"}</dd>
          <dt className="text-muted">Created</dt>
          <dd className="text-ink">{entry.createdAt}</dd>
          <dt className="text-muted">Last updated</dt>
          <dd className="text-ink">{entry.updatedAt}</dd>
        </dl>
      </div>
    </div>
  ) : (
    <div />
  );

  // --- render ----------------------------------------------------------------------

  // On a page the strip clears the compact section bar and the music player —
  // the heights `.app-main` pads for. Inside a dialog it sits at the bottom of
  // the dialog's own scroller, which those don't reach.
  const stripPosition = inDialog
    ? "bottom-0"
    : "bottom-[calc(var(--section-trigger-height)+var(--music-player-height,0px)+env(safe-area-inset-bottom))]";

  const pinToggle = (
    <Button
      variant={isPinned ? "primary" : "secondary"}
      onClick={() => setIsPinned((current) => !current)}
      disabled={isBusy}
      ariaPressed={isPinned}
      title={isPinned ? "Pinned — click to unpin." : "Not pinned — click to pin this entry."}
      ariaLabel={isPinned ? "Unpin this entry" : "Pin this entry"}
    >
      <TreeIcon name={isPinned ? "pushpin-filled" : "pushpin"} className="h-5 w-5" />
    </Button>
  );

  return (
    <div
      className={`flex flex-col gap-4 ${
        // Edit renders straight into the entry screen, so it brings its own card.
        // New sits inside the New Journal card (or a dialog) already.
        isEdit && !inDialog ? "rounded-xl border border-line bg-paper-raised p-6 max-lg:p-4" : ""
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        {entry ? (
          <div>
            <h2 className="font-display text-xl text-ink">Edit entry</h2>
            <p className="text-xs text-muted">
              {entry.date} · #{entry.id}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">
            Pick categories and tags from the dropdowns, or type a new one to create it.
          </p>
        )}

        {/* Entry-wide toggles. None acts now — each changes what Save writes —
            so they save with the form like every other field. */}
        <div className="flex items-center gap-2">
          {allowSealing && (
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
              {saveLocked ? <LockClosedIcon className="h-5 w-5" /> : <LockOpenIcon className="h-5 w-5" />}
            </Button>
          )}
          {pinToggle}
          {/* A second save, not a toggle: which button you press is the decision,
              and it opens a confirm dialog, so a misread glyph does nothing
              irreversible. The explainer beside it carries the words. */}
          {allowSealing && (
            <>
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
              <span className="flex items-center">
                <Comments title={ENTRY_ENCRYPTION_EXPLAINER_TITLE} content={<EntryEncryptionExplainer />} size="md" />
              </span>
            </>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <Tabs
        activeKey={activeTab}
        onActiveKeyChange={setActiveTab}
        items={[
          { key: "main", label: "Main", content: mainTab },
          { key: "location", label: "Location & Weather", content: locationTab },
          { key: "misc", label: "Misc", content: miscTab },
        ]}
      />

      {/* The strip. Outside the tabs so Save is reachable from every tab.
          `sticky`, not `fixed`: it stays in flow (never covers the last field)
          but pins to the bottom while the form is taller than the screen.
          `z-20` keeps it under shell chrome (z-30) and modals (z-50). */}
      <div
        className={`sticky ${stripPosition} z-20 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-paper-raised px-3 py-2 shadow-lg`}
      >
        <Button onClick={handleSave} disabled={isBusy || form.date === ""}>
          {isBusy ? "Saving…" : isEdit ? "Save changes" : (newProps?.saveLabel ?? "Save entry")}
        </Button>
        <Button variant="secondary" onClick={handleClose} disabled={isBusy}>
          Close
        </Button>
        {!isEdit && (
          <>
            <span aria-hidden className="mx-1 h-6 w-px bg-line max-sm:hidden" />
            {/* Last, and apart: it throws work away. */}
            <Button variant="secondary" onClick={reset} disabled={isBusy}>
              Clear
            </Button>
          </>
        )}
        {isDirty && <span className="ml-auto text-xs text-muted max-sm:hidden">Unsaved changes</span>}
      </div>

      {isComboPickerOpen && (
        <ComboPicker
          combos={taxonomyCombos}
          onPick={handlePickCombo}
          onClose={() => setIsComboPickerOpen(false)}
        />
      )}

      {isConfirmingClose && (
        <Modal
          title="Discard your changes?"
          description="You have changes that haven't been saved. Closing now throws them away."
          size="sm"
          onClose={() => setIsConfirmingClose(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setIsConfirmingClose(false)}>
                Keep editing
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setIsConfirmingClose(false);
                  onClose();
                }}
              >
                Discard
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink">Anything you attached or removed under Clips is already saved.</p>
        </Modal>
      )}

      {/* The same dialog the entry page uses to encrypt an existing entry, so
          the warning and the confirm-password rule are identical in both places. */}
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

      {/* Mounted only while fullscreen (FullscreenStage requests it on mount and
          reports every exit through `onExit`). Bound to the same state, so what
          is typed here is already in the form when the stage closes. */}
      {isFullscreen && (
        <FullscreenStage onExit={() => setIsFullscreen(false)} label="Journal entry content">
          {/* `bg-paper-raised` in both modes: the stage is black but `--ink`
              follows the theme, so a light theme's ink on black would vanish. */}
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
