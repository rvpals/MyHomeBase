"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { EncryptionPrompt } from "@/components/encryption-prompt";
import { JournalViewer } from "@/components/journal-viewer";
import { Modal } from "@/components/modal";
import type { DashboardTextureItem } from "@/lib/dashboard-texture";
import {
  ENCRYPTED_TITLE_PLACEHOLDER,
  formatCalendarDayHeading,
  type EntryLocation,
  type JournalEntry,
  type JournalEntryNeighbors,
  type JournalPreferences,
  type JournalTaxonomyCombo,
} from "@/lib/journal";
import {
  decryptJournalEntryAction,
  deleteJournalEntryAction,
  encryptJournalEntryAction,
  removeJournalEntryEncryptionAction,
  setEntryLockAction,
} from "./journal-actions";
import { journalEntriesFilterHref } from "./journal-shared";
// Clips, read here because `JournalViewer` is a shared component and may not
// fetch. `src/lib/journal` still knows nothing about clips — see migration 0155.
import { listClipsForEntryAction } from "./clips-actions";
import { EntryClipsDialog } from "./clips-entry-clips-dialog";
import { JournalDayExpenses } from "./journal-day-expenses";
import { JournalEntryEditor } from "./journal-entry-editor";
import { JournalPhotosCard } from "./journal-photos-card";

const JOURNAL_MODULE_PATH = "/modules/journal";

/**
 * Clicking a category or tag opens the Entries browser filtered to it — the same
 * `?filter=` link the Top Categories/Tags cards use, so both routes into a slice
 * produce one shareable URL rather than two.
 *
 * A name containing a comma can't be expressed in the query grammar (the comma
 * is its "any of" separator), and `journalEntriesFilterHref` degrades to an
 * *unfiltered* link for those. That's right for a card whose whole job is to
 * navigate, but wrong for a chip: a chip that silently shows every entry looks
 * like the filter worked. So those stay unclickable here.
 */
function taxonomyFilterHref(kind: "category" | "tag", name: string): string | undefined {
  return name.includes(",") ? undefined : journalEntriesFilterHref(kind, name);
}

// Leaflet touches `window`, so the map is client-only. Read-only here: no onPick.
const LocationMap = dynamic(
  () => import("@/components/location-map").then((module) => module.LocationMap),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-64 place-items-center rounded-md border border-line text-sm text-muted">
        Loading map…
      </div>
    ),
  },
);

