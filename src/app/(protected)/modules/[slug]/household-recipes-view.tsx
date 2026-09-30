"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { Modal } from "@/components/modal";
import { Tabs } from "@/components/tabs";
// Imported from the leaf modules, not the `@/lib/household` barrel: that barrel
// re-exports `SqliteHouseholdRepository`, which would drag better-sqlite3 into this
// client bundle and fail the build. Same rule, and the same reason, as
// `admin/messages/view.tsx` importing from `@/lib/messages/types`.
import {
  RECIPE_RATING_MAX,
  RECIPE_RATING_MIN,
  type Recipe,
  type RecipeCategoryCount,
  type RecipeSummary,
  type RecipeTagCount,
} from "@/lib/household/types";
import { MAX_RECIPE_PICTURE_BYTES, type RecipePictureInput } from "@/lib/household/schema";
import {
  IMAGE_UPLOAD_MIME_TYPES,
  type ImageUploadMimeType,
} from "@/lib/shared/image-upload";
import {
  bulkUpdateRecipesAction,
  clearRecipePictureAction,
  createRecipeAction,
  deleteRecipeAction,
  deleteRecipesAction,
  getRecipeAction,
  incrementMadeCountAction,
  setRecipePictureAction,
  updateRecipeAction,
} from "./household-actions";
import { PAGE_CONTAINER } from "../../page-container";

/** The shape the editor form holds while it is open. Strings throughout, as inputs are. */
interface RecipeForm {
  name: string;
  description: string;
  ingredients: string;
  directions: string;
  notes: string;
  rating: string;
  category: string;
  sourceUrl: string;
  tags: string;
}

const EMPTY_FORM: RecipeForm = {
  name: "",
  description: "",
  ingredients: "",
  directions: "",
  notes: "",
  rating: "",
  category: "",
  sourceUrl: "",
  tags: "",
};

/**
 * The two tab keys that are not a category name.
 *
 * The `tab:` prefix is what keeps them clear of a real category: nothing stops
 * someone naming a category "All", and a collision would make two tabs fight
 * over the same key. Someone determined could still name a category `tab:all`,
 * which would shadow this tab — the prefix makes that unlikely, not impossible,
 * and the failure is a confusing tab rather than a wrong write.
 */
const TAB_ALL = "tab:all";
const TAB_UNCATEGORISED = "tab:uncategorised";

/** The one input style design.md mandates. Copied, not invented. */
const INPUT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/**
 * Fills the editor from a recipe.
 *
 * Takes the WHOLE `Recipe`, never a `RecipeSummary`. The previous signature
 * accepted a summary plus `Partial<{ingredients, directions, notes}>` and
 * defaulted each to `""`, which meant handing it a grid row type-checked
 * cleanly and silently produced an editor with three empty fields — over a
 * recipe that had them. Anything that opens the editor must fetch the record
 * first (`getRecipeAction`); requiring the full type here is what forces that.
 */
function toForm(recipe: Recipe): RecipeForm {
  return {
    name: recipe.name,
    description: recipe.description,
    ingredients: recipe.ingredients,
    directions: recipe.directions,
    notes: recipe.notes,
    rating: recipe.rating === null ? "" : String(recipe.rating),
    category: recipe.category,
    sourceUrl: recipe.sourceUrl,
    tags: recipe.tags.join(", "),
  };
}

/** Splits the tag box. The schema trims, lower-cases and de-duplicates after this. */
function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/**
 * Validates a chosen file and reads it as base64, or reports why not.
 *
 * Shared by the editor and the viewer — both let a picture be chosen, and two
 * copies of a MIME allowlist is how the two drift apart. The checks here mirror
 * the server's, which enforces them again on the decoded bytes; this pass exists
 * only so the reader hears about a bad file before the round trip.
 *
 * Also hands back a data URL, so a picture chosen in the editor can be previewed
 * before it has been stored anywhere.
 */
function readPictureFile(
  file: File,
  onReady: (picture: RecipePictureInput, previewUrl: string) => void,
  onError: (message: string) => void,
) {
  if (file.size > MAX_RECIPE_PICTURE_BYTES) {
    onError(`Keep the picture under ${Math.round(MAX_RECIPE_PICTURE_BYTES / 1024 / 1024)} MB.`);
    return;
  }
  // `file.type` is a bare string — the browser reports whatever it inferred, and
  // the picker's `accept` is a hint that a drag-and-drop or a renamed file can
  // sidestep. Narrowing against the same allowlist the server enforces is what
  // makes this a real check rather than a cast.
  if (!(IMAGE_UPLOAD_MIME_TYPES as readonly string[]).includes(file.type)) {
    onError("Use a PNG, JPEG, WebP or GIF image.");
    return;
  }
  const mimeType = file.type as ImageUploadMimeType;
  const reader = new FileReader();
  reader.onload = () => {
    const result = String(reader.result);
    onReady({ mimeType, base64Data: result.slice(result.indexOf(",") + 1) }, result);
  };
  reader.onerror = () => onError("That file could not be read.");
  reader.readAsDataURL(file);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}

