"use client";

// The home screen's heading row with a search button. Clicking the search icon
// reveals an inline input; submitting navigates to the Entries section with
// ?search=<term>, so results land in the standard DataGrid with checkboxes,
// bulk actions, and everything else the Entries tabs carry.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";

// Shared form-input styling from design.md (mirrors journal-import-view).
const SEARCH_INPUT_CLASS =
  "min-w-0 flex-1 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

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

const HEADER_ICON_BUTTON_CLASS =
  "flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-brass-soft hover:text-brass-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export function JournalHomeHeader({ label, description }: { label: string; description: string }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [term, setTerm] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    const query = term.trim();
    if (query === "") return;
    router.push(`/modules/journal/entries?search=${encodeURIComponent(query)}`);
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
      </div>
      <p className="mt-1 text-sm text-muted">{description}</p>
      <div className="mt-3 h-px w-full bg-line" />

      {isOpen && (
        <form onSubmit={handleSearch} className="mt-6 flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search titles, content, categories, tags, or places…"
            aria-label="Search journal entries"
            className={SEARCH_INPUT_CLASS}
          />
          <Button type="submit" disabled={term.trim() === ""}>
            Search
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setTerm("");
              inputRef.current?.focus();
            }}
          >
            Clear
          </Button>
        </form>
      )}
    </div>
  );
}
