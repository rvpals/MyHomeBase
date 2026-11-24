import { CollapsibleCard } from "@/components/collapsible-card";
import {
  listRecycledSnippets,
  listSnippetCategories,
  listSnippetTags,
  listSnippets,
} from "@/lib/code-library";
import { deps } from "@/lib/wiring";
import { CodeLibraryHomeView } from "./code-library-home-view";
import { CodeLibraryInstructions } from "./code-library-instructions";
import { CodeLibraryMetadataView } from "./code-library-metadata-view";
import { CodeLibraryRecycledView } from "./code-library-recycled-view";
import { CodeLibraryShell } from "./code-library-shell";
import {
  CODE_LIBRARY_SECTION_INFO,
  type CodeLibrarySection as CodeLibrarySectionName,
} from "./code-library-sections";

// Composes one Code Library section: the shell, a heading, and the section's own
// view. A server component, so it can read `deps` directly and hand plain data to
// the views. Mirrors clips-section.tsx.

export async function CodeLibrarySection({
  section,
  search,
  language,
  category,
  tag,
}: {
  section: CodeLibrarySectionName;
  /** The list's filters, parsed from search params by the route so they survive a
      refresh and a bookmark — not client state. */
  search?: string;
  language?: string;
  category?: string;
  tag?: string;
}) {
  const info = CODE_LIBRARY_SECTION_INFO[section];

  // Loaded only for the section that renders it. `listSnippets` projects away
  // nothing but the tail of each body — a card shows the opening lines, and
  // carries the whole thing for its Copy button.
  const snippets =
    section === "main"
      ? listSnippets(deps.codeLibraryRepo, {
          search: search ?? "",
          language: language ?? "",
          // One of each for now: the chips are single-select, but the filter and
          // the repository take lists because the AND semantics are the point.
          // Multi-select is a UI change here, not a library one.
          categories: category ? [category] : [],
          tags: tag ? [tag] : [],
        })
      : [];

  // The bin, read only for its own section.
  const recycled = section === "recycled" ? listRecycledSnippets(deps.codeLibraryRepo) : [];

  // Both lists feed the home screen's filter chips AND the management screen,
  // from one read — so the two can never offer different vocabularies.
  const categories =
    section === "main" || section === "metadata" ? listSnippetCategories(deps.codeLibraryRepo) : [];
  const tags =
    section === "main" || section === "metadata" ? listSnippetTags(deps.codeLibraryRepo) : [];

  return (
    // The two-tier shell: the navigation tree on a wide screen, the shared bottom
    // bar on a narrow one, both placed by `CodeLibraryShell`. See design.md,
    // "Navigation: the tree (desktop) and the two-tier bar (compact)".
    <CodeLibraryShell>
      <div>
        <header className="mb-4">
          <h1 className="font-display text-2xl text-ink">{info.label}</h1>
          <p className="text-sm text-muted">{info.description}</p>
        </header>

        <CollapsibleCard title="Instruction">
          <CodeLibraryInstructions section={section} />
        </CollapsibleCard>

        <div className="mt-4">
          {section === "main" && (
            <CodeLibraryHomeView
              snippets={snippets}
              search={search ?? ""}
              language={language ?? ""}
              category={category ?? ""}
              tag={tag ?? ""}
              categories={categories}
              tags={tags}
            />
          )}
          {section === "metadata" && (
            <CodeLibraryMetadataView categories={categories} tags={tags} />
          )}
          {section === "recycled" && <CodeLibraryRecycledView snippets={recycled} />}
        </div>
      </div>
    </CodeLibraryShell>
  );
}
