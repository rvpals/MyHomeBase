"use client";

// The Custom Views section: a grid of every saved view, and the builder form.
//
// Presentation only. Every rule about whether a definition is saveable lives in
// src/lib/csv-analytics/custom-views.ts; this screen collects the form and renders
// whatever the action says went wrong.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import {
  FilterCriteriaRow,
  type FilterCriteriaOperatorOption,
} from "@/components/filter-criteria-row";
import {
  CSV_VIEW_OPERATORS,
  CSV_VIEW_OPERATOR_ARITY,
  CSV_VIEW_OPERATOR_LABELS,
  describeCriteria,
  describeOrderBy,
  operatorArity,
  type CsvAnalyticEntry,
  type CsvCustomView,
  type CsvSortDirection,
  type CsvViewCriterion,
  type CsvViewOperator,
  type CsvViewOrderBy,
} from "@/lib/csv-analytics";
import {
  createCsvCustomViewAction,
  deleteCsvCustomViewAction,
  setCsvCustomViewEnabledAction,
  updateCsvCustomViewAction,
} from "./csv-analytics-actions";

const CONTROL_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/** The operator dropdown, built once from the library's own tables. */
const OPERATOR_OPTIONS: FilterCriteriaOperatorOption[] = CSV_VIEW_OPERATORS.map((operator) => ({
  value: operator,
  label: CSV_VIEW_OPERATOR_LABELS[operator],
  arity: CSV_VIEW_OPERATOR_ARITY[operator],
}));

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 250, 500, 1000] as const;

/**
 * A list operator stores one value per item, but the builder collects them as one
 * comma-separated field — so the two forms are converted at the form boundary rather
 * than making `FilterCriteriaRow` know about lists.
 */
function criterionToFormValues(criterion: CsvViewCriterion): string[] {
  return operatorArity(criterion.operator) === "list"
    ? [criterion.values.join(", ")]
    : criterion.values;
}

function formValuesToCriterion(operator: CsvViewOperator, values: string[]): string[] {
  if (operatorArity(operator) === "none") return [];
  if (operatorArity(operator) === "list") {
    return (values[0] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value !== "");
  }
  return values;
}

interface ViewFormState {
  name: string;
  description: string;
  selectedColumns: string[];
  criteria: CsvViewCriterion[];
  orderBy: CsvViewOrderBy[];
  recordsPerPage: number;
  isEnabled: boolean;
}

function emptyForm(): ViewFormState {
  return {
    name: "",
    description: "",
    selectedColumns: [],
    criteria: [],
    orderBy: [],
    recordsPerPage: 100,
    isEnabled: true,
  };
}

function formFromView(view: CsvCustomView): ViewFormState {
  return {
    name: view.name,
    description: view.description ?? "",
    selectedColumns: view.selectedColumns,
    criteria: view.criteria,
    orderBy: view.orderBy,
    recordsPerPage: view.recordsPerPage,
    isEnabled: view.isEnabled,
  };
}

/**
 * The build/edit form for one view.
 *
 * `entry` is fixed once the form is open: a view's criteria name that entry's columns,
 * so the entry is chosen before building rather than being another field that can
 * change under the criteria (see migration 0081).
 */
