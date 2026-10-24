"use client";

// All Clips: the filter block, the list, and the write/edit panel.
//
// Filters travel as search params, parsed in the route — so a filtered list
// survives a refresh and can be bookmarked, per `modules.md` step 8. This component
// only navigates; it does not hold them as client state.

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { TreeIcon } from "@/components/tree-icons";
import type { ClipSummary, ClipTaxonomyItem } from "@/lib/clips";
import { ClipsEditor } from "./clips-editor";
import { ClipsViewer } from "./clips-viewer";
import { deleteClipAction, getClipAction } from "./clips-actions";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export interface ClipsAllViewProps {
  clips: ClipSummary[];
  categories: ClipTaxonomyItem[];
  tags: ClipTaxonomyItem[];
  search: string;
  category: string;
  tag: string;
}

export function ClipsAllView({
  clips,
  categories,
  tags,
  search,
  category,
  tag,
}: ClipsAllViewProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [writing, setWriting] = useState(false);
  const [editing, setEditing] = useState<number | undefined>(undefined);
  const [viewing, setViewing] = useState<number | undefined>(undefined);
  const [searchText, setSearchText] = useState(search);

  /** Rewrites one search param, dropping it when it is cleared. */
  function navigate(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === "") next.delete(key);
    else next.set(key, value);
    router.push(`?${next.toString()}`);
  }

  async function handleDelete(id: number) {
    // A clip is the only copy of whatever was pasted into it, and deleting is the
    // one irreversible thing here — there is no recycle bin for clips.
    if (!confirm("Delete this clip? This cannot be undone.")) return;
    await deleteClipAction(id);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <CollapsibleCard title="Filtering" defaultOpen={false}>
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

      {!writing && editing === undefined && (
        <Button variant="primary" onClick={() => setWriting(true)}>
          Write a clip
        </Button>
      )}

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

      {clips.length === 0 ? (
        <p className="text-sm text-muted">No clips yet.</p>
      ) : (
        // One column on a phone, two on a wide screen. `max-lg:` is not needed
        // here because the single column IS the base and `lg:` adds the second —
        // the direction design.md asks for, so a wide screen cannot regress.
        <ul className="grid gap-3 lg:grid-cols-2">
          {clips.map((clip) => (
            <li
              key={clip.id}
              className="rounded-xl border border-line bg-paper-raised p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display text-base text-ink">
                  {clip.title || "(untitled)"}
                </h3>
                {/* A bare glyph, not a slot: this is a STATE mark ("this clip is
                    sealed"), and coding-guide.md keeps state glyphs and row actions
                    off the slot registry. Only icons that mark a *place* get a slot. */}
                {clip.isEncrypted && (
                  <TreeIcon name="lock" className="h-4 w-4 shrink-0 text-muted" />
                )}
              </div>

              {clip.excerpt && <p className="mt-1 text-sm text-muted">{clip.excerpt}</p>}

              <div className="mt-2 flex flex-wrap gap-1 text-xs text-muted">
                {[...clip.categories, ...clip.tags].map((name) => (
                  <span key={name} className="rounded border border-line px-1.5 py-0.5">
                    {name}
                  </span>
                ))}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
                {clip.imageCount > 0 && (
                  <span>
                    {clip.imageCount} image{clip.imageCount === 1 ? "" : "s"}
                  </span>
                )}
                {clip.linkCount > 0 && (
                  <span>
                    attached to {clip.linkCount} entr{clip.linkCount === 1 ? "y" : "ies"}
                  </span>
                )}
              </div>

              <div className="mt-3 flex gap-2">
                <Button variant="secondary" onClick={() => setViewing(clip.id)}>
                  Open
                </Button>
                {!clip.isEncrypted && (
                  <Button variant="secondary" onClick={() => setEditing(clip.id)}>
                    Edit
                  </Button>
                )}
                <Button variant="danger" onClick={() => handleDelete(clip.id)}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

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
    { title: string; contentHtml: string; categories: string[]; tags: string[] } | undefined
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
      categoryOptions={categories}
      tagOptions={tags}
      onSaved={onDone}
      onCancel={onDone}
    />
  );
}
