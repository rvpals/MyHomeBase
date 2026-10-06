"use client";

// Categories & Tags editor for My Journal's Meta Data section. The two managed
// lists sit behind a Category/Tags tab strip — one at a time, since either can
// run to a couple of hundred rows — each with an inline "New" form and
// edit/generate/delete icon buttons leading each row. Edit opens a popup
// (Modal) for changing the description and uploading/removing a small icon — the icon control is the one thing that
// doesn't fit inline, since dropping a file needs room the row doesn't have.
//
// The ⚡ row action draws an icon from the item's *name*: the name is mapped to a
// Material Design Icons glyph (@/lib/journal/icon-search) and the bytes fetched
// once and stored (@/lib/journal/icon-fetch), falling back to a locally drawn
// glyph when offline or unmapped. There are also two bulk fills, because a real
// journal runs to a couple of hundred tags and none of them start with an icon:
// "draw the missing icons" at the top covers both lists, and "Autopopulate icon
// for <kind>" beside each list's Add button covers just that list. Both are
// missing-only — the row action is how you redo a single one you don't like.
//
// Each list has its own filter box above it, matching name and description, for
// finding the one row you came to edit without scrolling a couple of hundred.
// Purely client-side: both lists arrive whole as props, so there's nothing to
// fetch and the filter isn't persisted.
//
// Rows carry a checkbox and the list has a bulk Merge and a bulk Delete, because
// both lists fill themselves — saving or importing an entry registers any category/tag it
// mentions — so a typo or a stray CSV column leaves managed rows nothing ever
// uses, and removing those one row at a time isn't a workflow.
//
// "Clean up" is the way to find them: it asks the server which managed names no
// entry carries and **ticks those rows**, deleting nothing. The reader reviews
// the ticks and presses Delete. That two-step is deliberate — a sweep that
// deleted what it found would eventually drop a name created a minute earlier
// and not yet used. Bulk Delete then confirms with a breakdown of which of the
// ticked names entries still carry, since deleting one detaches it from every
// entry and a *hand*-ticked row may well be in use even though a Clean up
// selection never is.
//
// "Merge" folds the ticked names into one: it opens a dialog (a name has to be
// typed, so a `window.confirm` can't carry it) showing what the merge will do
// before it happens, then asks once more because **a merge cannot be undone** —
// there is no recycle bin for taxonomy. The rename also follows into saved
// filters and prefill templates, which store taxonomy names as JSON rather than
// as foreign keys; see `lib/journal/taxonomy-merge.ts`.
//
// Selection is pruned to the filtered set, the same rule `DataGrid` follows, so
// "3 selected" always equals what Delete will touch. This list stays a plain
// `<ul>` rather than becoming a `DataGrid`: the rows are one line each and want
// to stay that way, and `DataGrid` owns its selection internally, which Clean up
// needs to be able to set.
//
// Route-local rather than registered: nothing outside My Journal renders this.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BusyOverlay } from "@/components/busy-overlay";
import { Button } from "@/components/button";
import { FileDropzone } from "@/components/file-dropzone";
import { Modal } from "@/components/modal";
import { Tabs } from "@/components/tabs";
import { TreeIcon } from "@/components/tree-icons";
import {
  JOURNAL_IMAGE_MIME_TYPES,
  MAX_JOURNAL_ICON_BYTES,
  type JournalCategory,
  type JournalTag,
  type TaxonomyMergePlan,
} from "@/lib/journal";
import { matchesSearch } from "@/lib/shared/table";
import {
  clearJournalCategoryIconAction,
  clearJournalTagIconAction,
  deleteJournalCategoryAction,
  deleteJournalTagAction,
  deleteJournalTaxonomyAction,
  findUnusedJournalTaxonomyAction,
  generateJournalCategoryIconAction,
  generateJournalTagIconAction,
  generateMissingJournalIconsAction,
  journalTaxonomyInUseAction,
  mergeJournalTaxonomyAction,
  planJournalTaxonomyMergeAction,
  saveJournalCategoryAction,
  saveJournalCategoryIconAction,
  saveJournalTagAction,
  saveJournalTagIconAction,
} from "./journal-actions";
import {
  TaxonomyIconThumbnail,
  journalEntriesFilterHref,
  journalTaxonomyIconUrl,
} from "./journal-shared";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/** Either a category or a tag — the two managed lists share this exact shape. */
interface TaxonomyItem {
  name: string;
  description: string;
  iconMimeType?: string;
}

type Kind = "category" | "tag";

/** Reads a File as bare base64 (no data-URL prefix), which the action wants. */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read the image."));
    reader.readAsDataURL(file);
  });
}

