"use client";

// The Clips home screen: the count, the shared controls, and the clips themselves
// under two tabs — the most recent few, and everything.
//
// This is the module's one working screen. It absorbed the old "All Clips" section,
// which is why the writing, filtering and editing machinery lives here rather than
// one route further in.
//
// Filters travel as search params, parsed in the route — so a filtered board
// survives a refresh and can be bookmarked, per `modules.md` step 8. This component
// only navigates; it does not hold them as client state. `?tab=` rides along for the
// same reason, the way Journal's Entries screen already does it.
//
// The List/Board choice is NOT a search param. It is a per-device preference about
// how to look at the same rows, not part of what is being looked at — so it is
// remembered in `localStorage`, the way the Location Manager's two switches are, and
// a shared link shows the recipient their own preferred shape.

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { Tabs } from "@/components/tabs";
import { ViewModeSwitch, type ViewModeOption } from "@/components/view-mode-switch";
import type { ClipCardColor, ClipItem, ClipSummary, ClipTaxonomyItem } from "@/lib/clips";
import { ClipsBoardView } from "./clips-board-view";
import { ClipsCard } from "./clips-card";
import { ClipsColorPicker } from "./clips-color-picker";
import { ClipsEditor } from "./clips-editor";
import { ClipsViewer } from "./clips-viewer";
import {
  deleteClipAction,
  getClipAction,
  setClipColorAction,
  setClipPinnedAction,
  toggleClipItemAction,
} from "./clips-actions";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/** Where the List/Board choice is remembered, per device. */
const VIEW_MODE_KEY = "myhomebase:clips-view";

type ClipsViewMode = "board" | "list";

const VIEW_MODE_OPTIONS: readonly ViewModeOption<ClipsViewMode>[] = [
  { key: "board", label: "Board", hint: "Cards in balanced columns" },
  { key: "list", label: "List", hint: "One card per row" },
];

/**
 * How many clips the Most Recent tab shows.
 *
 * A glance, not a list — six is what the screen showed before the merge, and the
 * number that fills a row or two of cards without becoming the other tab.
 */
const RECENT_COUNT = 6;

/** The two tabs, as they appear in `?tab=`. */
const RECENT_TAB = "recent";
const ALL_TAB = "all";

export interface ClipsMainViewProps {
  clips: ClipSummary[];
  categories: ClipTaxonomyItem[];
  tags: ClipTaxonomyItem[];
  search: string;
  category: string;
  tag: string;
  /** From `?tab=`. Anything unrecognised opens on Most Recent, the first tab. */
  initialTab?: string;
}

