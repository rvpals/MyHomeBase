import { CollapsibleCard } from "@/components/collapsible-card";
import { getClipsSettings, listClipCategories, listClips, listClipTags } from "@/lib/clips";
import { deps } from "@/lib/wiring";
import { ClipsAllView } from "./clips-all-view";
import { ClipsConfigurationView } from "./clips-configuration-view";
import { ClipsInstructions } from "./clips-instructions";
import { ClipsMainView } from "./clips-main-view";
import { ClipsMetadataView } from "./clips-metadata-view";
import { ClipsShell } from "./clips-shell";
import { CLIPS_SECTION_INFO, type ClipsSection as ClipsSectionName } from "./clips-sections";

// Composes one Clips section: the shell, a heading, and the section's own view.
// A server component, so it can read `deps` directly and hand plain data to the
// client views. Mirrors household-section.tsx.

export async function ClipsSection({
  section,
  search,
  category,
  tag,
  isAdmin = false,
}: {
  section: ClipsSectionName;
  /** The list's filters, parsed from search params by the route so they survive a
      refresh and a bookmark — not client state. */
  search?: string;
  category?: string;
  tag?: string;
  /** Whether this reader may change the module-wide settings. */
  isAdmin?: boolean;
}) {
  const info = CLIPS_SECTION_INFO[section];

  // Read for every section that draws a card, and for Configuration itself. One
  // read, so the board and the list cut their excerpts to the same length.
  const settings = getClipsSettings(deps.moduleRepo, deps.moduleSettingsRepo);

  // Loaded only for the section that renders it. `listClips` projects away the
  // bodies and never touches the image blobs, so even the unfiltered list is cheap.
  const clips =
    section === "all" || section === "main"
      ? listClips(deps.clipsRepo, {
          search: search ?? "",
          categories: category ? [category] : [],
          tags: tag ? [tag] : [],
          excerptChars: settings.excerptChars,
        })
      : [];

  // Both lists feed the filter chips AND the editor's pick-or-type boxes, from one
  // read — so the two can never offer different vocabularies.
  const categories =
    section === "all" || section === "metadata" ? listClipCategories(deps.clipsRepo) : [];
  const tags = section === "all" || section === "metadata" ? listClipTags(deps.clipsRepo) : [];

  return (
    // The two-tier shell: the navigation tree on a wide screen, the shared bottom
    // bar on a narrow one, both placed by `ClipsShell`. See design.md,
    // "Navigation: the tree (desktop) and the two-tier bar (compact)".
    <ClipsShell>
      <div>
        <header className="mb-4">
          <h1 className="font-display text-2xl text-ink">{info.label}</h1>
          <p className="text-sm text-muted">{info.description}</p>
        </header>

        <CollapsibleCard title="Instruction">
          <ClipsInstructions section={section} />
        </CollapsibleCard>

        <div className="mt-4">
          {section === "main" && <ClipsMainView clips={clips.slice(0, 6)} total={clips.length} />}
          {section === "all" && (
            <ClipsAllView
              clips={clips}
              categories={categories}
              tags={tags}
              search={search ?? ""}
              category={category ?? ""}
              tag={tag ?? ""}
            />
          )}
          {section === "metadata" && (
            <ClipsMetadataView categories={categories} tags={tags} />
          )}
          {section === "configuration" && (
            <ClipsConfigurationView excerptChars={settings.excerptChars} canEdit={isAdmin} />
          )}
        </div>
      </div>
    </ClipsShell>
  );
}
