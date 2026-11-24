"use client";

// The Code Library's filter bar: a text box and a language picker, both of which
// write to the URL rather than to component state.
//
// That is the rule `modules.md` sets — anything a screen should survive a refresh
// or a bookmark on travels as a search param, parsed in the route. `?search=` and
// `?language=` are already read by both route files and handed to `listSnippets`,
// so this component's whole job is to put them there.
//
// A client island, like the editor. The list it narrows stays server-rendered.

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/button";
import {
  SNIPPET_LANGUAGES,
  SNIPPET_LANGUAGE_LABELS,
  type SnippetTaxonomyItem,
} from "@/lib/code-library";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export function CodeLibraryFilters({
  search,
  language,
  category,
  tag,
  categories,
  tags,
}: {
  /** The active filters, as the route parsed them. */
  search: string;
  language: string;
  category: string;
  tag: string;
  /** The vocabularies to offer. Read once by the section and shared with the
      management screen, so the two can never disagree. */
  categories: SnippetTaxonomyItem[];
  tags: SnippetTaxonomyItem[];
}) {
  const router = useRouter();
  const params = useSearchParams();

  // The box is uncontrolled by the URL while being typed in — committing on every
  // keystroke would push a history entry per character. It resyncs when the URL
  // changes underneath it (the Clear button, the back button, a shared link).
  //
  // Adjusted during render rather than in an effect. React documents this exact
  // shape for "reset some state when a prop changes" — an effect would render
  // once with the stale draft and then again with the fresh one, which is the
  // cascading render `react-hooks/set-state-in-effect` exists to stop.
  const [draft, setDraft] = useState(search);
  const [syncedSearch, setSyncedSearch] = useState(search);
  if (syncedSearch !== search) {
    setSyncedSearch(search);
    setDraft(search);
  }

  /** Rewrites one search param, dropping it when it is cleared. */
  function navigate(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === "") next.delete(key);
    else next.set(key, value);
    router.push(`?${next.toString()}`);
  }

  function clearAll() {
    const next = new URLSearchParams(params.toString());
    for (const key of ["search", "language", "category", "tag"]) next.delete(key);
    router.push(`?${next.toString()}`);
  }

  /** A chip toggles: clicking the active one clears it rather than re-applying it. */
  function toggle(key: string, value: string, active: string) {
    navigate(key, value === active ? "" : value);
  }

  const isFiltered = search !== "" || language !== "" || category !== "" || tag !== "";

  return (
    <div className="space-y-2">
      {/* Stacks below `sm`: three controls side by side at phone width would
          leave the search box too narrow to read what you typed. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {/* A real <form> so Enter submits and a phone keyboard shows "search"
            rather than a newline key. `type="search"` gives the native clear ✕
            on the platforms that draw one. */}
        <form
          className="flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            navigate("search", draft.trim());
          }}
        >
          <label className="sr-only" htmlFor="code-library-search">
            Search snippets
          </label>
          <input
            id="code-library-search"
            type="search"
            value={draft}
            placeholder="Search titles and code…"
            onChange={(event) => setDraft(event.target.value)}
            // A cleared box commits immediately. Without this, emptying the field
            // and not pressing Enter leaves a filtered list with an empty box,
            // which reads as a bug.
            onBlur={() => {
              if (draft === "" && search !== "") navigate("search", "");
            }}
            className={INPUT_CLASS}
          />
        </form>

        <label className="sr-only" htmlFor="code-library-language">
          Filter by language
        </label>
        <select
          id="code-library-language"
          value={language}
          onChange={(event) => navigate("language", event.target.value)}
          className={`${INPUT_CLASS} sm:w-48`}
        >
          <option value="">Every language</option>
          {SNIPPET_LANGUAGES.map((key) => (
            <option key={key} value={key}>
              {SNIPPET_LANGUAGE_LABELS[key]}
            </option>
          ))}
        </select>

        {/* Only when there is something to clear: a permanently visible Clear on
            an unfiltered list is a button that does nothing. */}
        {isFiltered && (
          <Button size="sm" variant="secondary" onClick={clearAll}>
            Clear
          </Button>
        )}
      </div>

      {/* Chips, only for a vocabulary that has words in it: a row of nothing
          above the list is noise on a library that has never used categories. */}
      {categories.length > 0 && (
        <ChipRow
          label="Categories"
          items={categories}
          active={category}
          onToggle={(name) => toggle("category", name, category)}
        />
      )}
      {tags.length > 0 && (
        <ChipRow
          label="Tags"
          items={tags}
          active={tag}
          onToggle={(name) => toggle("tag", name, tag)}
        />
      )}

      {/* Says what is being narrowed. A filtered list that looks like the whole
          library is how someone concludes a snippet has been lost. */}
      {isFiltered && (
        <p className="text-xs text-muted">
          Filtered
          {search !== "" && (
            <>
              {" "}
              by <span className="text-ink">{search}</span>
            </>
          )}
          {language !== "" && (
            <>
              {" "}
              in{" "}
              <span className="text-ink">
                {SNIPPET_LANGUAGE_LABELS[language as keyof typeof SNIPPET_LANGUAGE_LABELS] ??
                  language}
              </span>
            </>
          )}
          {category !== "" && (
            <>
              {" "}
              under <span className="text-ink">{category}</span>
            </>
          )}
          {tag !== "" && (
            <>
              {" "}
              tagged <span className="text-ink">{tag}</span>
            </>
          )}
          .
        </p>
      )}
    </div>
  );
}

/**
 * One row of filter chips.
 *
 * Buttons, not links: the href would have to be rebuilt from the current query
 * string for every chip, and a toggle that removes itself is not a destination.
 *
 * A chip carries its usage count because a vocabulary accumulates words that
 * nothing uses any more, and "docker 0" says so without a visit to Categories &
 * Tags.
 */
function ChipRow({
  label,
  items,
  active,
  onToggle,
}: {
  label: string;
  items: SnippetTaxonomyItem[];
  active: string;
  onToggle: (name: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted">{label}</span>
      {items.map((item) => {
        const isActive = item.name === active;
        return (
          <button
            key={item.name}
            type="button"
            onClick={() => onToggle(item.name)}
            aria-pressed={isActive}
            className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
              isActive
                ? "border-brass bg-brass-soft text-ink"
                : "border-line bg-paper text-muted hover:text-ink"
            }`}
          >
            {item.name}
            <span className="ml-1 opacity-60">{item.usageCount}</span>
          </button>
        );
      })}
    </div>
  );
}