export function ClipsMainView({
  clips,
  categories,
  tags,
  search,
  category,
  tag,
  initialTab,
}: ClipsMainViewProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [writing, setWriting] = useState(false);
  const [editing, setEditing] = useState<number | undefined>(undefined);
  const [viewing, setViewing] = useState<number | undefined>(undefined);
  const [searchText, setSearchText] = useState(search);
  const [recolouring, setRecolouring] = useState<number | undefined>(undefined);

  // Board is the default, and the stored choice is read AFTER mount rather than
  // during render: `localStorage` does not exist on the server, so reading it in the
  // initial state would render one thing on the server and another in the browser.
  const [viewMode, setViewMode] = useState<ClipsViewMode>("board");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(VIEW_MODE_KEY);
      // The stored choice is unknowable during render; one extra render is the
      // price of correct hydration. Runs once on mount and never re-fires — the
      // same pattern, and the same reason, as Admin → Locations → Location Manager.
      if (stored === "board" || stored === "list") {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- see above.
        setViewMode(stored);
      }
    } catch {
      // A browser with storage blocked still gets a working board — the choice
      // simply does not persist. Never a reason to fail to draw the screen.
    }
  }, []);

  function chooseViewMode(mode: ClipsViewMode) {
    setViewMode(mode);
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // As above.
    }
  }

  /** Rewrites one search param, dropping it when it is cleared. */
  function navigate(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === "") next.delete(key);
    else next.set(key, value);
    router.push(`?${next.toString()}`);
  }

  async function handleDelete(id: number) {
    // Recoverable since migration 0161: this moves the clip to Recycled Clips
    // rather than destroying it. The confirmation stays — a clip vanishing from
    // the board without a word is still a surprise — but it no longer claims the
    // delete is final, because it isn't.
    if (!confirm("Delete this clip? You can restore it from Recycled Clips.")) return;
    await deleteClipAction(id);
    router.refresh();
  }

  async function handleTogglePin(id: number, isPinned: boolean) {
    await setClipPinnedAction(id, isPinned);
    // Refreshed rather than updated in place: pinning changes the clip's *position*
    // (the band it sits in, and the order within it), which is the server's answer
    // to give. A local flip would redraw the pin and leave the card where it was.
    router.refresh();
  }

  async function handleRecolour(id: number, color: string) {
    setRecolouring(undefined);
    await setClipColorAction(id, color);
    router.refresh();
  }

  async function handleToggleItem(itemId: number, isDone: boolean) {
    // No refresh: the card has already shown the tick optimistically, and the action
    // deliberately does not revalidate — see `toggleClipItemAction`.
    await toggleClipItemAction(itemId, isDone);
  }

  const recolouringClip =
    recolouring === undefined ? undefined : clips.find((clip) => clip.id === recolouring);

  // The filter box and the taxonomy chips sit ABOVE the tabs and narrow both of
  // them, so "most recent" under an active filter means the newest few *matches*.
  // That is said out loud in the tab rather than left to be discovered — see the
  // note rendered inside it.
  const isFiltered = search !== "" || category !== "" || tag !== "";
  const recent = clips.slice(0, RECENT_COUNT);

  /** Draws one clip, wired for editing in place. Shared by both tabs' boards. */
  function clipHandlers() {
    return {
      onOpen: setViewing,
      onEdit: setEditing,
      onDelete: (id: number) => void handleDelete(id),
      onTogglePin: (id: number, isPinned: boolean) => void handleTogglePin(id, isPinned),
      onToggleItem: (itemId: number, isDone: boolean) => void handleToggleItem(itemId, isDone),
      onRecolour: setRecolouring,
    };
  }

  function renderClips(rows: ClipSummary[]) {
    return viewMode === "board" ? (
      <ClipsBoardView clips={rows} {...clipHandlers()} />
    ) : (
      <ClipsListView clips={rows} {...clipHandlers()} />
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Clips kept</p>
        <p className="font-display text-xl text-ink">{clips.length}</p>
      </div>

      {/* Open by default: locating a clip quickly is what this screen is for, and a
          search box one click away is a search box most readers never find. */}
      <CollapsibleCard title="Filtering" defaultOpen>
        <div className="space-y-3">
          <div>
            <label htmlFor="clip-search" className="mb-1 block text-sm font-medium text-ink">
              Search
            </label>
            <div className="flex gap-2">
              <input
                id="clip-search"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") navigate("search", searchText);
                }}
                placeholder="Title or body text"
                className={INPUT_CLASS}
              />
              <Button variant="secondary" onClick={() => navigate("search", searchText)}>
                Search
              </Button>
            </div>
            {/* Said plainly rather than left to be discovered: a sealed clip's title
                and body are ciphertext, so no text search can reach inside them. */}
            <p className="mt-1 text-xs text-muted">
              Encrypted clips are not searched by text — find them by category or tag.
            </p>
          </div>

          <TaxonomyFilter
            label="Category"
            items={categories}
            selected={category}
            onSelect={(name) => navigate("category", name)}
          />
          <TaxonomyFilter
            label="Tag"
            items={tags}
            selected={tag}
            onSelect={(name) => navigate("tag", name)}
          />
        </div>
      </CollapsibleCard>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {!writing && editing === undefined ? (
          <Button variant="primary" onClick={() => setWriting(true)}>
            Write a clip
          </Button>
        ) : (
          <span />
        )}

        <ViewModeSwitch
          options={VIEW_MODE_OPTIONS}
          value={viewMode}
          onChange={chooseViewMode}
          label="View"
        />
      </div>

      {writing && (
        <CollapsibleCard title="New clip">
          <ClipsEditor
            categoryOptions={categories.map((item) => item.name)}
            tagOptions={tags.map((item) => item.name)}
            onSaved={() => {
              setWriting(false);
              router.refresh();
            }}
            onCancel={() => setWriting(false)}
          />
        </CollapsibleCard>
      )}

      {recolouringClip && (
        <CollapsibleCard title={`Colour — ${recolouringClip.title || "(untitled)"}`} defaultOpen>
          <ClipsColorPicker
            value={recolouringClip.color}
            onChange={(color) => void handleRecolour(recolouringClip.id, color)}
          />
        </CollapsibleCard>
      )}

      {/* Uncontrolled: `?tab=` seeds which one opens, but clicking a tab does not
          push a new URL. Pushing would put a history entry between the reader and
          the back button for what is a way of looking at one screen, not a
          different screen — the same reasoning the List/Board switch follows. */}
      <Tabs
        defaultActiveKey={initialTab === ALL_TAB ? ALL_TAB : RECENT_TAB}
        items={[
          {
            key: RECENT_TAB,
            label: "Most Recent",
            content:
              clips.length === 0 ? (
                <p className="text-sm text-muted">
                  {isFiltered
                    ? "No clips match those filters."
                    : "Nothing yet. Write a clip to start."}
                </p>
              ) : (
                <div className="space-y-3">
                  {isFiltered && (
                    // The filters above narrow this tab too, so "most recent" is
                    // really "most recent match". Saying so costs one line and
                    // stops the tab quietly meaning something else.
                    <p className="text-xs text-muted">
                      The newest {RECENT_COUNT} of the {clips.length} matching the filters above.
                    </p>
                  )}
                  {renderClips(recent)}
                </div>
              ),
          },
          {
            key: ALL_TAB,
            label: "All clips",
            content: renderClips(clips),
          },
        ]}
      />

      {viewing !== undefined && (
        <ClipsViewer clipId={viewing} onClose={() => setViewing(undefined)} />
      )}

      {editing !== undefined && (
        <CollapsibleCard title="Edit clip">
          <ClipsEditorLoader
            clipId={editing}
            categories={categories.map((item) => item.name)}
            tags={tags.map((item) => item.name)}
            onDone={() => {
              setEditing(undefined);
              router.refresh();
            }}
          />
        </CollapsibleCard>
      )}
    </div>
  );
}

