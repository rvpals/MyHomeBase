// The Code Library home screen: every snippet, pinned first and then newest.
//
// NOT a client component, deliberately. The interactive parts are client islands
// of their own — the filter bar, the editor dialog, the pin toggle and the Copy
// button — and the list around them ships no JavaScript. It takes plain data and
// never touches `deps`, which is the rule that actually matters
// (`ARCHITECTURE.md` → *Views*).

import { CopyButton } from "@/components/copy-button";
import {
  SNIPPET_LANGUAGE_LABELS,
  estimateSnippetCardHeight,
  type SnippetSummary,
  type SnippetTaxonomyItem,
} from "@/lib/code-library";
import { CodeLibraryCodeBlock } from "./code-library-code-block";
import {
  ColorSnippetButton,
  DeleteSnippetButton,
  EditSnippetButton,
  NewSnippetButton,
  PinSnippetButton,
  SealSnippetButton,
} from "./code-library-editor";
import { CodeLibraryFilters } from "./code-library-filters";
import { CodeLibraryViewMode } from "./code-library-view-mode";

export function CodeLibraryHomeView({
  snippets,
  search,
  language,
  category,
  tag,
  categories,
  tags,
}: {
  snippets: SnippetSummary[];
  /** The active filters, as the route parsed them. Passed down for the bar and
      so the empty state can tell "nothing here" from "nothing matches". */
  search: string;
  language: string;
  category: string;
  tag: string;
  categories: SnippetTaxonomyItem[];
  tags: SnippetTaxonomyItem[];
}) {
  const isFiltered = search !== "" || language !== "" || category !== "" || tag !== "";

  const filters = (
    <CodeLibraryFilters
      search={search}
      language={language}
      category={category}
      tag={tag}
      categories={categories}
      tags={tags}
    />
  );

  if (snippets.length === 0) {
    return (
      <div className="space-y-3">
        {/* The bar stays on screen when a filter matched nothing — removing it
            would strand the reader with no way to widen the search that emptied
            the list. It is dropped only when the library itself is empty. */}
        {isFiltered && filters}

        <div className="rounded-xl border border-dashed border-line p-8 text-center">
          <p className="font-display text-lg text-ink">
            {isFiltered ? "No snippets match" : "No snippets yet"}
          </p>
          <p className="mt-1 text-sm text-muted">
            {isFiltered
              ? "Nothing here matches those filters. Clear them to see the whole library."
              : "Snippets you keep here will be listed newest first."}
          </p>
          {/* The empty state carries the button too, rather than only the header:
              an empty screen whose one action is somewhere else is a dead end.
              Not offered under a filter, where the answer is to widen it. */}
          {!isFiltered && (
            <div className="mt-4 flex justify-center">
              <NewSnippetButton />
            </div>
          )}
        </div>
      </div>
    );
  }

  // The pinned band. Not a separate query — the repository's one ORDER BY already
  // put these first, so this only decides where the heading goes. Splitting in
  // SQL instead would let the two halves sort differently.
  const pinned = snippets.filter((snippet) => snippet.isPinned);
  const rest = snippets.filter((snippet) => !snippet.isPinned);

  return (
    <div className="space-y-3">
      {filters}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {snippets.length} {snippets.length === 1 ? "snippet" : "snippets"}
          {isFiltered && " matching"}
        </p>
        <NewSnippetButton />
      </div>

      {/* The cards are rendered here, on the server, and handed to the client
          switch as nodes — so choosing Board does not turn the whole list into a
          client component. The bands keep their headings in either shape. */}
      <CodeLibraryViewMode
        bands={[
          ...(pinned.length > 0
            ? [
                {
                  label: "Pinned",
                  cards: pinned.map((snippet) => ({
                    id: snippet.id,
                    node: <SnippetCard snippet={snippet} />,
                    weight: estimateSnippetCardHeight(snippet),
                  })),
                },
              ]
            : []),
          ...(rest.length > 0
            ? [
                {
                  // No heading unless there is a pinned band above to
                  // distinguish it from — on an unpinned library this is just
                  // the list, and "Everything else" would be answering a
                  // question nobody asked.
                  label: pinned.length > 0 ? "Everything else" : "",
                  cards: rest.map((snippet) => ({
                    id: snippet.id,
                    node: <SnippetCard snippet={snippet} />,
                    weight: estimateSnippetCardHeight(snippet),
                  })),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}

/**
 * The tint classes for a card colour.
 *
 * A lookup, not `clip-tint-${color}`: Tailwind and the CSS bundle are both
 * scanned for literal class names, so a constructed one is not guaranteed to
 * survive. The same lookup `clips-card.tsx` keeps, for the same reason.
 *
 * These are the Clips classes by name only — the rules in `globals.css` are
 * generic (they mix a hue into `--paper-raised` and `--line`) and predate any
 * second caller. Reusing them beats duplicating six near-identical rules; see
 * `migrations/0182` for why renaming them is left for later.
 */
const TINT_CLASS: Record<string, string> = {
  "": "",
  rose: "clip-tint clip-tint-rose",
  amber: "clip-tint clip-tint-amber",
  sage: "clip-tint clip-tint-sage",
  ocean: "clip-tint clip-tint-ocean",
  indigo: "clip-tint clip-tint-indigo",
  slate: "clip-tint clip-tint-slate",
};

function SnippetCard({ snippet }: { snippet: SnippetSummary }) {
  return (
    // `article`, not `li`: the list wrapper supplies the `<li>` and the board
    // supplies its own container, so the card must not assume either.
    <article
      className={`rounded-xl border border-line bg-paper-raised p-4 ${
        TINT_CLASS[snippet.color] ?? ""
      }`}
    >
      {/* `flex-wrap`, not a breakpoint: the metadata drops onto its own line
          whenever the title leaves it no room, which is the right answer on a
          phone *and* for a long title on a desktop. A `max-lg:` variant would
          only handle the first case. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-display text-base text-ink">
          {snippet.title === "" ? "Untitled snippet" : snippet.title}
        </h3>
        <div className="flex items-center gap-3">
          <p className="text-xs text-muted">
            <span className="text-brass-dark">{SNIPPET_LANGUAGE_LABELS[snippet.language]}</span>
            {" · "}
            {snippet.lineCount} {snippet.lineCount === 1 ? "line" : "lines"}
          </p>
          {/* Always visible, not a hover-revealed `RowActionBar`: these cards are
              not dense rows, and a control that appears only on hover is
              unreachable on a touch screen.

              Copy comes first because it is what a reader is here to do — the
              library exists to be copied out of, and editing is the occasional
              case. */}
          {/* Hidden while sealed: there is no plaintext on the card to copy,
              and a Copy button that writes "" is worse than none. The dialog
              behind Sealed has its own, once the password is in. */}
          {!snippet.isEncrypted && (
            <CopyButton
              text={snippet.code}
              // Names the whole snippet, not the six lines on screen: without
              // this a reader looking at a truncated card has no way to know
              // whether they are getting the preview or the file.
              title={`Copy all ${snippet.lineCount} ${
                snippet.lineCount === 1 ? "line" : "lines"
              }`}
            />
          )}
          <PinSnippetButton id={snippet.id} isPinned={snippet.isPinned} />
          <ColorSnippetButton id={snippet.id} color={snippet.color} />
          <SealSnippetButton
            id={snippet.id}
            isEncrypted={snippet.isEncrypted}
            // The hint is stored in the clear precisely so it can be shown
            // before anyone can decrypt.
            passwordHint={snippet.passwordHint}
          />
          {/* Editing a sealed snippet would open a form on a blank body and
              save that blankness over the ciphertext. Unseal first. */}
          {!snippet.isEncrypted && <EditSnippetButton id={snippet.id} />}
          <DeleteSnippetButton id={snippet.id} title={snippet.title} />
        </div>
      </div>

      {(snippet.categories.length > 0 || snippet.tags.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {snippet.categories.map((name) => (
            <span
              key={`c-${name}`}
              className="rounded-full border border-brass-dark/40 px-2 py-0.5 text-xs text-brass-dark"
            >
              {name}
            </span>
          ))}
          {/* Tags read quieter than categories — a category is what the snippet
              *is*, a tag is what it touches, and the card should not weight them
              the same. */}
          {snippet.tags.map((name) => (
            <span
              key={`t-${name}`}
              className="rounded-full border border-line px-2 py-0.5 text-xs text-muted"
            >
              {name}
            </span>
          ))}
        </div>
      )}

      {snippet.notes !== "" && (
        // Above the code, not below: it is context for what follows, and a
        // reader scanning cards should hit the "why" before the "what".
        <p className="mt-2 text-sm text-muted">{snippet.notes}</p>
      )}

      {snippet.isEncrypted ? (
        // No preview, no ciphertext on screen. The row genuinely has no
        // plaintext — the repository blanks it — so there is nothing to show
        // and showing the blob would be noise.
        <p className="mt-3 rounded-md border border-dashed border-line p-3 text-xs text-muted">
          Sealed. Open it with its password to read or copy it.
        </p>
      ) : (
        /* The *preview*, not the body — the card shows the opening lines and
           the Copy button carries the whole thing. Highlighted on the server;
           every token is a React child, so a snippet containing markup renders
           as those characters rather than as HTML. */
        <CodeLibraryCodeBlock
          code={snippet.preview}
          language={snippet.language}
          className="mt-3"
        />
      )}

      {snippet.sourceUrl !== "" && (
        // `noreferrer` as well as `noopener`: this URL came from whoever saved
        // the snippet, and the page behind it has no business knowing which of
        // this app's screens linked to it.
        <p className="mt-2 text-xs">
          <a
            href={snippet.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brass-dark underline"
          >
            Source
          </a>
        </p>
      )}
    </article>
  );
}
