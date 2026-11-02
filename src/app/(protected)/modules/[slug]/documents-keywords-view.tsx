"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { TaxonomyChipRow } from "@/components/taxonomy-icon";
// Imported from the leaf modules, NOT from `@/lib/documents`. This is a client
// component, and the module's barrel re-exports the repository and the file store --
// which pull in `better-sqlite3` and `node:fs/promises`, neither of which can be
// bundled for a browser. Same reason `documents-main-view.tsx` imports this way.
import { formatBytes } from "@/lib/documents/schema";
import type { DocumentKeyword } from "@/lib/documents/keywords";
import type { DocumentSummary, DocumentTaxonomyItem } from "@/lib/documents/types";
import { PAGE_CONTAINER } from "../../page-container";
import { documentsEditorHref } from "./documents-sections";
import { ignoreKeywordAction, restoreKeywordAction } from "./documents-keyword-actions";

/**
 * The served URL for one taxonomy icon, or `undefined` when none was uploaded.
 *
 * `?v=` is the cache-buster the icon routes need: they send `max-age=300`, so without
 * it a replaced picture would keep showing for five minutes. Keyed lower-case, since
 * the taxonomy tables are `COLLATE NOCASE`.
 *
 * A third copy of a lookup the main view and the tree view each already hold privately.
 * Left as a copy rather than extracted into a shared module: it is six lines, the two
 * existing ones are working and untouched by this change, and refactoring two live
 * screens to add a third was not what this build was asked to do. If a fourth appears,
 * that is the moment to pull all four into one place.
 */
function iconUrls(
  items: DocumentTaxonomyItem[],
  segment: "categories" | "tags",
): Map<string, string> {
  const urls = new Map<string, string>();
  for (const item of items) {
    if (!item.hasIcon) continue;
    urls.set(
      item.name.toLowerCase(),
      `/api/documents/${segment}/${encodeURIComponent(item.name)}/icon?v=${encodeURIComponent(item.updatedAt)}`,
    );
  }
  return urls;
}

// Documents → Keywords. What words the library contains, and the documents behind one.
//
// The third way into the library, after the grid and the tree, and the only one that
// needs no prior knowledge: the grid wants a title, the tree wants a category, this
// hands back the vocabulary and lets the reader recognise something.
//
// ## Two panes, one selection, and where the state lives
//
// The keyword list is the left pane and the matching documents are the right. The
// selected keyword rides in the URL (`?keyword=`), not in `useState`, for the reason
// every other filter on this module does: it survives a refresh, it can be linked, and
// the back button steps through what the reader looked at. The *filter box* over the
// keyword list is the opposite — see its note below.
//
// Narrow: the two panes stack (`max-lg:flex-col`), the same fork the tree screen takes.
// `DataGrid` handles its own compact card layout at 1024px, so neither pane needs a
// narrow variant of its own.