/**
 * The list shape: the same cards, one per row, with a pinned band.
 *
 * It draws `ClipsCard` rather than its own markup so the two views cannot drift into
 * different chips or a different pin — they are two *layouts* of one card, which is
 * exactly what `ViewModeSwitch` is for.
 *
 * One column on a phone, two on a wide screen. `max-lg:` is not needed because the
 * single column IS the base and `lg:` adds the second — the direction design.md asks
 * for, so a wide screen cannot regress.
 */
function ClipsListView({
  clips,
  onOpen,
  onEdit,
  onDelete,
  onTogglePin,
  onToggleItem,
  onRecolour,
}: {
  clips: ClipSummary[];
  onOpen: (id: number) => void;
  onEdit: (id: number) => void;
  onDelete: (id: number) => void;
  onTogglePin: (id: number, isPinned: boolean) => void;
  onToggleItem: (itemId: number, isDone: boolean) => void;
  onRecolour: (id: number) => void;
}) {
  if (clips.length === 0) return <p className="text-sm text-muted">No clips yet.</p>;

  const pinned = clips.filter((clip) => clip.isPinned);
  const rest = clips.filter((clip) => !clip.isPinned);

  function grid(rows: ClipSummary[]) {
    return (
      <ul className="grid gap-3 lg:grid-cols-2">
        {rows.map((clip) => (
          <li key={clip.id}>
            <ClipsCard
              clip={clip}
              onOpen={onOpen}
              onEdit={clip.isEncrypted ? undefined : onEdit}
              onDelete={onDelete}
              onTogglePin={onTogglePin}
              onToggleItem={onToggleItem}
              onRecolour={onRecolour}
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-6">
      {pinned.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Pinned</h2>
          {grid(pinned)}
        </section>
      )}
      {rest.length > 0 && (
        <section>
          {pinned.length > 0 && (
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Others</h2>
          )}
          {grid(rest)}
        </section>
      )}
    </div>
  );
}

/** A row of chips over one taxonomy, with the chosen one highlighted. */
function TaxonomyFilter({
  label,
  items,
  selected,
  onSelect,
}: {
  label: string;
  items: ClipTaxonomyItem[];
  selected: string;
  onSelect: (name: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div>
      <p className="mb-1 text-sm font-medium text-ink">{label}</p>
      <div className="flex flex-wrap gap-1">
        {items.map((item) => (
          <button
            key={item.name}
            type="button"
            // Clicking the chosen chip clears it — the only way back to "all"
            // without a separate Clear button.
            onClick={() => onSelect(selected === item.name ? "" : item.name)}
            className={`rounded-full border px-2.5 py-1 text-xs ${
              selected === item.name
                ? "border-brass bg-brass/10 text-ink"
                : "border-line text-muted hover:text-ink"
            }`}
          >
            {item.name}
            <span className="ml-1 opacity-60">{item.usageCount}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Fetches one clip's full record, then hands it to the editor.
 *
 * The list carries summaries — deliberate projections with no body — so an editor
 * must fetch the full record rather than being handed a row. Editing from a summary
 * would save a clip whose body had been truncated to its excerpt.
 */
function ClipsEditorLoader({
  clipId,
  categories,
  tags,
  onDone,
}: {
  clipId: number;
  categories: string[];
  tags: string[];
  onDone: () => void;
}) {
  const [loaded, setLoaded] = useState<
    {
      title: string;
      contentHtml: string;
      categories: string[];
      tags: string[];
      color: ClipCardColor | "";
      items: ClipItem[];
    } | undefined
  >(undefined);
  const [error, setError] = useState("");

  // In an effect, not during render: a fetch in the render body runs again on every
  // re-render — including the ones its own setState causes — which is an endless
  // request loop. `cancelled` guards the late response when the reader closes the
  // editor mid-flight, so a setState never lands on an unmounted component.
  useEffect(() => {
    let cancelled = false;

    void getClipAction(clipId).then((result) => {
      if (cancelled) return;
      if (result.ok && result.clip) {
        setLoaded({
          title: result.clip.title,
          contentHtml: result.clip.contentHtml,
          categories: result.clip.categories,
          tags: result.clip.tags,
          color: result.clip.color,
          items: result.items ?? [],
        });
      } else {
        setError(result.error ?? "Could not load that clip.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [clipId]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!loaded) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <ClipsEditor
      clipId={clipId}
      initialTitle={loaded.title}
      initialContentHtml={loaded.contentHtml}
      initialCategories={loaded.categories}
      initialTags={loaded.tags}
      initialColor={loaded.color}
      initialItems={loaded.items}
      categoryOptions={categories}
      tagOptions={tags}
      onSaved={onDone}
      onCancel={onDone}
    />
  );
}
