"use client";

// The home screen's heading row plus its entry search. A small search-glass
// icon sits right next to the section title, always visible; clicking it
// reveals an inline input under the heading. Submitting searches the full
// journal text via the server action and shows a 3-column result grid —
// date/time, title, content — with the keyword highlighted and rows opening
// the entry. Pure presentation plus one server-action call: the grid and
// navigation belong to the route, so this stays route-local rather than a
// registered component.

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import type { JournalEntry } from "@/lib/journal";
import { searchJournalEntriesAction } from "./journal-actions";
import { JournalNewEntryProvider, useJournalNewEntry } from "./journal-new-entry-context";

// Shared form-input styling from design.md (mirrors journal-import-view).
const SEARCH_INPUT_CLASS =
  "min-w-0 flex-1 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

// Hand-rolled stroke icons, matching the codebase's small inline-glyph pattern
// (see RecordViewIcon in data-grid.tsx) — no icon-package runtime dependency.
function SearchIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

// A new journal entry: a notebook with a spine, and a plus in the open page.
// `TreeIcon` has `plus` and `quote` but neither reads as "new journal" alone,
// and this is the only place that needs the combination.
function NewJournalIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* The cover, and the spine rule a notebook is bound along. */}
      <path d="M5 4a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" />
      <line x1="9" y1="3" x2="9" y2="21" />
      {/* The plus, centred in the page beside the spine. */}
      <line x1="14.5" y1="9" x2="14.5" y2="15" />
      <line x1="11.5" y1="12" x2="17.5" y2="12" />
    </svg>
  );
}

/**
 * Renders `text` with every case-insensitive occurrence of `term` wrapped in a
 * highlighted <mark>, so a reader sees *where* the keyword hit at a glance.
 * Blank terms or text pass through unchanged.
 */
function HighlightedText({ text, term }: { text: string; term: string }) {
  const needle = term.trim();
  if (needle === "" || text === "") return <>{text}</>;

  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let index = lowerText.indexOf(lowerNeedle);
  let key = 0;

  while (index !== -1) {
    if (index > cursor) parts.push(<span key={key++}>{text.slice(cursor, index)}</span>);
    parts.push(
      <mark key={key++} className="rounded-sm bg-brass-soft px-0.5 font-semibold text-brass-dark">
        {text.slice(index, index + needle.length)}
      </mark>,
    );
    cursor = index + needle.length;
    index = lowerText.indexOf(lowerNeedle, cursor);
  }
  if (cursor < text.length) parts.push(<span key={key++}>{text.slice(cursor)}</span>);
  return <>{parts}</>;
}

function buildColumns(term: string): DataGridColumn<JournalEntry>[] {
  return [
    {
      key: "date-time",
      header: "Date / time",
      value: (entry) => `${entry.date}${entry.time !== "" ? ` ${entry.time}` : ""}`,
      render: (entry) => (
        <span className="font-mono text-xs text-ink">
          <HighlightedText text={entry.date} term={term} />
          {entry.time !== "" && (
            <span className="text-muted">
              {" · "}
              <HighlightedText text={entry.time} term={term} />
            </span>
          )}
        </span>
      ),
    },
    {
      key: "title",
      header: "Title",
      value: (entry) => entry.title,
      render: (entry) =>
        entry.title !== "" ? (
          <span className="text-sm font-medium text-ink">
            <HighlightedText text={entry.title} term={term} />
          </span>
        ) : (
          <span className="text-sm text-muted">(no title)</span>
        ),
    },
    {
      key: "content",
      header: "Content",
      value: (entry) => entry.content,
      render: (entry) =>
        entry.content !== "" ? (
          // Clamped so a long entry doesn't explode the row; the highlight still
          // shows where the keyword matched.
          <div className="line-clamp-3 max-w-[52ch] whitespace-pre-wrap break-words text-xs leading-relaxed text-muted">
            <HighlightedText text={entry.content} term={term} />
          </div>
        ) : (
          <span className="text-xs text-muted">—</span>
        ),
    },
  ];
}

// Both round icon buttons in the title row wear this.
const HEADER_ICON_BUTTON_CLASS =
  "flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-brass-soft hover:text-brass-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/**
 * The home screen's heading row, and the section body beneath it.
 *
 * It takes the body as `children` so it can own the New Journal card's
 * open/closed state: the button lives up here in the title row and the card
 * lives down in `JournalView`. The state reaches the card through
 * `JournalNewEntryProvider` rather than a prop, because `children` arrives
 * already rendered from a server component.
 */
export function JournalHomeHeader({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <JournalNewEntryProvider>
      <JournalHomeHeaderInner label={label} description={description} />
      {children}
    </JournalNewEntryProvider>
  );
}

function JournalHomeHeaderInner({ label, description }: { label: string; description: string }) {
  const router = useRouter();
  const { isOpen: isNewEntryOpen, setIsOpen: setIsNewEntryOpen } = useJournalNewEntry();
  const [isOpen, setIsOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<JournalEntry[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // The input only exists once the panel is open, so focus it after the reveal.
  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    const query = term.trim();
    if (query === "") return;
    setIsBusy(true);
    setError(undefined);
    try {
      const result = await searchJournalEntriesAction(query);
      if (!result.ok) {
        setError(result.error);
        setResults(undefined);
        return;
      }
      setResults(result.entries ?? []);
    } finally {
      setIsBusy(false);
    }
  }

  function handleClear() {
    setTerm("");
    setResults(undefined);
    setError(undefined);
    inputRef.current?.focus();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-2xl font-semibold text-ink">{label}</h2>
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          aria-label={isOpen ? "Hide journal search" : "Search journal entries"}
          title="Search journal entries"
          aria-expanded={isOpen}
          className={HEADER_ICON_BUTTON_CLASS}
        >
          <SearchIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setIsNewEntryOpen(!isNewEntryOpen)}
          aria-label={isNewEntryOpen ? "Hide the new entry form" : "New entry"}
          title="New entry"
          aria-expanded={isNewEntryOpen}
          className={HEADER_ICON_BUTTON_CLASS}
        >
          <NewJournalIcon className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1 text-sm text-muted">{description}</p>
      <div className="mt-3 h-px w-full bg-line" />

      {isOpen && (
        <form onSubmit={handleSearch} className="mt-6 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search titles, content, categories, tags, or places…"
              aria-label="Search journal entries"
              className={SEARCH_INPUT_CLASS}
            />
            <Button type="submit" disabled={isBusy || term.trim() === ""}>
              {isBusy ? "Searching…" : "Search"}
            </Button>
            <Button type="button" variant="secondary" onClick={handleClear} disabled={isBusy}>
              Clear
            </Button>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          {results !== undefined && (
            <DataGrid
              columns={buildColumns(term)}
              rows={results}
              getRowKey={(entry) => entry.id}
              emptyMessage={`No entries match “${term.trim()}”.`}
              enableExport
              exportFileName="journal-search"
              // The panel's own input is the search here — a second grid search
              // box would just be noise.
              enableSearch={false}
              onRowClick={(entry) => router.push(`/modules/journal/entries/${entry.id}`)}
            />
          )}
        </form>
      )}
    </div>
  );
}