function ViewForm({
  entry,
  view,
  onDone,
  onCancel,
}: {
  entry: CsvAnalyticEntry;
  view?: CsvCustomView;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<ViewFormState>(view ? formFromView(view) : emptyForm());
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  function patch(changes: Partial<ViewFormState>) {
    setForm((current) => ({ ...current, ...changes }));
  }

  function toggleColumn(name: string) {
    patch({
      selectedColumns: form.selectedColumns.includes(name)
        ? form.selectedColumns.filter((column) => column !== name)
        : // Kept in the entry's own column order rather than click order, so the
          // result grid reads like the dataset unless the order is deliberate.
          entry.columns
            .map((column) => column.name)
            .filter((column) => column === name || form.selectedColumns.includes(column)),
    });
  }

  function addCriterion() {
    patch({
      criteria: [
        ...form.criteria,
        { column: entry.columns[0]?.name ?? "", operator: "equals", values: [""] },
      ],
    });
  }

  function updateCriterion(index: number, changes: Partial<CsvViewCriterion>) {
    patch({
      criteria: form.criteria.map((criterion, position) =>
        position === index ? { ...criterion, ...changes } : criterion,
      ),
    });
  }

  function removeCriterion(index: number) {
    patch({ criteria: form.criteria.filter((_, position) => position !== index) });
  }

  function addOrderBy() {
    // Offers the first column not already ordered on, since naming one twice is
    // refused by the use-case anyway.
    const used = new Set(form.orderBy.map((order) => order.column));
    const next = entry.columns.find((column) => !used.has(column.name));
    if (!next) return;
    patch({ orderBy: [...form.orderBy, { column: next.name, direction: "asc" }] });
  }

  function updateOrderBy(index: number, changes: Partial<CsvViewOrderBy>) {
    patch({
      orderBy: form.orderBy.map((order, position) =>
        position === index ? { ...order, ...changes } : order,
      ),
    });
  }

  function removeOrderBy(index: number) {
    patch({ orderBy: form.orderBy.filter((_, position) => position !== index) });
  }

  async function handleSubmit() {
    setIsBusy(true);
    setError(undefined);

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() === "" ? undefined : form.description.trim(),
      selectedColumns: form.selectedColumns,
      criteria: form.criteria.map((criterion) => ({
        ...criterion,
        values: formValuesToCriterion(criterion.operator, criterion.values),
      })),
      orderBy: form.orderBy,
      recordsPerPage: form.recordsPerPage,
      isEnabled: form.isEnabled,
    };

    const result = view
      ? await updateCsvCustomViewAction(view.id, payload)
      : await createCsvCustomViewAction({ ...payload, entryId: entry.id });

    setIsBusy(false);
    if (result.ok) onDone();
    else setError(result.error ?? "Failed to save the custom view.");
  }

  const orderableRemain = form.orderBy.length < entry.columns.length;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">View name</span>
          <input
            value={form.name}
            onChange={(event) => patch({ name: event.target.value })}
            placeholder="e.g. Big sales, this quarter"
            className={CONTROL_CLASS}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Description</span>
          <input
            value={form.description}
            onChange={(event) => patch({ description: event.target.value })}
            placeholder="Optional"
            className={CONTROL_CLASS}
          />
        </label>
      </div>

      {/* Columns ------------------------------------------------------------- */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium text-ink">Columns to show</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => patch({ selectedColumns: [] })}
              className="text-xs font-medium text-brass-dark hover:underline"
            >
              All columns
            </button>
          </div>
        </div>
        <p className="text-xs text-muted">
          {form.selectedColumns.length === 0
            ? "Showing every column — including any this dataset gains later."
            : `Showing ${form.selectedColumns.length} of ${entry.columns.length} columns.`}
        </p>
        {/* A scrolling checkbox list rather than a wide chip row: it behaves the same
            at both sizes and copes with a 60-column dataset. */}
        <div className="grid max-h-48 grid-cols-3 gap-x-4 gap-y-1 overflow-y-auto rounded-md border border-line bg-paper-raised p-3 max-lg:grid-cols-1">
          {entry.columns.map((column) => (
            <label key={column.name} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={form.selectedColumns.includes(column.name)}
                onChange={() => toggleColumn(column.name)}
                className="h-4 w-4 rounded border-line text-brass"
              />
              <span className="truncate" title={`${column.sourceHeader} (${column.type})`}>
                {column.sourceHeader}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Criteria ------------------------------------------------------------ */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium text-ink">Criteria</span>
          <Button size="sm" variant="secondary" onClick={addCriterion}>
            Add criterion
          </Button>
        </div>
        {form.criteria.length === 0 ? (
          <p className="text-xs text-muted">No criteria — the view shows every row.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {/* The header the wide layout aligns against; FilterCriteriaRow shows its
                own labels instead once it stacks. */}
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto] gap-2 px-1 text-xs font-medium text-muted max-lg:hidden">
              <span>Column</span>
              <span>Operator</span>
              <span>Value</span>
              <span className="w-8" />
            </div>
            {form.criteria.map((criterion, index) => (
              <FilterCriteriaRow
                key={index}
                columns={entry.columns.map((column) => ({
                  value: column.name,
                  label: column.sourceHeader,
                }))}
                operators={OPERATOR_OPTIONS}
                column={criterion.column}
                operator={criterion.operator}
                values={criterionToFormValues(criterion)}
                onColumnChange={(column) => updateCriterion(index, { column })}
                onOperatorChange={(operator) =>
                  // Reset the values with the operator: what was typed for "between"
                  // is not what "is one of" means, and carrying it over would save a
                  // criterion the user never actually wrote.
                  updateCriterion(index, {
                    operator: operator as CsvViewOperator,
                    values: operatorArity(operator as CsvViewOperator) === "none" ? [] : [""],
                  })
                }
                onValuesChange={(values) => updateCriterion(index, { values })}
                onRemove={() => removeCriterion(index)}
                disabled={isBusy}
              />
            ))}
            {form.criteria.length > 1 && (
              <p className="text-xs text-muted">All criteria must match (they are ANDed).</p>
            )}
          </div>
        )}
      </div>

      {/* Order by ------------------------------------------------------------ */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium text-ink">Order by</span>
          <Button size="sm" variant="secondary" onClick={addOrderBy} disabled={!orderableRemain}>
            Add order by
          </Button>
        </div>
        {form.orderBy.length === 0 ? (
          <p className="text-xs text-muted">
            Unordered — rows come back in whatever order the table gives them.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {form.orderBy.map((order, index) => (
              <div
                key={index}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 max-lg:grid-cols-1 max-lg:rounded-md max-lg:border max-lg:border-line max-lg:bg-paper-raised max-lg:p-3"
              >
                <select
                  value={order.column}
                  onChange={(event) => updateOrderBy(index, { column: event.target.value })}
                  className={CONTROL_CLASS}
                  aria-label={`Order by column ${index + 1}`}
                >
                  {entry.columns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.sourceHeader}
                    </option>
                  ))}
                </select>
                <select
                  value={order.direction}
                  onChange={(event) =>
                    updateOrderBy(index, { direction: event.target.value as CsvSortDirection })
                  }
                  className={CONTROL_CLASS}
                  aria-label={`Direction ${index + 1}`}
                >
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
                <button
                  type="button"
                  onClick={() => removeOrderBy(index)}
                  title="Remove this order by"
                  aria-label="Remove this order by"
                  className="rounded-md border border-line px-2 py-1.5 text-sm text-muted hover:border-red-400 hover:text-red-400 max-lg:w-full"
                >
                  <span aria-hidden="true">✕</span>
                  <span className="ml-1 hidden max-lg:inline">Remove</span>
                </button>
              </div>
            ))}
            {form.orderBy.length > 1 && (
              <p className="text-xs text-muted">Sorted by the first column, then the next.</p>
            )}
          </div>
        )}
      </div>

      {/* Paging + enabled ---------------------------------------------------- */}
      <div className="grid grid-cols-2 items-end gap-4 max-lg:grid-cols-1">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Number of records per page</span>
          <select
            value={form.recordsPerPage}
            onChange={(event) => patch({ recordsPerPage: Number(event.target.value) })}
            className={CONTROL_CLASS}
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={form.isEnabled}
            onChange={(event) => patch({ isEnabled: event.target.checked })}
            className="h-4 w-4 rounded border-line text-brass"
          />
          <span>
            Enabled
            <span className="ml-1 text-xs text-muted">
              (a disabled view stays here but is not offered on the Dashboard)
            </span>
          </span>
        </label>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <Button onClick={handleSubmit} disabled={isBusy || form.name.trim() === ""}>
          {isBusy ? "Saving…" : view ? "Save Changes" : "Create View"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function CsvCustomViewsView({
  entries,
  views,
}: {
  entries: CsvAnalyticEntry[];
  views: CsvCustomView[];
}) {
  const router = useRouter();
  const [buildingEntryId, setBuildingEntryId] = useState<number | undefined>(undefined);
  const [editingViewId, setEditingViewId] = useState<number | undefined>(undefined);
  const [newViewEntryId, setNewViewEntryId] = useState<string>("");

  const entriesById = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry] as const)),
    [entries],
  );

  async function handleToggleEnabled(view: CsvCustomView) {
    const result = await setCsvCustomViewEnabledAction(view.id, !view.isEnabled);
    if (result.ok) router.refresh();
    else window.alert(result.error);
  }

  async function handleDelete(view: CsvCustomView) {
    const confirmed = window.confirm(`Delete the view "${view.name}"? This cannot be undone.`);
    if (!confirmed) return;
    const result = await deleteCsvCustomViewAction(view.id);
    if (result.ok) router.refresh();
    else window.alert(result.error);
  }

  const columns: DataGridColumn<CsvCustomView>[] = [
    {
      key: "name",
      header: "View",
      render: (view) => view.name,
      value: (view) => view.name,
    },
    {
      key: "entry",
      header: "Dataset",
      render: (view) => entriesById.get(view.entryId)?.name ?? "—",
      value: (view) => entriesById.get(view.entryId)?.name ?? "",
    },
    {
      key: "description",
      header: "Description",
      render: (view) => <span className="text-muted">{view.description ?? "—"}</span>,
      value: (view) => view.description ?? "",
    },
    {
      key: "columns",
      header: "Columns",
      render: (view) =>
        view.selectedColumns.length === 0 ? (
          <span className="text-muted">All</span>
        ) : (
          view.selectedColumns.length
        ),
      value: (view) => view.selectedColumns.length,
    },
    {
      key: "criteria",
      header: "Criteria",
      render: (view) => <span className="font-mono text-xs">{describeCriteria(view.criteria)}</span>,
      value: (view) => describeCriteria(view.criteria),
    },
    {
      key: "orderBy",
      header: "Order by",
      render: (view) => <span className="font-mono text-xs">{describeOrderBy(view.orderBy)}</span>,
      value: (view) => describeOrderBy(view.orderBy),
    },
    {
      key: "recordsPerPage",
      header: "Per page",
      render: (view) => view.recordsPerPage,
      value: (view) => view.recordsPerPage,
    },
    {
      key: "isEnabled",
      header: "Status",
      render: (view) => (
        <span className={view.isEnabled ? "text-ink" : "text-muted"}>
          {view.isEnabled ? "Enabled" : "Disabled"}
        </span>
      ),
      value: (view) => (view.isEnabled ? "Enabled" : "Disabled"),
    },
    {
      key: "actions",
      header: "Actions",
      excludeFromRecordView: true,
      render: (view) => (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setEditingViewId(view.id);
              setBuildingEntryId(undefined);
            }}
            className="text-xs font-medium text-brass-dark hover:underline"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => handleToggleEnabled(view)}
            className="text-xs font-medium text-brass-dark hover:underline"
          >
            {view.isEnabled ? "Disable" : "Enable"}
          </button>
          <button
            type="button"
            onClick={() => handleDelete(view)}
            className="text-xs font-medium text-red-400 hover:underline"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  const editingView = views.find((view) => view.id === editingViewId);
  const editingEntry = editingView ? entriesById.get(editingView.entryId) : undefined;
  const buildingEntry = buildingEntryId ? entriesById.get(buildingEntryId) : undefined;

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted">
        There are no datasets yet. Import a CSV on the Dashboard first — a view is built
        against one dataset&apos;s columns.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="max-w-prose text-sm text-muted">
          A view is a saved query over one dataset: which columns to show, the criteria to
          filter by, how to order it and how many records a page. Apply one from the
          dataset&apos;s card on the Dashboard.
        </p>
        {/* The dataset is picked before the form opens, not inside it: a view's criteria
            name that dataset's columns, so it can't change underneath them. */}
        <div className="flex items-end gap-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">New view for</span>
            <select
              value={newViewEntryId}
              onChange={(event) => setNewViewEntryId(event.target.value)}
              className={CONTROL_CLASS}
            >
              <option value="">Pick a dataset…</option>
              {entries.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            size="sm"
            disabled={newViewEntryId === ""}
            onClick={() => {
              setBuildingEntryId(Number(newViewEntryId));
              setEditingViewId(undefined);
            }}
          >
            Build View
          </Button>
        </div>
      </div>

      {buildingEntry && (
        <CollapsibleCard title={`New view — ${buildingEntry.name}`} defaultOpen>
          <ViewForm
            entry={buildingEntry}
            onCancel={() => setBuildingEntryId(undefined)}
            onDone={() => {
              setBuildingEntryId(undefined);
              setNewViewEntryId("");
              router.refresh();
            }}
          />
        </CollapsibleCard>
      )}

      {editingView && editingEntry && (
        <CollapsibleCard
          title={`Edit view: ${editingView.name} — ${editingEntry.name}`}
          defaultOpen
        >
          <ViewForm
            entry={editingEntry}
            view={editingView}
            onCancel={() => setEditingViewId(undefined)}
            onDone={() => {
              setEditingViewId(undefined);
              router.refresh();
            }}
          />
        </CollapsibleCard>
      )}

      <DataGrid
        columns={columns}
        rows={views}
        getRowKey={(view) => view.id}
        emptyMessage="No custom views yet."
        exportFileName="csv-custom-views"
        storageKey="csv-custom-views"
      />
    </div>
  );
}