/** Deep link to the same point on openstreetmap.org, for directions or a bigger view. */
function openStreetMapUrl(location: EntryLocation): string {
  const { latitude, longitude } = location;
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=15/${latitude}/${longitude}`;
}

/**
 * Deep link to the same point on Google Maps. Uses the documented Maps URLs
 * form, which takes a plain coordinate query and needs no API key (unlike the
 * embedded JavaScript map, which is why the in-page map stays OpenStreetMap).
 */
function googleMapsUrl(location: EntryLocation): string {
  const { latitude, longitude } = location;
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

/**
 * Which map the panel below the viewer is showing: one chosen pin, or every
 * location on the entry at once. A single piece of state rather than two, so
 * the two modes can't both be open.
 */
type MapView = { kind: "one"; location: EntryLocation } | { kind: "all" };

/**
 * **The** full journal entry — the viewer, its whole toolbar, and the edit form
 * behind it. Shared by every screen that opens one.
 *
 * Wires `JournalViewer`'s events to the journal's server actions: Edit, Clone,
 * Lock, Encrypt / Remove encryption, Print, the maps, the clips dialog, the
 * photos card and Delete. `JournalViewer` itself stays a registered shared
 * component and stays read-only — it renders an entry and raises events, and a
 * screen that only needs to *show* one (a recycled entry, which has no live row
 * to edit) still uses it directly.
 *
 * It exists as one component because three screens had begun growing their own.
 * Data Management → Review Data had a hand-written viewer/editor toggle with no
 * encryption, lock, clone, delete, maps, clips or photos; the Duplicates card
 * and the Calendar's Today in history dialog were read-only with no way to fix
 * the entry you had just gone looking for. **If you are about to add a button
 * for one caller only, add a prop, not a second adapter.**
 *
 * Route-local, and deliberately not in `src/components/`: it imports the server
 * actions in ./journal-actions and ./clips-actions, which the components
 * registry forbids. Same shape and same reason as journal-entries-grid.tsx —
 * see "The route-local entries" in components.md.
 */
export function JournalEntryFullViewer({
  mode = "page",
  onClose,
  onSaved,
  entry,
  neighbors = {},
  categoryIcons,
  tagIcons,
  categoryOptions,
  tagOptions,
  taxonomyCombos = [],
  locationCategoryOptions = [],
  locationTagOptions = [],
  canSeeExpense = false,
  preferences,
  contentTextures = [],
}: {
  /**
   * How this viewer is being shown.
   *
   * `"page"` is the entry's own route: it renders bare and the page around it
   * supplies the layout. `"modal"` wraps itself in a `Modal` over whatever
   * screen opened it — the Duplicates card, Review Data, the Calendar's Today in
   * history dialog — so the reader keeps the list they were working through.
   *
   * Three things differ, and nothing else does. See `isModal` below for each.
   */
  mode?: "page" | "modal";
  /** Required by `mode="modal"`: dismiss the dialog. Ignored on a page. */
  onClose?: () => void;
  /**
   * An edit was saved. Replaces this component's own `router.refresh()`.
   *
   * It exists because a modal caller's list is usually **client state**, which a
   * server refresh does not touch: Review Data holds its groups from a client
   * action, the Duplicates card seeds its rows from props once, and the Today in
   * history dialog fetched its own. An edit can change an entry's date and move
   * it between groups — or out of the list — so each of those has to re-ask its
   * own question rather than trust a re-render.
   *
   * The caller is handed the id and owns everything after: re-reading its rows,
   * swapping the entry shown, or closing. Leave it off and a plain
   * `router.refresh()` happens, which is right for the entry's own page.
   */
  onSaved?: (entryId: number) => void;
  /** The Journal's preferences — the editor's content font, handwriting and weather units. */
  preferences: JournalPreferences;
  /** The app texture library, so the editor's Content background resolves. */
  contentTextures?: DashboardTextureItem[];
  entry: JournalEntry;
  /**
   * The older/newer entries, for the Previous and Next links. Defaults to none,
   * which is what `mode="modal"` always wants — those links leave for another
   * entry's route, which would close the dialog and abandon the list behind it.
   */
  neighbors?: JournalEntryNeighbors;
  categoryIcons?: Record<string, string>;
  tagIcons?: Record<string, string>;
  /** Every known category name — the edit form's picker offers these. */
  categoryOptions: string[];
  /** Every known tag name — the edit form's picker offers these. */
  tagOptions: string[];
  /**
   * Saved taxonomy combos, for the edit form's "Prefill Category/Tags Combo"
   * button (migration 0177). Combos are offered here where prefill templates are
   * not, and the asymmetry is the point: this entry already exists, so there is
   * nothing for a template to seed — but its tags may well be wrong, which is
   * exactly what a combo fixes.
   */
  taxonomyCombos?: JournalTaxonomyCombo[];
  /** The saved-location library's taxonomy, for the edit form's location picker. */
  locationCategoryOptions?: string[];
  locationTagOptions?: string[];
  /**
   * Whether this reader has been granted the Expense module. False hides the $
   * button, since the action behind it would refuse them anyway and a control
   * that always fails is worse than no control.
   *
   * Decided on the server (the page has the user); the guard that matters is
   * `requireModuleAccess` inside `expensesOnDateAction`, not this flag — an
   * action is its own POST endpoint, so hiding a button protects nothing.
   */
  canSeeExpense?: boolean;
}) {
  const router = useRouter();
  /**
   * The whole of what `mode` changes:
   *
   *  1. the wrapper — a `Modal` instead of a bare column;
   *  2. Delete — close and refresh the screen behind, instead of navigating to
   *     the module home, which there is no way back from inside a dialog;
   *  3. the edit form takes `inDialog`, dropping its own card frame since the
   *     dialog already supplies one.
   *
   * Previous/Next fall out of `neighbors` defaulting to none rather than being
   * branched on here — a caller could in principle pass them on a page only.
   */
  const isModal = mode === "modal";
  const [isBusy, setIsBusy] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [mapView, setMapView] = useState<MapView | undefined>(undefined);
  // How many clips are attached (migration 0155), and whether the modal is open.
  //
  // Only the count is held here: the viewer's button just says "there are clips",
  // and `EntryClipsDialog` reads the clips themselves when it opens. Counting here
  // rather than in `JournalViewer` because that is a registered shared component
  // and may not fetch.
  const [clipCount, setClipCount] = useState(0);
  const [isClipsOpen, setIsClipsOpen] = useState(false);
  // Whether the "expenses around this date" dialog is open. Only the flag lives
  // here — `JournalDayExpenses` reads the rows when it mounts, the same split
  // the clips dialog uses.
  const [isExpensesOpen, setIsExpensesOpen] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // Re-read whenever the edit form closes as well as on mount, because the edit
  // form attaches and detaches clips immediately — without `isEditing` in the deps
  // the button would still show the count from before the edit. Also re-read when
  // the modal closes, since a clip can be detached from inside it.
  useEffect(() => {
    if (isEditing || isClipsOpen) return;
    let cancelled = false;

    void listClipsForEntryAction(entry.id).then((result) => {
      if (cancelled) return;
      // A failure is left silent: the button simply does not draw. An error line
      // about clips above a perfectly readable entry would be noise, and the clips
      // are reachable from the Clips module regardless.
      if (result.ok && result.clips) setClipCount(result.clips.length);
    });

    return () => {
      cancelled = true;
    };
  }, [entry.id, isEditing, isClipsOpen]);

  // --- encryption (migration 0131) -------------------------------------------
  //
  // This component owns the unlock, because it is the one thing above both the
  // viewer and the edit form. The password lives **here and nowhere else**: not
  // in a cookie, not in storage, not on the server between calls. Navigating
  // away unmounts this component and takes it with it, which is the whole of the
  // unlock lifetime — `NavTree` remounts on every navigation anyway.
  //
  // There is deliberately no idle timer: an unlock expiring mid-edit would throw
  // away writing in progress, which is worse than the exposure it prevents.
  const [password, setPassword] = useState<string | undefined>(undefined);
  const [openedText, setOpenedText] = useState<{ title: string; content: string } | undefined>(
    undefined,
  );
  const [encryptionError, setEncryptionError] = useState<string | undefined>(undefined);
  // Which prompt is on screen, when one is. `undefined` = none.
  const [prompt, setPrompt] = useState<"encrypt" | "remove" | undefined>(undefined);

  const isUnlocked = entry.isEncrypted && openedText !== undefined;

  async function handleUnlock(typed: string) {
    setIsBusy(true);
    setEncryptionError(undefined);
    try {
      const result = await decryptJournalEntryAction(entry.id, typed);
      if (!result.ok || !result.text) {
        setEncryptionError(result.error ?? "That password does not open this entry.");
        return;
      }
      setOpenedText(result.text);
      setPassword(typed);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleEncrypt(typed: string, hint: string) {
    setIsBusy(true);
    setEncryptionError(undefined);
    try {
      const result = await encryptJournalEntryAction(entry.id, typed, hint);
      if (!result.ok) {
        setEncryptionError(result.error);
        return;
      }
      // Not left unlocked: the reader just proved they know the password by
      // typing it twice, and leaving the plaintext on screen after sealing it
      // reads as if nothing happened.
      setPrompt(undefined);
      setOpenedText(undefined);
      setPassword(undefined);
      router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRemoveEncryption(typed: string) {
    setIsBusy(true);
    setEncryptionError(undefined);
    try {
      const result = await removeJournalEntryEncryptionAction(entry.id, typed);
      if (!result.ok) {
        setEncryptionError(result.error);
        return;
      }
      setPrompt(undefined);
      setOpenedText(undefined);
      setPassword(undefined);
      router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  /** Drops the decrypted text and the password without touching the entry. */
  function handleLock() {
    setOpenedText(undefined);
    setPassword(undefined);
    setEncryptionError(undefined);
    setIsEditing(false);
  }

  /**
   * The entry as the viewer and the edit form should see it.
   *
   * An unlocked entry is shown with its decrypted title and content spliced back
   * in. This object is **never** sent to `updateJournalEntryAction` — the edit
   * form routes an encrypted save through `updateEncryptedJournalEntryAction`
   * instead, and the use-case refuses to write plaintext over ciphertext even if
   * something slipped through.
   */
  const shownEntry: JournalEntry =
    isUnlocked && openedText
      ? { ...entry, title: openedText.title, content: openedText.content }
      : entry;

  async function handleToggleLock(nextLocked: boolean) {
    setIsBusy(true);
    setError(undefined);
    try {
      const result = await setEntryLockAction(entry.id, nextLocked);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  // Clone: start a new entry seeded from this one. Navigation only — the New
  // Entry screen reads the source entry server-side from `?clone=`, so nothing
  // about the entry travels in the URL and a reload or a bookmark re-seeds the
  // same form. The id is enough because that page re-authorises the module and
  // re-reads the row itself.
  //
  // No `setIsBusy` here: this leaves the page rather than awaiting a write, and
  // a busy flag set on a component that is about to unmount only disables the
  // toolbar for the frame before it goes.
  //
  // Reachable only when the entry is readable — an encrypted entry renders the
  // unlock prompt in place of this viewer (see the branch below), so a sealed
  // entry has no Clone button to press and a clone can never carry a title the
  // reader has not already opened.
  function handleClone() {
    router.push(`${JOURNAL_MODULE_PATH}/new-entry?clone=${entry.id}`);
  }

  async function handleDelete() {
    setIsBusy(true);
    setError(undefined);
    try {
      const result = await deleteJournalEntryAction(entry.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // The entry no longer exists, so it must not stay on screen.
      //
      // In a dialog that means closing and re-reading the screen behind, which
      // is the list the reader came from and which now has one row fewer.
      // Pushing to the module home from here would throw away that list — and
      // on the Calendar, the month they were reading — to show them a home
      // screen they did not ask for.
      if (isModal) {
        onClose?.();
        router.refresh();
        return;
      }
      router.push(JOURNAL_MODULE_PATH);
    } finally {
      setIsBusy(false);
    }
  }

  // "Previous" is the older entry and "Next" the newer one — the same ordering
  // the entries list uses, so navigation matches the row you came from.
  const previousHref = neighbors.previous
    ? `${JOURNAL_MODULE_PATH}/entries/${neighbors.previous.id}`
    : undefined;
  const nextHref = neighbors.next ? `${JOURNAL_MODULE_PATH}/entries/${neighbors.next.id}` : undefined;

  // Deep link for the viewer's running-shoe icon: the Calendar section opened
  // on this entry's date. ?anchor= moves the grid to that day's month and
  // ?date= selects it beneath the grid; leaving ?scope= unset falls back to
  // the month view, so a link from any entry opens exactly its own month.
  const calendarHref = `${JOURNAL_MODULE_PATH}/calendar?anchor=${entry.date}&date=${entry.date}`;

  const body = (
    <div className="flex flex-col gap-4">
      {/* No "Back to My Journal" link: the page renders inside `JournalShell`
          now, so the module rail and the section panel are the way back. */}
      {error && <p className="no-print text-sm text-red-400">{error}</p>}

      {/* A sealed entry shows the prompt in place of its body. Rendered inline
          rather than as an overlay: nothing about an entry belongs on the
          floating layer, and the bottom edge is already the shared nav's. */}
      {entry.isEncrypted && !isUnlocked && (
        <EncryptionPrompt
          mode="unlock"
          hint={entry.passwordHint}
          error={encryptionError}
          isBusy={isBusy}
          onSubmit={(typed) => handleUnlock(typed)}
          className="no-print"
        />
      )}

      {/* Encrypting and removing encryption are dialogs, not inline cards: both
          are deliberate decisions with a consequence that cannot be undone, and
          a dialog stops the rest of the entry competing for attention while one
          is being made. The *unlock* prompt above stays inline on purpose --
          it sits where the body would be, so it reads as the entry being shut
          rather than as the app asking a question. */}
      {prompt === "encrypt" && (
        <EncryptionPrompt
          asModal
          mode="encrypt"
          error={encryptionError}
          isBusy={isBusy}
          onSubmit={handleEncrypt}
          onCancel={() => {
            setPrompt(undefined);
            setEncryptionError(undefined);
          }}
        />
      )}
      {prompt === "remove" && (
        <EncryptionPrompt
          asModal
          mode="confirm"
          hint={entry.passwordHint}
          error={encryptionError}
          isBusy={isBusy}
          onSubmit={(typed) => handleRemoveEncryption(typed)}
          onCancel={() => {
            setPrompt(undefined);
            setEncryptionError(undefined);
          }}
        />
      )}

      {entry.isEncrypted && !isUnlocked ? null : isEditing ? (
        <JournalEntryEditor
          mode="edit"
          // The dialog already draws the card frame, so the form drops its own.
          inDialog={isModal}
          entry={shownEntry}
          encryptionPassword={password}
          categoryOptions={categoryOptions}
          tagOptions={tagOptions}
          taxonomyCombos={taxonomyCombos}
          preferences={preferences}
          contentTextures={contentTextures}
          locationCategoryOptions={locationCategoryOptions}
          locationTagOptions={locationTagOptions}
          onClose={() => setIsEditing(false)}
          onSaved={() => {
            setIsEditing(false);
            // The caller re-reads its own list when it has one; otherwise pull
            // the saved entry back from the server. See the prop's note.
            if (onSaved) {
              onSaved(entry.id);
              return;
            }
            router.refresh();
          }}
        />
      ) : (
        <JournalViewer
          entry={shownEntry}
          isUnlocked={isUnlocked}
          onEncrypt={() => {
            setEncryptionError(undefined);
            setPrompt("encrypt");
          }}
          onRemoveEncryption={() => {
            setEncryptionError(undefined);
            setPrompt("remove");
          }}
          onLock={handleLock}
          onPrint={() => window.print()}
          onEdit={() => setIsEditing(true)}
          onClone={handleClone}
          onShowLocation={(location) => setMapView({ kind: "one", location })}
          onShowAllLocations={() => setMapView({ kind: "all" })}
          onToggleLock={handleToggleLock}
          onDelete={handleDelete}
          calendarHref={calendarHref}
          // Omitted entirely for a reader without the Expense module, which is
          // how JournalViewer decides not to draw the button at all.
          onOpenExpenses={canSeeExpense ? () => setIsExpensesOpen(true) : undefined}
          previousHref={previousHref}
          previousDate={neighbors.previous?.date}
          nextHref={nextHref}
          nextDate={neighbors.next?.date}
          clipCount={clipCount}
          onOpenClips={() => setIsClipsOpen(true)}
          categoryIcons={categoryIcons}
          tagIcons={tagIcons}
          categoryHref={(name) => taxonomyFilterHref("category", name)}
          tagHref={(name) => taxonomyFilterHref("tag", name)}
          photosSlot={<JournalPhotosCard date={entry.date} />}
          isBusy={isBusy}
        />
      )}

      {mapView?.kind === "one" && !isEditing && (
        <div className="no-print rounded-xl border border-line bg-paper-raised p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-ink">
              {mapView.location.locationName !== "" && (
                <span className="mr-2">{mapView.location.locationName}</span>
              )}
              <span className="font-mono text-xs text-muted">
                {mapView.location.latitude.toFixed(5)}, {mapView.location.longitude.toFixed(5)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-muted">Open in:</span>
              <a
                href={openStreetMapUrl(mapView.location)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-brass-dark hover:underline"
              >
                OpenStreetMap
              </a>
              <a
                href={googleMapsUrl(mapView.location)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-brass-dark hover:underline"
              >
                Google Maps
              </a>
              <Button size="sm" variant="secondary" onClick={() => setMapView(undefined)}>
                Close map
              </Button>
            </div>
          </div>
          <LocationMap
            // `key` remounts the map when a different pin is chosen, so it
            // recenters even though the component holds its own Leaflet state.
            key={mapView.location.id}
            marker={{
              latitude: mapView.location.latitude,
              longitude: mapView.location.longitude,
            }}
            center={{
              latitude: mapView.location.latitude,
              longitude: mapView.location.longitude,
            }}
          />
        </div>
      )}

      {mapView?.kind === "all" && !isEditing && (
        <div className="no-print rounded-xl border border-line bg-paper-raised p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink">
              All locations{" "}
              <span className="font-normal text-muted">({entry.locations.length})</span>
            </h3>
            <Button size="sm" variant="secondary" onClick={() => setMapView(undefined)}>
              Close map
            </Button>
          </div>
          <LocationMap
            // Numbered pins, fitted to the whole set. Taller than the
            // single-pin map because it has to hold several pins at once.
            markers={entry.locations.map((location, index) => ({
              latitude: location.latitude,
              longitude: location.longitude,
              number: index + 1,
              // Clicking a pin names it. An entry's locations carry no
              // categories or address, so the popup is the name and the
              // coordinates — which is all the table below holds too.
              label: location.locationName,
            }))}
            marker={null}
            center={null}
            heightClassName="h-80 max-lg:h-64"
          />
          {/* The pin numbers spelled out, so every coordinate is readable as
              text and not only as a dot on the map. Scrolls sideways on a
              phone rather than squeezing the coordinate column. */}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[28rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th scope="col" className="w-12 py-2 pr-2 font-medium">
                    #
                  </th>
                  <th scope="col" className="py-2 pr-2 font-medium">
                    Coordinates
                  </th>
                  <th scope="col" className="py-2 pr-2 font-medium">
                    Name
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Open in
                  </th>
                </tr>
              </thead>
              <tbody>
                {entry.locations.map((location, index) => (
                  <tr key={location.id} className="border-b border-line/60 last:border-b-0">
                    <td className="py-2 pr-2 font-mono text-xs font-semibold text-brass-dark">
                      #{index + 1}
                    </td>
                    <td className="py-2 pr-2 font-mono text-xs text-muted">
                      {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
                    </td>
                    <td className="py-2 pr-2 text-ink">
                      {location.locationName !== "" ? location.locationName : "—"}
                    </td>
                    <td className="flex flex-wrap gap-3 py-2">
                      <a
                        href={openStreetMapUrl(location)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-brass-dark hover:underline"
                      >
                        OSM
                      </a>
                      <a
                        href={googleMapsUrl(location)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-brass-dark hover:underline"
                      >
                        Google
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Opened by the viewer's clip button. The dialog lists this entry's clips
          and opens the one picked — straight through when there is only one. A
          sealed clip's password is the clip viewer's business; this screen's
          unlock is for the *entry* and has nothing to do with it. */}
      {isClipsOpen && (
        <EntryClipsDialog entryId={entry.id} onClose={() => setIsClipsOpen(false)} />
      )}

      {isExpensesOpen && (
        <JournalDayExpenses date={entry.date} onClose={() => setIsExpensesOpen(false)} />
      )}
    </div>
  );

  if (!isModal) return body;

  return (
    <Modal
      // The entry's own title names the dialog. An encrypted one has none to
      // show, and an untitled one would leave the dialog with no accessible
      // name at all, so both fall back — the same placeholder the grids use.
      title={
        shownEntry.isEncrypted
          ? ENCRYPTED_TITLE_PLACEHOLDER
          : shownEntry.title.trim() === ""
            ? "Journal entry"
            : shownEntry.title
      }
      description={formatCalendarDayHeading(entry.date)}
      // Wide: this is the whole entry — toolbar, body, locations, photos — and
      // the edit form behind it, which is a two-column layout of its own.
      // `className` is merged last onto the panel, the sanctioned way to take a
      // shape no size offers. Below 1024px the panel is full-width anyway.
      size="lg"
      className="max-w-[min(80rem,95vw)]"
      // While a write is in flight the dialog refuses Escape, the ✕ and an
      // overlay click, so a half-saved edit cannot be dismissed out from under
      // itself.
      isBusy={isBusy}
      onClose={() => onClose?.()}
    >
      {body}
    </Modal>
  );
}