/** Where an item's icon is served from, or undefined when it has none. */
function iconUrl(kind: Kind, item: TaxonomyItem, updatedAt: string): string | undefined {
  return journalTaxonomyIconUrl(kind, { ...item, updatedAt });
}

const generateIconAction = (kind: Kind) =>
  kind === "category" ? generateJournalCategoryIconAction : generateJournalTagIconAction;

/**
 * Asks the server to draw an icon for `item` from its name, confirming first when
 * that would overwrite one it already has.
 *
 * The confirm is conditional on purpose: generating onto an empty slot is
 * trivially undoable (generate again, or upload), but an icon the reader chose and
 * uploaded is not recoverable, so a mis-click on a crowded row mustn't destroy it.
 *
 * Returns the error message to show, or undefined when it worked or was cancelled.
 */
async function generateIconFor(
  kind: Kind,
  item: TaxonomyItem,
): Promise<{ error?: string; cancelled?: boolean }> {
  if (
    item.iconMimeType &&
    !window.confirm(`Replace the existing icon for "${item.name}" with a generated one?`)
  ) {
    return { cancelled: true };
  }
  const result = await generateIconAction(kind)(item.name);
  return result.ok ? {} : { error: result.error };
}

/**
 * The popup opened by a row's Edit button: description field plus icon
 * upload/replace/remove. `updatedAt` is passed in separately from `item`
 * because JournalCategory/JournalTag carry it but this component only needs
 * the taxonomy-item subset for its own fields.
 */
