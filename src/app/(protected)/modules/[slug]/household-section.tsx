import { CollapsibleCard } from "@/components/collapsible-card";
import { listNamedMappings } from "@/lib/csv-import";
import { listRecipeCategories, listRecipeTags, listRecipes } from "@/lib/household";
import { deps } from "@/lib/wiring";
import { HouseholdHsaView } from "./household-hsa-view";
import { HouseholdImportView } from "./household-import-view";
import { HouseholdInstructions } from "./household-instructions";
import { HouseholdMainView } from "./household-main-view";
import { HouseholdRecipesView } from "./household-recipes-view";
import { HouseholdShell } from "./household-shell";
import {
  HOUSEHOLD_SECTION_INFO,
  type HouseholdSection as HouseholdSectionName,
} from "./household-sections";

// Composes one Household section: the shell, a heading, and the section's own view.
// A server component, so it can read `deps` directly and hand plain data to the
// client views. Mirrors tools-section.tsx.

export async function HouseholdSection({
  section,
  search,
  category,
  tag,
}: {
  section: HouseholdSectionName;
  /** The recipe list's filters, parsed from search params by the route. */
  search?: string;
  category?: string;
  tag?: string;
}) {
  const info = HOUSEHOLD_SECTION_INFO[section];

  // Loaded only for the section that renders them. The home screen shows counts,
  // which the same list supplies — cheap, because `listRecipes` projects away the
  // picture bytes and the long text.
  const recipes =
    section === "recipes" || section === "main"
      ? listRecipes(deps.householdRepo, { search, category, tag })
      : [];
  const tags = section === "recipes" ? listRecipeTags(deps.householdRepo) : [];
  // Every category in use. Feeds the filter AND the editor's pick-or-type box,
  // from one read — so the two can never offer different vocabularies.
  const categories = section === "recipes" ? listRecipeCategories(deps.householdRepo) : [];
  // The saved column mappings for this module, out of the shared
  // `csv_named_mappings` table — "Recipe" is what separates them from every
  // other importer's rows in it.
  const importMappings =
    section === "recipes-import" ? listNamedMappings(deps.csvImportMappingRepo, "Recipe") : [];

  return (
    // The two-tier shell: the navigation tree on a wide screen, the shared bottom
    // bar on a narrow one, both placed by `HouseholdShell`. See design.md,
    // "Navigation: the tree (desktop) and the two-tier bar (compact)".
    //
    // `async` because the shell reads cookies for the session and the pinned
    // layout, which `next/headers` only exposes as a promise.
    <HouseholdShell>
      <div>
        <header className="mb-4">
          <h1 className="font-display text-2xl text-ink">{info.label}</h1>
          <p className="text-sm text-muted">{info.description}</p>
        </header>

        <CollapsibleCard title="Instruction">
          <HouseholdInstructions section={section} />
        </CollapsibleCard>

        <div className="mt-4">
          {section === "main" && <HouseholdMainView recipeCount={recipes.length} />}
          {section === "recipes" && (
            <HouseholdRecipesView
              recipes={recipes}
              tags={tags}
              categories={categories}
              search={search ?? ""}
              category={category ?? ""}
              tag={tag ?? ""}
            />
          )}
          {section === "recipes-import" && <HouseholdImportView namedMappings={importMappings} />}
          {section === "hsa" && <HouseholdHsaView />}
        </div>
      </div>
    </HouseholdShell>
  );
}
