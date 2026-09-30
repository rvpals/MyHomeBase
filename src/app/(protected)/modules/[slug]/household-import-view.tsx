"use client";

import { useRouter } from "next/navigation";
import { CsvImportPanel, type CsvImportPlan } from "@/components/csv-import-panel";
import type { ColumnMapping, FieldOptionsMap, NamedMapping } from "@/lib/csv-import";
// Imported from the leaf module, not the `@/lib/household` barrel: that barrel
// re-exports `SqliteHouseholdRepository`, which would drag better-sqlite3 into
// this client bundle and fail the build. Same rule, and the same reason, as
// `household-recipes-view.tsx`.
import {
  RECIPE_IMPORT_FIELDS,
  RECIPE_LIST_FIELDS,
  defaultRecipeFieldOptions,
  type RecipeImportPlan,
} from "@/lib/household/csv-import";
import {
  deleteRecipeMappingAction,
  planRecipeImportAction,
  previewRecipeCsvAction,
  runRecipeImportAction,
  testRecipeImportAction,
  saveRecipeMappingAction,
  updateRecipeMappingAction,
} from "./household-import-actions";
import { PAGE_CONTAINER } from "../../page-container";

/**
 * Maps the module's own plan onto the panel's module-agnostic row shape.
 *
 * The translation lives here rather than in the action so the lib keeps its own
 * vocabulary (a recipe row has a `name`, not a `label`) and the shared panel
 * keeps knowing nothing about recipes.
 */
function toPanelPlan(plan: RecipeImportPlan): CsvImportPlan {
  return {
    createCount: plan.createCount,
    updateCount: plan.updateCount,
    skipCount: plan.skipCount,
    rows: plan.rows.map((row) => ({
      rowNumber: row.rowNumber,
      action: row.action,
      label: row.name,
      blockedReason: row.blockedReason,
    })),
  };
}

export interface HouseholdImportViewProps {
  namedMappings: NamedMapping[];
}

/**
 * The Recipes import screen: a thin wrapper over the shared `CsvImportPanel`.
 *
 * Everything below is either a server action or a label — the file reading,
 * column mapping, saved mappings and overwrite dialog all live in the panel.
 * That is the point: the next module's importer is this file again, with a
 * different field list.
 */
export function HouseholdImportView({ namedMappings }: HouseholdImportViewProps) {
  const router = useRouter();

  return (
    <div className={PAGE_CONTAINER}>
      <CsvImportPanel
        fields={RECIPE_IMPORT_FIELDS}
        listFields={RECIPE_LIST_FIELDS}
        defaultFieldOptions={defaultRecipeFieldOptions}
        namedMappings={namedMappings}
        onPreview={previewRecipeCsvAction}
        onSaveMapping={saveRecipeMappingAction}
        onUpdateMapping={updateRecipeMappingAction}
        onDeleteMapping={deleteRecipeMappingAction}
        onPlan={async (fileText, mapping, fieldOptions, skipDuplicates, overwrite, excluded) => {
          const result = await planRecipeImportAction(
            fileText,
            mapping,
            fieldOptions,
            skipDuplicates,
            overwrite,
            excluded,
          );
          return { ...result, plan: result.plan ? toPanelPlan(result.plan) : undefined };
        }}
        onImport={runRecipeImportAction}
        // The lib's row shape already matches the panel's, field for field, so
        // this one passes straight through — unlike the plan, which keeps the
        // module's own vocabulary.
        onTest={testRecipeImportAction}
        // Re-fetches the recipe list on the server, so the Recipes screen is
        // already right when the reader navigates back to it.
        onImported={() => router.refresh()}
        recordNoun="recipe"
        recordNounPlural="recipes"
        duplicateHint="A recipe counts as existing when its name matches, ignoring case."
        dropzoneLabel="Drag a recipe CSV here, or click to browse"
      >
        <p className="text-sm text-muted">
          One recipe per row. The only column you must map is <strong>Name</strong> — it is also
          what decides whether a row is one you already have.
          {" "}
          Ingredients and directions are stored one item per line, so tell those columns what to
          split on (a literal <code>\n</code> in the cell, or a semicolon). Pictures cannot come
          from a CSV; add them to a recipe afterwards.
        </p>
      </CsvImportPanel>
    </div>
  );
}