function EditTaxonomyModal({
  kind,
  item,
  updatedAt,
  onClose,
}: {
  kind: Kind;
  item: TaxonomyItem;
  updatedAt: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [description, setDescription] = useState(item.description);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const saveAction = kind === "category" ? saveJournalCategoryAction : saveJournalTagAction;
  const saveIconAction = kind === "category" ? saveJournalCategoryIconAction : saveJournalTagIconAction;
  const clearIconAction = kind === "category" ? clearJournalCategoryIconAction : clearJournalTagIconAction;

  async function handleSaveDescription() {
    setError(undefined);
    setIsBusy(true);
    try {
      const result = await saveAction({ name: item.name, description });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  async function handleIconFile(file: File) {
    setError(undefined);
    if (file.size > MAX_JOURNAL_ICON_BYTES) {
      setError(`"${file.name}" is too large — keep it under ${Math.round(MAX_JOURNAL_ICON_BYTES / 1024)} KB.`);
      return;
    }
    setIsBusy(true);
    try {
      const base64Data = await readFileAsBase64(file);
      const result = await saveIconAction(item.name, file.type, base64Data);
      if (!result.ok) setError(result.error);
      else router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRemoveIcon() {
    setError(undefined);
    setIsBusy(true);
    try {
      const result = await clearIconAction(item.name);
      if (!result.ok) setError(result.error);
      else router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  // The same generate action as the row's flash button. Offered here too because
  // this popup is where someone lands to *fix* an icon, and "draw me one" belongs
  // beside "upload one" rather than only out on the row.
  async function handleGenerateIcon() {
    setError(undefined);
    setIsBusy(true);
    try {
      const { error: message, cancelled } = await generateIconFor(kind, item);
      if (cancelled) return;
      if (message) setError(message);
      else router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  const url = iconUrl(kind, item, updatedAt);

  return (
    <Modal
      title={`Edit ${kind === "category" ? "category" : "tag"}: ${item.name}`}
      onClose={onClose}
      isBusy={isBusy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isBusy}>
            Close
          </Button>
          <Button onClick={handleSaveDescription} disabled={isBusy}>
            Save description
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <p className="text-sm text-red-400">{error}</p>}

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Description</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={isBusy}
            className={INPUT_CLASS}
          />
        </label>

        <div>
          <span className="mb-1 block text-sm font-medium text-ink">Icon</span>
          <div className="flex items-center gap-3">
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element -- icon bytes are served from our own DB-backed route, not a static asset next/image can optimize.
              <img src={url} alt="" className="h-12 w-12 rounded-lg border border-line object-cover" />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-line text-xs text-muted">
                None
              </div>
            )}
            <div className="flex-1">
              <FileDropzone
                accept={JOURNAL_IMAGE_MIME_TYPES.join(",")}
                disabled={isBusy}
                label={item.iconMimeType ? "Drop a new icon here, or click to browse" : "Drop an icon here, or click to browse"}
                onFile={handleIconFile}
              />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button size="sm" variant="secondary" onClick={handleGenerateIcon} disabled={isBusy}>
              Generate from name
            </Button>
            {item.iconMimeType && (
              <button
                type="button"
                disabled={isBusy}
                onClick={handleRemoveIcon}
                className="text-xs text-muted hover:text-red-400"
              >
                Remove icon
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The Merge dialog: fold the ticked names into one.
 *
 * A dialog rather than a `window.confirm` because merging needs a *name* typed
 * in, and because the consequences are worth showing before the reader commits
 * — the entry count, whether the name already exists, and which saved filters
 * and prefill templates the rename will follow into.
 *
 * The summary comes from `planJournalTaxonomyMergeAction` and is re-read as the
 * name is typed, debounced. That read is deliberately on the server: which
 * filters reference a name is not something the view has the data to work out.
 *
 * Pressing Merge raises one more confirm, because **a merge cannot be undone**:
 * there is no recycle bin for taxonomy, so which entry carried which original
 * name is gone once it lands.
 */
function MergeTaxonomyModal({
  kind,
  sources,
  onClose,
  onMerged,
}: {
  kind: Kind;
  sources: string[];
  onClose: () => void;
  onMerged: (message: string) => void;
}) {
  const noun = kind === "category" ? "category" : "tag";
  const plural = kind === "category" ? "categories" : "tags";

  // Seeded with the alphabetically first selected name: merging near-duplicates
  // usually keeps one of them, so this is the likeliest answer and saves typing
  // it out. Fully editable — it is only a starting point.
  const [target, setTarget] = useState(() => [...sources].sort()[0] ?? "");
  const [plan, setPlan] = useState<TaxonomyMergePlan | undefined>(undefined);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const trimmedTarget = target.trim();

  // Re-planned as you type, debounced so a long name doesn't fire a read per
  // keystroke. The cleanup also guards against an in-flight read landing after
  // the dialog closed.
  useEffect(() => {
    if (trimmedTarget === "") {
      setPlan(undefined);
      return;
    }
    let cancelled = false;
    setIsPlanning(true);
    const timer = setTimeout(async () => {
      const outcome = await planJournalTaxonomyMergeAction(kind, sources, trimmedTarget);
      if (cancelled) return;
      if (outcome.ok && outcome.plan) {
        setPlan(outcome.plan);
        setError(undefined);
      } else {
        setPlan(undefined);
        setError(outcome.error);
      }
      setIsPlanning(false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setIsPlanning(false);
    };
  }, [kind, sources, trimmedTarget]);

  async function handleMerge() {
    if (trimmedTarget === "") return;
    // The prompt Min asked for, in as many words, and the last thing standing
    // between the reader and an irreversible rewrite.
    if (
      !window.confirm(
        `Your new ${noun} would be updated to "${trimmedTarget}". Are you sure?\n\n` +
          `${plan ? `${plan.sources.length} ${plan.sources.length === 1 ? noun : plural} will be folded in and ${plan.entryCount} ${plan.entryCount === 1 ? "entry" : "entries"} will carry "${trimmedTarget}".\n\n` : ""}` +
          "This cannot be undone.",
      )
    ) {
      return;
    }
    setError(undefined);
    setIsBusy(true);
    try {
      const outcome = await mergeJournalTaxonomyAction(kind, sources, trimmedTarget);
      if (!outcome.ok || !outcome.result) {
        setError(outcome.error ?? `Failed to merge the selected ${plural}.`);
        return;
      }
      const { mergedCount, entryCount, rewrittenFilters, rewrittenTemplates } = outcome.result;
      const extras = [
        rewrittenFilters > 0
          ? `${rewrittenFilters} saved filter${rewrittenFilters === 1 ? "" : "s"}`
          : undefined,
        rewrittenTemplates > 0
          ? `${rewrittenTemplates} template${rewrittenTemplates === 1 ? "" : "s"}`
          : undefined,
      ].filter((part): part is string => part !== undefined);
      onMerged(
        `Merged ${mergedCount} ${mergedCount === 1 ? noun : plural} into "${outcome.result.target}" — ` +
          `${entryCount} ${entryCount === 1 ? "entry" : "entries"} now carr${entryCount === 1 ? "ies" : "y"} it` +
          `${extras.length > 0 ? `, and ${extras.join(" and ")} updated` : ""}.`,
      );
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <>
      {/* Covers the whole viewport, dialog included, so the only thing lit is
          the message. */}
      <BusyOverlay
        isBusy={isBusy}
        message="Merging…"
        detail="Entries, saved filters and templates are being updated. Please wait."
      />
    <Modal
      title={`Merge ${sources.length} ${sources.length === 1 ? noun : plural}`}
      onClose={onClose}
      isBusy={isBusy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isBusy}>
            Cancel
          </Button>
          <Button onClick={handleMerge} disabled={isBusy || trimmedTarget === ""}>
            {isBusy ? "Merging…" : "Merge"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <p className="text-sm text-red-400">{error}</p>}

        <div>
          <span className="mb-1 block text-sm font-medium text-ink">Merging</span>
          <p className="text-sm text-muted">{[...sources].sort().join(" · ")}</p>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">
            New {noun} name
          </span>
          <input
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            disabled={isBusy}
            autoFocus
            className={INPUT_CLASS}
          />
        </label>

        {/* What the merge will actually do. Kept in one block so the reader has
            a single place to look before committing. */}
        <div className="rounded-lg border border-line bg-paper px-3 py-2 text-sm">
          {trimmedTarget === "" ? (
            <p className="text-muted">Enter a name to merge into.</p>
          ) : isPlanning && !plan ? (
            <p className="text-muted">Checking…</p>
          ) : plan ? (
            <div className="flex flex-col gap-1">
              {plan.targetExists ? (
                <p className="text-ink">
                  &ldquo;{plan.target}&rdquo; already exists — the selected {plural} fold into it,
                  and it keeps its own icon and description.
                </p>
              ) : (
                <p className="text-ink">
                  &ldquo;{plan.target}&rdquo; will be created.
                  {plan.inheritedIconFrom
                    ? ` It inherits the icon from "${plan.inheritedIconFrom}".`
                    : ""}
                </p>
              )}
              <p className="text-muted">
                {plan.entryCount} {plan.entryCount === 1 ? "entry" : "entries"} will carry &ldquo;
                {plan.target}&rdquo;.
              </p>
              {(plan.affectedFilters.length > 0 || plan.affectedTemplates.length > 0) && (
                <p className="text-muted">
                  Also updates{" "}
                  {[
                    plan.affectedFilters.length > 0
                      ? `${plan.affectedFilters.length} saved filter${plan.affectedFilters.length === 1 ? "" : "s"} (${plan.affectedFilters.join(", ")})`
                      : undefined,
                    plan.affectedTemplates.length > 0
                      ? `${plan.affectedTemplates.length} template${plan.affectedTemplates.length === 1 ? "" : "s"} (${plan.affectedTemplates.join(", ")})`
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join(" and ")}
                  .
                </p>
              )}
              <p className="text-muted">This cannot be undone.</p>
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
    </>
  );
}

function TaxonomyPanel({
  kind,
  title,
  helpText,
  items,
}: {
  kind: Kind;
  title: string;
  helpText: string;
  items: (JournalCategory | JournalTag)[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState<JournalCategory | JournalTag | undefined>(undefined);
  // Narrows the rendered list only — nothing here is persisted or sent to the
  // server, since both lists arrive whole as props.
  const [query, setQuery] = useState("");
  // Which row is mid-generate, by name — one row's spinner must not disable the
  // whole list, so this is a name rather than a boolean.
  const [generating, setGenerating] = useState<string | undefined>(undefined);

  // The batch fill for this list only — its own busy flag and its own result
  // line, so it never borrows the per-row spinner.
  const [autopopulating, setAutopopulating] = useState(false);
  const [autopopulateResult, setAutopopulateResult] = useState<string | undefined>(undefined);

  // Ticked rows, by name. Names rather than indexes because position is not
  // identity here — the filter box reorders nothing but does hide rows, and a
  // `router.refresh()` after an edit re-reads the whole list.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // The Clean up scan's own busy flag and result line, kept apart from the
  // icon fill's for the same reason: two independent buttons, two messages.
  const [cleaning, setCleaning] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<string | undefined>(undefined);
  const [deleting, setDeleting] = useState(false);
  // Open only while the Merge dialog is up; holds the names it was opened for so
  // a later tick can't change what the dialog is about mid-edit.
  const [merging, setMerging] = useState<string[] | undefined>(undefined);

  const saveAction = kind === "category" ? saveJournalCategoryAction : saveJournalTagAction;
  const deleteAction = kind === "category" ? deleteJournalCategoryAction : deleteJournalTagAction;
  const missingIcons = items.filter((item) => !item.iconMimeType).length;
  // "category"/"categories" — said often enough in the prompts below to be worth
  // naming once rather than re-deriving at each call.
  const noun = kind === "category" ? "category" : "tag";
  const plural = kind === "category" ? "categories" : "tags";
  // Name *and* description, because a tag you're hunting for is as often
  // remembered by what it's for as by what it's called. `matchesSearch` ANDs the
  // whitespace-separated terms, so a second word narrows rather than widens.
  const visibleItems = items.filter((item) => matchesSearch([item.name, item.description], query));
  const isFiltering = query.trim() !== "";

  // Selection is pruned to what the filter shows, the same rule `DataGrid`
  // follows: "3 selected" must always equal what Delete will touch, so a tick
  // can't hide behind a filter and be deleted unseen — nor survive out of sight
  // and reappear when the filter is cleared.
  const visibleNames = new Set(visibleItems.map((item) => item.name));
  const selectedVisible = visibleItems.filter((item) => selected.has(item.name));
  const allVisibleSelected = visibleItems.length > 0 && selectedVisible.length === visibleItems.length;

  // Ticks for rows that left `items` altogether — deleted elsewhere, or gone
  // after a refresh — are dropped here. Scoped to `items` on purpose: it must
  // *not* also prune on the filter, because `handleCleanUp` ticks the whole
  // unfiltered result and an effect that pruned on `query` would race it.
  // Filter-hidden ticks are handled by `selectedVisible` instead, which every
  // count and the Delete call derive from, so a hidden tick is never acted on.
  const itemNames = items.map((item) => item.name).join("\u0000");
  useEffect(() => {
    const live = new Set(itemNames === "" ? [] : itemNames.split("\u0000"));
    setSelected((previous) => {
      if (previous.size === 0) return previous;
      const pruned = new Set([...previous].filter((selectedName) => live.has(selectedName)));
      return pruned.size === previous.size ? previous : pruned;
    });
  }, [itemNames]);

  function toggleOne(name: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  /** Select-all covers the filtered set only — see the pruning note above. */
  function toggleAllVisible() {
    setSelected(allVisibleSelected ? new Set() : new Set(visibleNames));
  }

  /**
   * "Clean up": asks which managed names no entry uses, then *ticks* them.
   *
   * Deliberately two steps. The scan deletes nothing — it only reports and
   * selects, so the reader reviews the ticks and presses Delete. An automatic
   * sweep would eventually drop a name created a minute ago and not yet used.
   */
  async function handleCleanUp() {
    setError(undefined);
    setCleanupResult(undefined);
    setCleaning(true);
    // The scan covers the whole list, so a filter left on would hide part of
    // what it ticks — and "ticked 12" above a list showing three of them reads
    // as a bug. Clearing it isn't load-bearing for correctness (selection is
    // kept by name, and the pruning effect ignores the filter), just honest.
    setQuery("");
    try {
      const outcome = await findUnusedJournalTaxonomyAction(kind);
      if (!outcome.ok || !outcome.names) {
        setError(outcome.error ?? `Failed to check which ${plural} are unused.`);
        return;
      }
      const unused = outcome.names;
      if (unused.length === 0) {
        setCleanupResult(`Every ${noun} is used by at least one entry — nothing to clean up.`);
        return;
      }
      if (
        !window.confirm(
          `${unused.length} ${unused.length === 1 ? noun : plural} ${unused.length === 1 ? "is" : "are"} not used by any entry:\n\n` +
            `${unused.slice(0, 30).join(", ")}${unused.length > 30 ? `, … (+${unused.length - 30} more)` : ""}\n\n` +
            `Mark ${unused.length === 1 ? "it" : "them"}? Nothing is deleted — ` +
            "the rows get ticked so you can review them and press Delete.",
        )
      ) {
        return;
      }
      // Replaces the selection rather than adding to it: the reader asked for
      // "the unused ones", and leaving an earlier hand-tick in place would mean
      // Delete touches a name Clean up never reported.
      setSelected(new Set(unused));
      setCleanupResult(
        `Ticked ${unused.length} ${unused.length === 1 ? noun : plural} used by no entry. Review, then press Delete.`,
      );
    } finally {
      setCleaning(false);
    }
  }

  /**
   * Bulk Delete. Confirms with the in-use breakdown first: deleting a name
   * detaches it from every entry that carries it, and a hand-ticked row may
   * well be in use even though a Clean up selection never is.
   */
  async function handleDeleteSelected() {
    const names = selectedVisible.map((item) => item.name);
    if (names.length === 0) return;
    setError(undefined);
    setCleanupResult(undefined);
    setDeleting(true);
    try {
      const usage = await journalTaxonomyInUseAction(kind, names);
      if (!usage.ok) {
        setError(usage.error ?? `Failed to check which ${plural} are still in use.`);
        return;
      }
      const inUse = usage.inUse ?? [];
      const breakdown =
        inUse.length === 0
          ? `None of them are used by an entry.\n\n`
          : `${inUse.length} of ${names.length} ${inUse.length === 1 ? "is" : "are"} still used by entries ` +
            `and will be removed from them:\n` +
            `${inUse
              .slice(0, 15)
              .map((row) => `  ${row.name} — ${row.entryCount} ${row.entryCount === 1 ? "entry" : "entries"}`)
              .join("\n")}${inUse.length > 15 ? `\n  … (+${inUse.length - 15} more)` : ""}\n\n` +
            `Entries keep their history but lose the ${noun}.\n\n`;

      if (
        !window.confirm(
          `Delete ${names.length} ${names.length === 1 ? noun : plural}?\n\n${breakdown}` +
            `This cannot be undone.`,
        )
      ) {
        return;
      }

      const outcome = await deleteJournalTaxonomyAction(kind, names);
      const deletedCount = outcome.deleted ?? 0;
      const failures = outcome.failures ?? [];

      if (failures.length > 0) {
        setError(
          `Deleted ${deletedCount}; ${failures.length} failed — ` +
            failures.map((failure) => `${failure.name}: ${failure.error}`).join("; "),
        );
      } else if (!outcome.ok) {
        setError(outcome.error ?? `Failed to delete the selected ${plural}.`);
      } else {
        setCleanupResult(`Deleted ${deletedCount} ${deletedCount === 1 ? noun : plural}.`);
      }

      // Keep the ticks on exactly the names that did *not* go, so a partial
      // failure can be retried without re-finding them. Deleting nothing leaves
      // the selection entirely untouched; the `items` effect prunes whatever
      // actually went once the refresh lands.
      if (deletedCount > 0) {
        const survived = new Set(failures.map((failure) => failure.name));
        setSelected((previous) => new Set([...previous].filter((name) => survived.has(name))));
      }
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  async function handleCreate() {
    setError(undefined);
    const result = await saveAction({ name, description });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setName("");
    setDescription("");
    router.refresh();
  }

  async function handleGenerate(item: JournalCategory | JournalTag) {
    setError(undefined);
    setGenerating(item.name);
    try {
      const { error: message, cancelled } = await generateIconFor(kind, item);
      if (cancelled) return;
      if (message) setError(message);
      else router.refresh();
    } finally {
      setGenerating(undefined);
    }
  }

  /**
   * Draws an icon for every row in *this* list that hasn't got one. Missing-only,
   * so a hand-uploaded icon is never replaced by surprise — the per-row flash
   * button stays the way to overwrite one.
   */
  async function handleAutopopulate() {
    setError(undefined);
    setAutopopulateResult(undefined);
    setAutopopulating(true);
    try {
      const outcome = await generateMissingJournalIconsAction(kind);
      if (!outcome.ok) {
        setError(outcome.error ?? "Failed to generate the missing icons.");
        return;
      }
      const failed = outcome.failed ?? 0;
      setAutopopulateResult(
        `Drew ${outcome.generated ?? 0} icon${outcome.generated === 1 ? "" : "s"}` +
          (failed > 0 ? `, ${failed} could not be drawn.` : "."),
      );
      router.refresh();
    } finally {
      setAutopopulating(false);
    }
  }

  async function handleDelete(item: JournalCategory | JournalTag) {
    if (
      !window.confirm(
        `Delete "${item.name}"? Entries keep their history but lose this ${kind === "category" ? "category" : "tag"}.`,
      )
    )
      return;
    const result = await deleteAction(item.name);
    if (result.ok) {
      // Drop any tick on the row that just went, so the count above can't
      // include a name that no longer exists.
      setSelected((previous) => {
        if (!previous.has(item.name)) return previous;
        const next = new Set(previous);
        next.delete(item.name);
        return next;
      });
      router.refresh();
    } else window.alert(result.error);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* The other two writes on this card. Deleting forty tags and drawing a
          couple of hundred icons both take long enough to look like nothing
          happened. */}
      <BusyOverlay
        isBusy={deleting}
        message="Deleting…"
        detail={`Removing the selected ${plural} and detaching them from their entries.`}
      />
      <BusyOverlay
        isBusy={autopopulating}
        message="Drawing icons…"
        detail="Fetching an icon for each one that hasn't got one yet."
      />
      <h3 className="font-display text-lg text-ink">{title}</h3>
      <p className="text-sm text-muted">{helpText}</p>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} className={INPUT_CLASS} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Description</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className={INPUT_CLASS}
          />
        </label>
      </div>

      {/* Both buttons on one wrapping row: adding one by hand and filling in the
          blanks for the whole list are the two things you do from here. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={handleCreate} disabled={name.trim() === ""}>
          Add {kind === "category" ? "category" : "tag"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleAutopopulate}
          disabled={autopopulating || missingIcons === 0}
          title={
            missingIcons === 0
              ? `Every ${kind} already has an icon`
              : `Draw an icon for the ${missingIcons} with none yet, leaving existing icons alone`
          }
        >
          {autopopulating ? "Drawing…" : `Autopopulate icon for ${kind}`}
        </Button>
        {/* Finds the rows no entry uses and ticks them — it never deletes. Sits
            with the other whole-list actions rather than by the Delete button,
            because what it does is *select*, not destroy. */}
        <Button
          size="sm"
          variant="secondary"
          onClick={handleCleanUp}
          disabled={cleaning || items.length === 0}
          title={`Find ${plural} that no entry uses and tick them for review`}
        >
          {cleaning ? "Checking…" : "Clean up"}
        </Button>
        {autopopulateResult && <span className="text-sm text-muted">{autopopulateResult}</span>}
        {cleanupResult && <span className="text-sm text-muted">{cleanupResult}</span>}
      </div>

      {/* Sits directly above the list it narrows, so it reads as belonging to the
          rows rather than to the Add form above it. Only worth showing once
          there's enough to hunt through. */}
      {items.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Filter ${kind === "category" ? "categories" : "tags"} by name or description`}
            aria-label={`Filter ${kind === "category" ? "categories" : "tags"}`}
            className={`${INPUT_CLASS} max-w-sm flex-1`}
          />
          {isFiltering && (
            <span className="text-sm text-muted">
              {visibleItems.length} of {items.length}
            </span>
          )}
        </div>
      )}

      {/* Select-all plus the bulk action, on the row directly above the list it
          governs. Always present once there are rows, so the checkbox column has
          a header to line up under; the Delete button only appears with a
          selection, since a disabled button here reads as broken. */}
      {visibleItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleAllVisible}
              aria-label={`Select all ${isFiltering ? "matching " : ""}${plural}`}
              className="h-4 w-4 shrink-0 accent-brass"
            />
            Select all ({visibleItems.length})
          </label>
          {selectedVisible.length > 0 && (
            <>
              <span className="text-xs text-muted">{selectedVisible.length} selected</span>
              {/* Merge leads Delete: it is the non-destructive of the two, and
                  putting the irreversible one last makes a mis-click less
                  likely. */}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setMerging(selectedVisible.map((item) => item.name))}
                disabled={deleting}
                title={`Fold the ${selectedVisible.length} selected ${plural} into one name`}
              >
                Merge {selectedVisible.length} selected
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleDeleteSelected}
                disabled={deleting}
                className="!text-red-400"
              >
                {deleting ? "Deleting…" : `Delete ${selectedVisible.length} selected`}
              </Button>
            </>
          )}
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-muted">None yet.</p>
      ) : visibleItems.length === 0 ? (
        // Distinct from "None yet." — the list has rows, the filter just hid
        // them all, and saying so stops it reading as an empty taxonomy.
        <p className="text-sm text-muted">
          No {kind === "category" ? "categories" : "tags"} match &ldquo;{query.trim()}&rdquo;.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {visibleItems.map((item) => (
            <li
              key={item.name}
              className={`flex flex-wrap items-center gap-2 rounded-md border border-line bg-paper px-3 py-1.5 text-sm ${
                // The same marker DataGrid puts on a ticked row, so selection
                // reads the same way in both places.
                selected.has(item.name) ? "outline outline-1 -outline-offset-1 outline-brass/40" : ""
              }`}
            >
              {/* Leads the row, before the actions, so the ticks form a column
                  the select-all above lines up with. */}
              <input
                type="checkbox"
                checked={selected.has(item.name)}
                onChange={() => toggleOne(item.name)}
                aria-label={`Select ${kind} "${item.name}"`}
                className="h-4 w-4 shrink-0 accent-brass"
              />
              {/* Actions lead the row, icon-only. Each carries an aria-label and
                  a title, since the glyph is the whole control. */}
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setEditing(item)}
                  aria-label={`Edit ${kind} "${item.name}"`}
                  title="Edit"
                  className="rounded-md p-1 text-brass-dark transition-colors hover:bg-brass-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                >
                  <TreeIcon name="pencil" className="h-4 w-4" />
                </button>
                {/* Generate an icon from the name. Sits between edit and delete
                    because it edits the row rather than destroying it — and it
                    stays enabled on rows that already have an icon, since
                    replacing one is a reason to press it. */}
                <button
                  type="button"
                  onClick={() => handleGenerate(item)}
                  disabled={generating === item.name}
                  aria-label={`Generate an icon for ${kind} "${item.name}"`}
                  title={
                    item.iconMimeType
                      ? "Generate an icon from the name (replaces the current one)"
                      : "Generate an icon from the name"
                  }
                  className="rounded-md p-1 text-brass-dark transition-colors hover:bg-brass-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass disabled:opacity-40"
                >
                  <TreeIcon
                    name="flash"
                    className={`h-4 w-4 ${generating === item.name ? "animate-pulse" : ""}`}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(item)}
                  aria-label={`Delete ${kind} "${item.name}"`}
                  title="Delete"
                  className="rounded-md p-1 text-red-400 transition-colors hover:bg-red-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                >
                  <TreeIcon name="trash" className="h-4 w-4" />
                </button>
              </span>
              <TaxonomyIconThumbnail name={item.name} url={iconUrl(kind, item, item.updatedAt)} />
              {/* The name links to the filtered entry list, same as the Top
                  Tags/Categories cards on the home screen. */}
              <Link
                href={journalEntriesFilterHref(kind, item.name)}
                title={`Show entries for "${item.name}"`}
                className="text-ink hover:text-brass-dark hover:underline"
              >
                {item.name}
              </Link>
              {item.description !== "" && <span className="text-xs text-muted">{item.description}</span>}
            </li>
          ))}
        </ul>
      )}

      {merging && (
        <MergeTaxonomyModal
          kind={kind}
          sources={merging}
          onClose={() => setMerging(undefined)}
          onMerged={(message) => {
            // The merged-away rows are gone, so the ticks that named them must
            // go too; the `items` effect would prune them on refresh anyway, but
            // clearing here stops the bar flashing a stale count first.
            setMerging(undefined);
            setSelected(new Set());
            setCleanupResult(message);
            router.refresh();
          }}
        />
      )}

      {editing && (
        <EditTaxonomyModal
          kind={kind}
          item={editing}
          updatedAt={editing.updatedAt}
          onClose={() => setEditing(undefined)}
        />
      )}
    </div>
  );
}

/**
 * "Fill in the missing icons" — one click for every category and tag that hasn't
 * got one.
 *
 * Worth its own control because the per-row button doesn't scale: a real journal
 * runs to a couple of hundred tags and none of them start with an icon. Only
 * fills blanks, so a hand-uploaded icon is never replaced by surprise.
 */
function GenerateAllIconsButton({ missing }: { missing: number }) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [result, setResult] = useState<string | undefined>(undefined);

  async function handleClick() {
    setResult(undefined);
    setIsBusy(true);
    try {
      const outcome = await generateMissingJournalIconsAction();
      if (!outcome.ok) {
        setResult(outcome.error ?? "Failed to generate the missing icons.");
        return;
      }
      const failed = outcome.failed ?? 0;
      setResult(
        `Drew ${outcome.generated ?? 0} icon${outcome.generated === 1 ? "" : "s"}` +
          (failed > 0 ? `, ${failed} could not be drawn.` : "."),
      );
      router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  if (missing === 0 && result === undefined) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-paper px-4 py-3">
      <TreeIcon name="flash" className="h-5 w-5 shrink-0 text-brass-dark" />
      <p className="min-w-0 flex-1 text-sm text-ink">
        {missing > 0
          ? `${missing} categor${missing === 1 ? "y" : "ies"} and tags have no icon yet.`
          : "Every category and tag has an icon."}
        {result && <span className="ml-2 text-muted">{result}</span>}
      </p>
      {missing > 0 && (
        <Button size="sm" onClick={handleClick} disabled={isBusy}>
          {isBusy ? "Drawing…" : "Draw the missing icons"}
        </Button>
      )}
    </div>
  );
}

export function JournalTaxonomyView({
  categories,
  tags,
}: {
  categories: JournalCategory[];
  tags: JournalTag[];
}) {
  const missing = [...categories, ...tags].filter((item) => !item.iconMimeType).length;

  // One list at a time. Both panels are long — a couple of hundred tags is
  // normal — so stacking them buried Categories under a scroll. The "draw the
  // missing icons" banner stays above the strip because it covers both lists.
  return (
    <div className="flex flex-col gap-6">
      <GenerateAllIconsButton missing={missing} />
      <Tabs
        items={[
          {
            key: "category",
            label: "Category",
            content: (
              <TaxonomyPanel
                kind="category"
                title="Categories"
                helpText="Categories are created automatically when you use a new name on an entry — add one here to give it a description up front, or an icon that shows up wherever the category appears. The ⚡ button draws an icon from the name."
                items={categories}
              />
            ),
          },
          {
            key: "tag",
            label: "Tags",
            content: (
              <TaxonomyPanel
                kind="tag"
                title="Tags"
                helpText="Tags are created automatically when you use a new name on an entry — add one here to give it a description up front, or an icon that shows up wherever the tag appears. The ⚡ button draws an icon from the name."
                items={tags}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