/**
 * The picture thumbnail in a row, and in the record view.
 *
 * `?v=` is a cache-buster off `updatedAt`: the route sets a 5-minute private
 * max-age, so a replaced picture would otherwise keep showing the old bytes.
 */
function RecipeThumb({ recipe, size }: { recipe: RecipeSummary; size: number }) {
  if (!recipe.hasPicture) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-line bg-paper text-xs text-muted"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        —
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the bytes come from our
    // own API route with no known dimensions; next/image would need a loader config
    // for a route that already serves cache headers.
    <img
      src={`/api/household/recipes/${recipe.id}/picture?v=${encodeURIComponent(recipe.updatedAt)}`}
      alt=""
      width={size}
      height={size}
      className="rounded-md border border-line object-cover"
      style={{ width: size, height: size }}
    />
  );
}

export function HouseholdRecipesView({
  recipes,
  tags,
  categories,
  search,
  category,
  tag,
}: {
  recipes: RecipeSummary[];
  tags: RecipeTagCount[];
  /** Every category in use — feeds both the filter and the editor's picker. */
  categories: RecipeCategoryCount[];
  search: string;
  category: string;
  tag: string;
}) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string>();

  // Which dialog is open, if any. One piece of state rather than four booleans, so
  // two dialogs cannot both be open.
  const [dialog, setDialog] = useState<
    | { kind: "closed" }
    | {
        kind: "edit";
        id?: number;
        form: RecipeForm;
        /**
         * A picture chosen in the editor but not yet stored.
         *
         * Held here rather than posted on selection because a NEW recipe has no
         * id to attach one to until it is saved. Editing an existing recipe
         * holds it too, so both paths save the picture at the same moment and
         * there is one code path instead of two.
         */
        picture?: RecipePictureInput;
        /** Data URL of `picture`, for the preview. Set together with it. */
        picturePreview?: string;
        /** Whether the stored recipe already has one, so the label can say "Replace". */
        hasPicture?: boolean;
      }
    | { kind: "view"; recipe: Recipe }
    | { kind: "delete"; recipe: RecipeSummary }
    | { kind: "bulk-delete"; rows: RecipeSummary[]; clear: () => void }
    | { kind: "bulk-edit"; rows: RecipeSummary[]; clear: () => void }
  >({ kind: "closed" });

  const pictureInput = useRef<HTMLInputElement>(null);

  /**
   * Which category tab is showing.
   *
   * A category tab is really the `?category=` search param — so the tab strip is
   * a control over the URL, not a second source of truth, and a bookmarked
   * filter still opens on the right tab. `Uncategorised` is the exception: the
   * repository reads `category: ""` as "no filter at all", so it cannot be
   * expressed as a param and lives in client state only. The cost is that a
   * refresh lands back on All, which is why it is the one tab that does.
   */
  const [isUncategorised, setIsUncategorised] = useState(false);

  // The tab is hidden while a search or tag filter is on (see `tabItems`), so it
  // must stop applying at the same moment. Deriving it rather than trusting the
  // flag alone keeps the strip and the rows from disagreeing: leaving it set
  // would narrow the list to nothing with no lit tab to explain why.
  const showUncategorised = isUncategorised && !search && !tag;
  const activeTab = showUncategorised ? TAB_UNCATEGORISED : category || TAB_ALL;

  // Applied here rather than in SQL, for the reason above. Every other tab is
  // already filtered by the server, so this narrows nothing for them.
  const visibleRecipes = showUncategorised
    ? recipes.filter((recipe) => recipe.category === "")
    : recipes;

  // Counted off the unfiltered list, so the number stays put while the tab is
  // open — a count that changed when you clicked it would read as a bug. Only
  // correct on a tab that loaded every row, which is why the strip hides the
  // tab entirely once a search or tag filter is on (see below).
  const uncategorisedCount = recipes.filter((recipe) => recipe.category === "").length;

  /**
   * Opens the editor on an existing recipe.
   *
   * Fetches the whole record first: the grid holds `RecipeSummary` rows, which
   * carry no ingredients, directions or notes, so filling the form from a row
   * shows three empty boxes over a recipe that has them — and saving that form
   * would then write the blanks back, because `updateRecipe` replaces every
   * field. Both call sites go through here for that reason.
   */
  async function openEditor(id: number) {
    setIsBusy(true);
    setError(undefined);
    const result = await getRecipeAction(id);
    setIsBusy(false);
    if (!result.ok || !result.recipe) {
      setError(result.error ?? "Could not load that recipe.");
      return;
    }
    setDialog({
      kind: "edit",
      id,
      form: toForm(result.recipe),
      hasPicture: result.recipe.hasPicture,
    });
  }

  /**
   * Opens the record view on a recipe.
   *
   * Fetches the whole record for the same reason `openEditor` does: a grid row
   * is a `RecipeSummary`, which carries no ingredients, directions or notes, and
   * this dialog's whole job is to show them. Reading the row would render three
   * empty sections over a recipe that has all three.
   */
  async function openViewer(id: number) {
    setIsBusy(true);
    setError(undefined);
    const result = await getRecipeAction(id);
    setIsBusy(false);
    if (!result.ok || !result.recipe) {
      setError(result.error ?? "Could not load that recipe.");
      return;
    }
    setDialog({ kind: "view", recipe: result.recipe });
  }

  /** Runs an action, surfaces its error inline, and refreshes on success. */
  async function run(work: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setIsBusy(true);
    setError(undefined);
    const result = await work();
    setIsBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    after?.();
    setDialog({ kind: "closed" });
    router.refresh();
  }

  // The filters are search params, not client state, so a filtered list survives a
  // refresh and can be bookmarked or shared — the rule in modules.md step 8.
  //
  // Takes a PATCH of the current filters rather than one positional argument per
  // filter: with three of them, every call site would otherwise have to restate
  // the two it isn't changing, and transposing two same-typed strings is a bug
  // the compiler cannot see.
  function applyFilter(patch: Partial<{ search: string; category: string; tag: string }>) {
    const next = { search, category, tag, ...patch };
    const params = new URLSearchParams();
    if (next.search) params.set("search", next.search);
    if (next.category) params.set("category", next.category);
    if (next.tag) params.set("tag", next.tag);
    const query = params.toString();
    router.push(query ? `/modules/household/recipes?${query}` : "/modules/household/recipes");
  }

  /**
   * Handles a tab click.
   *
   * `All` and `Uncategorised` both clear `?category=`; they differ only in
   * whether the client-side narrowing is on. A category tab sets the param and
   * turns that narrowing off, so the two can never both apply.
   */
  function selectTab(key: string) {
    setIsUncategorised(key === TAB_UNCATEGORISED);
    applyFilter({ category: key === TAB_ALL || key === TAB_UNCATEGORISED ? "" : key });
  }

  /**
   * Saves the editor, then attaches a held picture if one was chosen.
   *
   * Two round trips, deliberately, and in this order: a NEW recipe has no id
   * until it exists, so the picture cannot be posted first. `createRecipeAction`
   * hands back the new id for exactly this.
   *
   * The two steps fail independently, and the message says which got through. A
   * saved recipe whose picture failed must NOT read as "nothing was saved" — the
   * reader would retype the whole form over a row that is already there. The
   * dialog closes either way, because the error banner lives in the page body:
   * leaving the modal up would hide the very message explaining what happened.
   * The recipe is in the list at that point, so the picture is one View away.
   */
  async function saveRecipe(dialog: { id?: number; form: RecipeForm; picture?: RecipePictureInput }) {
    const { form, picture } = dialog;
    const input = {
      name: form.name,
      description: form.description,
      ingredients: form.ingredients,
      directions: form.directions,
      notes: form.notes,
      rating: form.rating,
      category: form.category,
      sourceUrl: form.sourceUrl,
      tags: parseTags(form.tags),
    };

    setIsBusy(true);
    setError(undefined);

    // Branched rather than merged into one union, so `recipeId` comes from the
    // create result's own `id` field without a runtime `in` probe: an update
    // already knows the id, a create is the only path that learns one.
    let recipeId: number | undefined;
    if (dialog.id === undefined) {
      const created = await createRecipeAction(input);
      if (!created.ok) {
        setIsBusy(false);
        setError(created.error ?? "Could not save that recipe.");
        return;
      }
      recipeId = created.id;
    } else {
      const updated = await updateRecipeAction(dialog.id, input);
      if (!updated.ok) {
        setIsBusy(false);
        setError(updated.error ?? "Could not save that recipe.");
        return;
      }
      recipeId = dialog.id;
    }

    if (picture && recipeId !== undefined) {
      const attached = await setRecipePictureAction(recipeId, picture);
      setIsBusy(false);
      if (!attached.ok) {
        // Says plainly that the recipe DID save, so nothing is retyped. Closing
        // first, so this lands on a visible banner rather than behind the modal.
        setDialog({ kind: "closed" });
        setError(
          `${form.name || "The recipe"} was saved, but the picture could not be attached: ${
            attached.error ?? "something went wrong."
          } Open it and use “Replace picture” to try again.`,
        );
        router.refresh();
        return;
      }
    } else {
      setIsBusy(false);
    }

    setDialog({ kind: "closed" });
    router.refresh();
  }

  /**
   * The tab strip: All, then every category in use, then Uncategorised.
   *
   * `content` is empty on every tab — the grid lives below the strip, not inside
   * it, because all tabs render the same grid over a different row set and
   * nesting it would remount the whole table (losing its sort, page and stored
   * column widths) on every tab click.
   */
  const tabItems = [
    // Counted only when this list really is every recipe. On a category tab the
    // server has already narrowed `recipes`, and a search or tag narrows it
    // again — so a number here would label a subset as the whole box.
    {
      key: TAB_ALL,
      label: category || search || tag ? "All" : `All (${recipes.length})`,
      content: null,
    },
    ...categories.map((entry) => ({
      key: entry.name,
      label: `${entry.name} (${entry.recipeCount})`,
      content: null,
    })),
    // Hidden once a search or tag filter is on: the count behind it is taken
    // from the loaded rows, which are already narrowed by those filters, so the
    // number would be a subset presented as a total.
    ...(search || tag || uncategorisedCount === 0
      ? []
      : [
          {
            key: TAB_UNCATEGORISED,
            label: `Uncategorised (${uncategorisedCount})`,
            content: null,
          },
        ]),
  ];

  const columns: DataGridColumn<RecipeSummary>[] = [
    {
      key: "name",
      header: "Name",
      render: (row) => <div className="text-ink">{row.name}</div>,
      value: (row) => row.name,
    },
    {
      key: "description",
      header: "Description",
      render: (row) =>
        row.description ? row.description : <span className="text-muted">—</span>,
      value: (row) => row.description,
    },
    {
      key: "tags",
      header: "Tags",
      render: (row) =>
        row.tags.length === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.tags.map((name) => (
              <span
                key={name}
                className="rounded-full border border-line px-2 py-0.5 text-xs text-muted"
              >
                {name}
              </span>
            ))}
          </div>
        ),
      value: (row) => row.tags.join(", "),
    },
    {
      key: "madeCount",
      header: "Made",
      render: (row) => row.madeCount,
      value: (row) => row.madeCount,
      aggregate: "sum",
    },
    {
      key: "rating",
      header: "Rating",
      // An unrated recipe reads "—", never 0: the two are different facts, and a
      // zero would sort and total as though someone had judged it the worst thing
      // in the box.
      render: (row) =>
        row.rating === null ? <span className="text-muted">—</span> : `${row.rating}/10`,
      value: (row) => row.rating ?? "",
    },
    {
      key: "actions",
      header: "",
      // Kept out of the record modal: a row's buttons are not part of a read-out
      // of the record.
      excludeFromRecordView: true,
      render: (row) => (
        <div className="flex gap-1" onClick={(event) => event.stopPropagation()}>
          <Button
            size="sm"
            variant="secondary"
            ariaLabel={`View ${row.name}`}
            disabled={isBusy}
            onClick={() => openViewer(row.id)}
          >
            View
          </Button>
          <Button
            size="sm"
            variant="secondary"
            title="Made it again"
            ariaLabel={`Record that you made ${row.name} again`}
            disabled={isBusy}
            onClick={() => run(() => incrementMadeCountAction(row.id))}
          >
            +1
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={isBusy}
            onClick={() => openEditor(row.id)}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={isBusy}
            onClick={() => setDialog({ kind: "delete", recipe: row })}
          >
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className={PAGE_CONTAINER}>
      {error && (
        <p className="mb-3 rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink">
          {error}
        </p>
      )}

      {/* Filters and the add button. `max-lg:` so the row stacks on a phone while
          the desktop classes stay untouched. */}
      <div className="mb-4 flex flex-wrap items-end gap-2 max-lg:flex-col max-lg:items-stretch">
        <Field label="Search">
          <input
            className={INPUT_CLASS}
            defaultValue={search}
            placeholder="Name, description or ingredient"
            onKeyDown={(event) => {
              if (event.key === "Enter") applyFilter({ search: event.currentTarget.value });
            }}
          />
        </Field>
        <Field label="Tag">
          <select
            className={INPUT_CLASS}
            value={tag}
            onChange={(event) => applyFilter({ tag: event.target.value })}
          >
            <option value="">All tags</option>
            {tags.map((entry) => (
              <option key={entry.name} value={entry.name}>
                {entry.name} ({entry.recipeCount})
              </option>
            ))}
          </select>
        </Field>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => setDialog({ kind: "edit", form: EMPTY_FORM })}>
            Add recipe
          </Button>
          {(search || category || tag || showUncategorised) && (
            <Button
              variant="secondary"
              onClick={() => {
                setIsUncategorised(false);
                applyFilter({ search: "", category: "", tag: "" });
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* The category tabs. `overflow-x-auto` because the number of tabs is the
          number of categories in use — unbounded — and a phone must scroll them
          sideways rather than wrap them into a wall above the grid. The grid sits
          BELOW the strip, not in a tab panel: see `tabItems`. */}
      <Tabs
        items={tabItems}
        activeKey={activeTab}
        onActiveKeyChange={selectTab}
        className="mb-4 [&>div:first-child]:flex-nowrap [&>div:first-child]:overflow-x-auto [&>div:last-child]:hidden"
      />

      <DataGrid
        columns={columns}
        rows={visibleRecipes}
        // The row's real database id, never its position: a bulk action keyed on
        // array index writes to the wrong row after a re-sort.
        getRowKey={(row) => row.id}
        enableSelection
        // Forwarded to DataGridCompact too, so bulk actions survive below 1024px.
        renderSelectionActions={(selectedRows, clearSelection) => (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={isBusy}
              onClick={() => setDialog({ kind: "bulk-edit", rows: selectedRows, clear: clearSelection })}
            >
              Edit {selectedRows.length}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={isBusy}
              onClick={() => setDialog({ kind: "bulk-delete", rows: selectedRows, clear: clearSelection })}
            >
              Delete {selectedRows.length}
            </Button>
          </div>
        )}
        // Same destination as the row's View button — the button is the
        // discoverable affordance, the row click the fast one.
        onRowClick={(row) => openViewer(row.id)}
        emptyMessage={
          search || category || tag || showUncategorised
            ? "No recipes match that filter."
            : "No recipes yet — add the first one."
        }
        exportFileName="recipes"
        storageKey="household-recipes"
        recordViewTitle={(row) => row.name}
      />

      {dialog.kind === "edit" && (
        <RecipeEditor
          form={dialog.form}
          categories={categories}
          isNew={dialog.id === undefined}
          isBusy={isBusy}
          picturePreview={dialog.picturePreview}
          hasPicture={dialog.hasPicture}
          onChange={(form) => setDialog({ ...dialog, form })}
          onPicture={(picture, picturePreview) =>
            setDialog({ ...dialog, picture, picturePreview })
          }
          onCancel={() => setDialog({ kind: "closed" })}
          onSave={() => saveRecipe(dialog)}
        />
      )}

      {dialog.kind === "view" && (
        <RecipeViewer
          recipe={dialog.recipe}
          isBusy={isBusy}
          pictureInput={pictureInput}
          onClose={() => setDialog({ kind: "closed" })}
          onEdit={() => openEditor(dialog.recipe.id)}
          onPicture={(picture) => run(() => setRecipePictureAction(dialog.recipe.id, picture))}
          onClearPicture={() => run(() => clearRecipePictureAction(dialog.recipe.id))}
        />
      )}

      {dialog.kind === "delete" && (
        <Modal
          title="Delete this recipe?"
          description={dialog.recipe.name}
          isBusy={isBusy}
          onClose={() => setDialog({ kind: "closed" })}
          footer={
            <>
              <Button variant="secondary" disabled={isBusy} onClick={() => setDialog({ kind: "closed" })}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={isBusy}
                onClick={() => run(() => deleteRecipeAction(dialog.recipe.id))}
              >
                Delete
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">
            This removes the recipe and its picture. It cannot be undone.
          </p>
        </Modal>
      )}

      {dialog.kind === "bulk-delete" && (
        <Modal
          title={`Delete ${dialog.rows.length} recipes?`}
          isBusy={isBusy}
          onClose={() => setDialog({ kind: "closed" })}
          footer={
            <>
              <Button variant="secondary" disabled={isBusy} onClick={() => setDialog({ kind: "closed" })}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={isBusy}
                onClick={() =>
                  run(
                    () => deleteRecipesAction(dialog.rows.map((row) => row.id)),
                    dialog.clear,
                  )
                }
              >
                Delete {dialog.rows.length}
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">
            This removes each of them and their pictures. It cannot be undone.
          </p>
          <ul className="mt-2 flex max-h-40 list-disc flex-col gap-0.5 overflow-auto pl-5 text-sm text-ink">
            {dialog.rows.map((row) => (
              <li key={row.id}>{row.name}</li>
            ))}
          </ul>
        </Modal>
      )}

      {dialog.kind === "bulk-edit" && (
        <BulkEditor
          count={dialog.rows.length}
          categories={categories}
          isBusy={isBusy}
          onCancel={() => setDialog({ kind: "closed" })}
          onApply={(changes) =>
            run(
              () => bulkUpdateRecipesAction({ ids: dialog.rows.map((row) => row.id), ...changes }),
              dialog.clear,
            )
          }
        />
      )}
    </div>
  );
}

function RecipeEditor({
  form,
  categories,
  isNew,
  isBusy,
  picturePreview,
  hasPicture,
  onChange,
  onPicture,
  onCancel,
  onSave,
}: {
  form: RecipeForm;
  /** Offered in the category box's dropdown; a new one can still be typed. */
  categories: RecipeCategoryCount[];
  isNew: boolean;
  isBusy: boolean;
  /** Data URL of a picture chosen here but not yet saved. */
  picturePreview?: string;
  /** Whether the stored recipe already has one — "Replace" rather than "Add". */
  hasPicture?: boolean;
  onChange: (form: RecipeForm) => void;
  /** Hands up a chosen picture and its preview; saved with the form. */
  onPicture: (picture: RecipePictureInput, previewUrl: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const set = (patch: Partial<RecipeForm>) => onChange({ ...form, ...patch });
  const fileInput = useRef<HTMLInputElement>(null);
  const [pictureError, setPictureError] = useState<string>();

  return (
    <Modal
      title={isNew ? "Add a recipe" : "Edit recipe"}
      size="lg"
      isBusy={isBusy}
      onClose={onCancel}
      // No Cancel button: the modal's own close control and Escape already
      // dismiss it, so a third way out only crowded the footer next to the one
      // action that commits.
      footer={
        <Button variant="primary" disabled={isBusy} onClick={onSave}>
          {isBusy ? "Saving…" : "Save Recipe"}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name">
          <input
            className={INPUT_CLASS}
            value={form.name}
            onChange={(event) => set({ name: event.target.value })}
          />
        </Field>
        <Field label="Description">
          {/* Three lines, via `rows` rather than a min-height utility: `rows` is
              in lines of the field's own font, so it stays three lines if the
              type scale changes. Still one paragraph of prose, not a line-per-item
              block like the two below — nothing splits it on save. */}
          <textarea
            className={INPUT_CLASS}
            rows={3}
            value={form.description}
            onChange={(event) => set({ description: event.target.value })}
          />
        </Field>
        <Field label="Picture">
          <div className="flex items-center gap-3">
            {/* The chosen picture if there is one, else whatever is stored, else
                a placeholder. A preview matters most for a NEW recipe, where
                there is nothing on the server to fall back to yet. */}
            {picturePreview ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local
              // data URL with no known dimensions; next/image would need a
              // loader for bytes that never touch the network.
              <img
                src={picturePreview}
                alt=""
                className="h-20 w-20 rounded-md border border-line object-cover"
              />
            ) : (
              <div
                className="flex h-20 w-20 items-center justify-center rounded-md border border-line bg-paper text-xs text-muted"
                aria-hidden="true"
              >
                —
              </div>
            )}
            <div className="flex flex-col gap-1">
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    setPictureError(undefined);
                    readPictureFile(file, onPicture, setPictureError);
                  }
                  // Cleared so choosing the same file twice fires `change` again.
                  event.target.value = "";
                }}
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={isBusy}
                onClick={() => fileInput.current?.click()}
              >
                {picturePreview || hasPicture ? "Replace picture" : "Add picture"}
              </Button>
              <span className="text-xs text-muted">
                Saved with the recipe, and shrunk to fit — a phone photo is fine.
              </span>
              {pictureError && <span className="text-xs text-ink">{pictureError}</span>}
            </div>
          </div>
        </Field>
        {/* One per row, full width, rather than the pair of half-width columns
            these used to share. Both hold line-per-item text that wraps badly in
            a narrow box: an ingredient like "2 tbsp unsalted butter, softened"
            and a direction sentence both want the modal's whole width, and
            wrapping mid-item obscures where one item ends and the next begins. */}
        <Field label="Ingredients (one per line)">
          <textarea
            className={`${INPUT_CLASS} min-h-40 font-mono text-xs`}
            value={form.ingredients}
            onChange={(event) => set({ ingredients: event.target.value })}
          />
        </Field>
        <Field label="Directions (one step per line)">
          <textarea
            className={`${INPUT_CLASS} min-h-40`}
            value={form.directions}
            onChange={(event) => set({ directions: event.target.value })}
          />
        </Field>
        <Field label="Notes">
          <textarea
            className={`${INPUT_CLASS} min-h-20`}
            value={form.notes}
            onChange={(event) => set({ notes: event.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3 max-lg:grid-cols-1">
          <Field label="Category">
            {/* A `datalist`, not a `<select>` + "other" escape hatch: this is one
                control that both offers every category already in use and accepts
                a new one typed straight in, which is exactly the ask. The same
                pattern the Journal's calendar-import screen uses for its category
                and tag boxes. */}
            <input
              className={INPUT_CLASS}
              list="household-recipe-categories"
              value={form.category}
              placeholder="Dinner, Dessert…"
              onChange={(event) => set({ category: event.target.value })}
            />
            <datalist id="household-recipe-categories">
              {categories.map((entry) => (
                <option key={entry.name} value={entry.name} />
              ))}
            </datalist>
          </Field>
          <Field label={`Rating (${RECIPE_RATING_MIN}-${RECIPE_RATING_MAX}, or blank)`}>
            <input
              className={INPUT_CLASS}
              type="number"
              min={RECIPE_RATING_MIN}
              max={RECIPE_RATING_MAX}
              value={form.rating}
              onChange={(event) => set({ rating: event.target.value })}
            />
          </Field>
          <Field label="Source (URL)">
            <input
              className={INPUT_CLASS}
              value={form.sourceUrl}
              placeholder="https://…"
              onChange={(event) => set({ sourceUrl: event.target.value })}
            />
          </Field>
          <Field label="Tags (comma separated)">
            <input
              className={INPUT_CLASS}
              value={form.tags}
              placeholder="weeknight, freezer"
              onChange={(event) => set({ tags: event.target.value })}
            />
          </Field>
        </div>

      </div>
    </Modal>
  );
}

/**
 * One block of the record view: a heading over the field's lines.
 *
 * Ingredients, directions and notes are each stored as ONE text column that the
 * cook typed with newlines in it — see `Recipe`. Splitting on the newline here
 * is presentation, not parsing: the stored value is never reshaped, and a field
 * typed as a single paragraph renders as a single item.
 *
 * Renders nothing at all when the field is empty, so a recipe with no notes
 * shows no Notes heading.
 */
function RecipeLines({
  label,
  text,
  ordered = false,
}: {
  label: string;
  text: string;
  /** Numbers the lines. Directions are steps; ingredients are a set. */
  ordered?: boolean;
}) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;

  const ListTag = ordered ? "ol" : "ul";
  return (
    // `.panel-inset` presses the block into the page — the groove class from
    // globals.css, not a hand-rolled shadow (design.md, "The elevation classes").
    // `bg-paper` under it because the recess darkens whatever surface it is given
    // and the modal's own background is the same tone as the lip.
    <div className="panel-inset rounded-md bg-paper px-3 py-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted">{label}</h3>
      <ListTag
        className={`mt-1 flex flex-col gap-0.5 pl-5 text-sm text-ink ${
          ordered ? "list-decimal" : "list-disc"
        }`}
      >
        {lines.map((line, index) => (
          // Index as the key: these are positions in a block of text, not
          // records, and two identical lines ("salt") are legitimately the same
          // string in two places.
          <li key={index}>{line}</li>
        ))}
      </ListTag>
    </div>
  );
}

function RecipeViewer({
  recipe,
  isBusy,
  pictureInput,
  onClose,
  onEdit,
  onPicture,
  onClearPicture,
}: {
  /**
   * The WHOLE record, never a grid row. `RecipeSummary` type-checks for the
   * fields above the fold but carries no ingredients, directions or notes — and
   * rendering those three as blank over a recipe that has them is exactly the
   * bug `toForm` documents. Requiring `Recipe` is what forces the caller to
   * fetch first.
   */
  recipe: Recipe;
  isBusy: boolean;
  pictureInput: React.RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onEdit: () => void;
  onPicture: (picture: RecipePictureInput) => void;
  onClearPicture: () => void;
}) {
  const [pictureError, setPictureError] = useState<string>();

  // Posts the picture straight away, unlike the editor, which holds it until the
  // form is saved: here the recipe already exists, so there is an id to attach
  // it to and nothing to wait for. The preview URL is ignored for the same
  // reason — the stored bytes are re-read on refresh.
  function handleFile(file: File) {
    setPictureError(undefined);
    readPictureFile(file, (picture) => onPicture(picture), setPictureError);
  }

  return (
    <Modal
      title={recipe.name}
      description={recipe.description || undefined}
      size="lg"
      isBusy={isBusy}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={onEdit}>
            Edit
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-4 max-lg:flex-col">
          <RecipeThumb recipe={recipe} size={160} />
          <div className="flex flex-col gap-2">
            <div className="text-sm text-muted">
              {recipe.category && (
                <>
                  <span className="text-ink">{recipe.category}</span> ·{" "}
                </>
              )}
              Made {recipe.madeCount} {recipe.madeCount === 1 ? "time" : "times"} ·{" "}
              {recipe.rating === null ? "Unrated" : `Rated ${recipe.rating}/10`}
            </div>
            {recipe.sourceUrl && (
              <a
                href={recipe.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-sm text-brass underline"
              >
                {recipe.sourceUrl}
              </a>
            )}
            {recipe.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {recipe.tags.map((name) => (
                  <span
                    key={name}
                    className="rounded-full border border-line px-2 py-0.5 text-xs text-muted"
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                ref={pictureInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) handleFile(file);
                  event.target.value = "";
                }}
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={isBusy}
                onClick={() => pictureInput.current?.click()}
              >
                {recipe.hasPicture ? "Replace picture" : "Add picture"}
              </Button>
              {recipe.hasPicture && (
                <Button size="sm" variant="danger" disabled={isBusy} onClick={onClearPicture}>
                  Remove picture
                </Button>
              )}
            </div>
            {pictureError && <p className="text-xs text-ink">{pictureError}</p>}
          </div>
        </div>
        {/* The rest of the record. Every remaining field, each section omitted
            when the recipe has nothing in it — an empty "Notes" heading is
            noise, not information. */}
        <RecipeLines label="Ingredients" text={recipe.ingredients} />
        <RecipeLines label="Directions" text={recipe.directions} ordered />
        <RecipeLines label="Notes" text={recipe.notes} />

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line pt-3 text-xs text-muted max-lg:grid-cols-1">
          <div>
            <dt className="inline font-medium uppercase tracking-wide">Added</dt>{" "}
            <dd className="inline text-ink">{recipe.createdAt}</dd>
          </div>
          <div>
            <dt className="inline font-medium uppercase tracking-wide">Updated</dt>{" "}
            <dd className="inline text-ink">{recipe.updatedAt}</dd>
          </div>
        </dl>
      </div>
    </Modal>
  );
}

/** What a bulk edit can change, built from only the boxes that were ticked. */
interface BulkChanges {
  rating?: string;
  madeCount?: number;
  category?: string;
  sourceUrl?: string;
  tagEdit?: { mode: "add" | "remove" | "replace"; tags: string[] };
}

function BulkEditor({
  count,
  categories,
  isBusy,
  onCancel,
  onApply,
}: {
  count: number;
  /** Offered in the category box's dropdown; a new one can still be typed. */
  categories: RecipeCategoryCount[];
  isBusy: boolean;
  onCancel: () => void;
  onApply: (changes: BulkChanges) => void;
}) {
  // A tick per field, which is the whole safety property of this dialog: only a
  // ticked field is sent, so a blank box cannot blank a column across a selection.
  const [doRating, setDoRating] = useState(false);
  const [rating, setRating] = useState("");
  const [doMadeCount, setDoMadeCount] = useState(false);
  const [madeCount, setMadeCount] = useState("0");
  const [doCategory, setDoCategory] = useState(false);
  const [category, setCategory] = useState("");
  const [doSource, setDoSource] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [doTags, setDoTags] = useState(false);
  const [tagMode, setTagMode] = useState<"add" | "remove" | "replace">("add");
  const [tagText, setTagText] = useState("");

  const nothingTicked = !doRating && !doMadeCount && !doCategory && !doSource && !doTags;

  return (
    <Modal
      title={`Edit ${count} recipes`}
      description="Only the fields you tick are changed. Everything else is left alone."
      isBusy={isBusy}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" disabled={isBusy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={isBusy || nothingTicked}
            onClick={() =>
              onApply({
                ...(doRating ? { rating } : {}),
                ...(doMadeCount ? { madeCount: Number(madeCount) } : {}),
                ...(doCategory ? { category } : {}),
                ...(doSource ? { sourceUrl } : {}),
                ...(doTags ? { tagEdit: { mode: tagMode, tags: parseTags(tagText) } } : {}),
              })
            }
          >
            {isBusy ? "Applying…" : `Apply to ${count}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={doRating} onChange={(event) => setDoRating(event.target.checked)} />
          <span className="w-28">Rating</span>
          <input
            className={INPUT_CLASS}
            type="number"
            min={RECIPE_RATING_MIN}
            max={RECIPE_RATING_MAX}
            value={rating}
            disabled={!doRating}
            placeholder="blank = unrated"
            onChange={(event) => setRating(event.target.value)}
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={doMadeCount}
            onChange={(event) => setDoMadeCount(event.target.checked)}
          />
          <span className="w-28">Made count</span>
          <input
            className={INPUT_CLASS}
            type="number"
            min={0}
            value={madeCount}
            disabled={!doMadeCount}
            onChange={(event) => setMadeCount(event.target.value)}
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={doCategory}
            onChange={(event) => setDoCategory(event.target.checked)}
          />
          <span className="w-28">Category</span>
          {/* Same datalist as the editor's, under its own id: two `<datalist>`
              elements sharing one id would be a duplicate DOM id whenever both
              dialogs have been opened. Blank clears the category on every
              selected recipe, which is a legitimate thing to want and is why
              this field has no placeholder promising otherwise. */}
          <input
            className={INPUT_CLASS}
            list="household-bulk-categories"
            value={category}
            disabled={!doCategory}
            placeholder="blank = uncategorised"
            onChange={(event) => setCategory(event.target.value)}
          />
          <datalist id="household-bulk-categories">
            {categories.map((entry) => (
              <option key={entry.name} value={entry.name} />
            ))}
          </datalist>
        </label>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={doSource} onChange={(event) => setDoSource(event.target.checked)} />
          <span className="w-28">Source</span>
          <input
            className={INPUT_CLASS}
            value={sourceUrl}
            disabled={!doSource}
            placeholder="https://… or blank to clear"
            onChange={(event) => setSourceUrl(event.target.value)}
          />
        </label>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={doTags} onChange={(event) => setDoTags(event.target.checked)} />
            <span className="w-28">Tags</span>
            <select
              className={INPUT_CLASS}
              value={tagMode}
              disabled={!doTags}
              onChange={(event) => setTagMode(event.target.value as "add" | "remove" | "replace")}
            >
              <option value="add">Add these</option>
              <option value="remove">Remove these</option>
              <option value="replace">Replace with these</option>
            </select>
          </label>
          <input
            className={`${INPUT_CLASS} ml-[9.5rem] max-lg:ml-0`}
            value={tagText}
            disabled={!doTags}
            placeholder="weeknight, freezer"
            onChange={(event) => setTagText(event.target.value)}
          />
        </div>

        <p className="text-xs text-muted">
          Name, ingredients and directions are deliberately not offered here — setting many
          recipes to one name or one method is never what a bulk edit means.
        </p>
      </div>
    </Modal>
  );
}