export function DocumentsKeywordsView({
  keywords,
  totalWords,
  documentsScanned,
  scanLimited,
  selectedKeyword,
  matchingDocuments,
  ignoredKeywords,
  categories,
  tags,
}: {
  keywords: DocumentKeyword[];
  /** Distinct words found before the limit — what the heading counts. */
  totalWords: number;
  documentsScanned: number;
  /** True when the scan cap bound, so the list describes part of the library. */
  scanLimited: boolean;
  /** From `?keyword=`, or `""` when nothing is picked yet. */
  selectedKeyword: string;
  /** The documents containing `selectedKeyword`, empty when none is picked. */
  matchingDocuments: DocumentSummary[];
  /** Words the household has dismissed, already normalized and in force. */
  ignoredKeywords: string[];
  categories: DocumentTaxonomyItem[];
  tags: DocumentTaxonomyItem[];
}) {
  const router = useRouter();

  const categoryIcons = iconUrls(categories, "categories");
  const tagIcons = iconUrls(tags, "tags");

  /**
   * The filter box, held in client state rather than the URL.
   *
   * Deliberately different from the selected keyword beside it. This narrows a list
   * that is **already on the page** — every keyword was fetched with the screen — so
   * filtering it needs no server round trip and no navigation. Putting it in the URL
   * would mean a route change per keystroke to re-render rows the browser already has.
   *
   * The selected keyword goes in the URL because picking one *does* need the server:
   * it fetches the matching documents.
   */
  const [filter, setFilter] = useState("");

  /**
   * Which word is in flight, so its control can show it. One at a time: the server
   * re-ranks on every change, so a second click before the first lands would be acting
   * on a list that is about to be replaced. The Journal's Top Words does the same.
   */
  const [pendingWord, setPendingWord] = useState<string | undefined>(undefined);
  const [wordError, setWordError] = useState<string | undefined>(undefined);

  /** Whether the ignored strip is open. Closed by default — it is a correction tool. */
  const [showIgnored, setShowIgnored] = useState(false);

  async function changeIgnored(word: string, ignore: boolean): Promise<void> {
    setPendingWord(word);
    setWordError(undefined);
    try {
      const result = ignore
        ? await ignoreKeywordAction(word)
        : await restoreKeywordAction(word);
      if (!result.ok) {
        setWordError(
          result.error ?? `Failed to ${ignore ? "ignore" : "restore"} "${word}".`,
        );
        return;
      }
      // The ranking is computed on the server from every document's text, so the new
      // list arrives by re-rendering rather than by patching this one. The action's
      // `revalidatePath` invalidates it; this asks for the render.
      //
      // A dismissed word that is also the selected one would leave the right pane
      // showing documents for a word no longer in the list, so the selection is
      // cleared in the same navigation rather than left dangling.
      if (ignore && word === selectedKeyword) selectKeyword("");
      else router.refresh();
    } finally {
      setPendingWord(undefined);
    }
  }

  const visibleKeywords = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle === "") return keywords;
    // A substring match, not a prefix one: a reader filtering for `surance` is looking
    // for `insurance` and would be puzzled to find nothing.
    return keywords.filter((row) => row.word.includes(needle));
  }, [keywords, filter]);

  function selectKeyword(word: string): void {
    const params = new URLSearchParams();
    if (word !== "") params.set("keyword", word);
    const query = params.toString();
    router.push(`/modules/documents/keywords${query === "" ? "" : `?${query}`}`);
  }

  const keywordColumns: DataGridColumn<DocumentKeyword>[] = [
    {
      key: "word",
      header: "Keyword",
      value: (row) => row.word,
      render: (row) => (
        <span className="flex items-center gap-1.5">
          {/*
            The quick-ignore mark sits beside the word it acts on, so there is no
            separate action column to scan across to. A bare button rather than
            `Button`: that is a pill with a fill, and this is meant to be a small
            glyph that stays out of the way until wanted.

            `stopPropagation` is load-bearing: the row itself is clickable (it opens
            this word's documents), so without it ignoring a word would also select
            it, and the right pane would flash a word that is about to vanish.
          */}
          <button
            type="button"
            disabled={pendingWord !== undefined}
            // The glyph alone gives a screen reader nothing to read, so the accessible
            // name carries the word as well as the verb.
            aria-label={`Stop ranking "${row.word}"`}
            title={`Stop ranking "${row.word}"`}
            onClick={(event) => {
              event.stopPropagation();
              void changeIgnored(row.word, true);
            }}
            className="shrink-0 rounded px-1 text-xs font-bold leading-none text-red-400 hover:bg-red-400/15 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:pointer-events-none disabled:opacity-40"
          >
            {pendingWord === row.word ? "…" : "✕"}
          </button>
          <span className={row.word === selectedKeyword ? "font-semibold text-ink" : "text-ink"}>
            {row.word}
          </span>
        </span>
      ),
    },
    {
      key: "documentCount",
      header: "Documents",
      value: (row) => row.documentCount,
      // The default sort and the figure the screen leads with: "appears in 7
      // documents" is what a reader wants when the goal is to find documents.
      hint: "How many documents contain this word at least once.",
      render: (row) => row.documentCount.toLocaleString(),
      className: "text-right tabular-nums",
    },
    {
      key: "occurrences",
      header: "Uses",
      value: (row) => row.occurrences,
      // The second figure, which answers a different question — a word used 40 times
      // across 2 documents is a letterhead, 40 across 38 is a subject.
      hint: "Total times the word is used, counting repeats within one document.",
      render: (row) => row.occurrences.toLocaleString(),
      className: "text-right tabular-nums",
    },
  ];

  const documentColumns: DataGridColumn<DocumentSummary>[] = [
    {
      key: "title",
      header: "Title",
      value: (row) => row.title,
      // The cell draws the description under the title, so the search box has to see
      // it too — otherwise a word the reader is looking straight at finds nothing. It
      // stays out of `value` so Title still sorts and exports as the title alone.
      searchValue: (row) => row.description,
      render: (row) => (
        <div className="flex flex-col">
          <span className="text-ink">{row.title}</span>
          {row.description !== "" && (
            <span className="text-xs text-muted">{row.description}</span>
          )}
        </div>
      ),
    },
    {
      key: "categories",
      header: "Categories",
      value: (row) => row.categories.join(", "),
      // `url` is looked up from the taxonomy lists — a chip with no uploaded icon
      // gets `undefined` and draws its fallback, which `TaxonomyChipRow` handles.
      render: (row) => (
        <TaxonomyChipRow
          items={row.categories.map((name) => ({ name, url: categoryIcons.get(name.toLowerCase()) }))}
        />
      ),
    },
    {
      key: "tags",
      header: "Tags",
      value: (row) => row.tags.join(", "),
      render: (row) => (
        <TaxonomyChipRow
          items={row.tags.map((name) => ({ name, url: tagIcons.get(name.toLowerCase()) }))}
        />
      ),
    },
    {
      key: "files",
      header: "Files",
      value: (row) => row.attachmentCount,
      render: (row) => (
        <span className="text-xs text-muted">
          {row.attachmentCount} · {formatBytes(row.totalBytes)}
        </span>
      ),
      className: "text-right",
    },
    {
      key: "actions",
      header: "",
      // An action column is not part of the record, so it stays out of the modal.
      excludeFromRecordView: true,
      render: (row) => (
        <Button size="sm" variant="secondary" href={documentsEditorHref(row.id)}>
          Open
        </Button>
      ),
    },
  ];

  return (
    <div className={PAGE_CONTAINER}>
      {/* Side by side on desktop, stacked below 1024px — the tree screen's split. */}
      <div className="flex gap-4 max-lg:flex-col">
        <section className="flex shrink-0 flex-col gap-2 lg:w-96">
          <div className="flex flex-col gap-1">
            <p className="text-sm text-muted">
              {totalWords.toLocaleString()} word{totalWords === 1 ? "" : "s"} across{" "}
              {documentsScanned.toLocaleString()} document
              {documentsScanned === 1 ? "" : "s"}
              {keywords.length < totalWords && `, showing the top ${keywords.length.toLocaleString()}`}
              .
            </p>
            {/*
              Said out loud rather than quietly under-reporting. A capped scan means
              the ranking describes the most recently indexed files rather than the
              whole library, and a reader comparing a count here against a search
              result would otherwise have no way to account for the difference.
            */}
            {scanLimited && (
              <p className="text-xs text-amber-300">
                This library is large enough that only the most recently indexed files
                were counted, so these totals are a lower bound.
              </p>
            )}
          </div>

          {/*
            The filter box. Narrows the fetched list as you type — no navigation, no
            round trip. `type="search"` so a phone keyboard offers the right return
            key and the browser draws its own clear affordance.
          */}
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter keywords"
            aria-label="Filter keywords"
            className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-muted"
          />

          {/* Whatever went wrong with the last ignore or restore, above both lists. */}
          {wordError && <p className="text-sm text-red-400">{wordError}</p>}

          {/*
            The ignored words, and the only way to get one back.

            Collapsed by default and absent entirely when the list is empty: it is a
            correction tool, not something to read, and an always-open empty box on a
            screen whose point is the ranking would be furniture. The count is on the
            summary so it is answerable without opening anything.
          */}
          {ignoredKeywords.length > 0 && (
            <details
              open={showIgnored}
              onToggle={(event) => setShowIgnored(event.currentTarget.open)}
              className="rounded-md border border-line bg-paper-raised px-3 py-2"
            >
              <summary className="cursor-pointer text-sm text-muted">
                Ignored words ({ignoredKeywords.length})
              </summary>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {ignoredKeywords.map((word) => (
                  <Button
                    key={word}
                    size="sm"
                    variant="secondary"
                    disabled={pendingWord !== undefined}
                    title={`Rank "${word}" again`}
                    ariaLabel={`Rank "${word}" again`}
                    onClick={() => void changeIgnored(word, false)}
                  >
                    {word} {pendingWord === word ? "…" : "✕"}
                  </Button>
                ))}
              </div>
            </details>
          )}

          <DataGrid
            columns={keywordColumns}
            rows={visibleKeywords}
            getRowKey={(row) => row.word}
            storageKey="documents-keywords-list"
            // The grid's own search box is off: the filter box above is this list's
            // search, and two boxes narrowing the same rows would be two things to
            // learn and a question about which one wins.
            enableSearch={false}
            // A keyword row is a word and two numbers. There is no record behind it
            // to open, and a column picker over three columns is chrome.
            enableRecordView={false}
            enableColumnPicker={false}
            enableColumnFilters={false}
            defaultPageSize={50}
            exportFileName="documents-keywords"
            emptyMessage={
              keywords.length === 0
                ? "No keywords yet. Index some files to see what they contain."
                : "No keyword matches that filter."
            }
            onRowClick={(row) => selectKeyword(row.word)}
          />
        </section>

        <section className="flex min-w-0 flex-1 flex-col gap-2">
          {selectedKeyword === "" ? (
            // The resting state of the right pane. An empty grid with a "no rows"
            // message would read as "nothing matched", which is a different and
            // discouraging claim — nothing has been asked yet.
            <div className="rounded-md border border-line bg-paper-raised p-6 text-center text-sm text-muted">
              Pick a keyword to see the documents that contain it.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-lg text-ink">
                  {matchingDocuments.length.toLocaleString()} document
                  {matchingDocuments.length === 1 ? "" : "s"} containing “{selectedKeyword}”
                </h2>
                <Button size="sm" variant="secondary" onClick={() => selectKeyword("")}>
                  Clear
                </Button>
              </div>

              <DataGrid
                columns={documentColumns}
                rows={matchingDocuments}
                getRowKey={(row) => row.id}
                storageKey="documents-keywords-matches"
                exportFileName={`documents-${selectedKeyword}`}
                emptyMessage="No documents contain that keyword."
                onRowClick={(row) => router.push(documentsEditorHref(row.id))}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
