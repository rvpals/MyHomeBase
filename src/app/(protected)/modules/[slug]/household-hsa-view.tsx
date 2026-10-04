"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { Modal } from "@/components/modal";
import { ViewModeSwitch, type ViewModeOption } from "@/components/view-mode-switch";
import { groupHsaExpensesByYear } from "@/lib/household/hsa-grouping";
// Leaf modules, not the `@/lib/household` barrel: the barrel re-exports the SQLite
// repositories, which would drag better-sqlite3 into this client bundle.
import type { HsaCard, HsaExpense } from "@/lib/household/hsa-types";
import { centsToDollars, formatCents } from "@/lib/shared/money";
import { toLocalTimeLabel, todayIsoLocal } from "@/lib/shared/date";
import { PAGE_CONTAINER } from "../../page-container";
import {
  clearHsaReceiptAction,
  createHsaExpenseAction,
  deleteHsaExpensesAction,
  setHsaReceiptAction,
  setHsaReimbursedAction,
  updateHsaExpenseAction,
} from "./household-actions";
import { HsaEditor, type HsaForm, type HsaReceiptChoice } from "./household-hsa-editor";

/**
 * A blank form stamped with the current date and time.
 *
 * Built when the dialog opens rather than once at module load, so the second expense
 * of a sitting is stamped when it is written. Browser-side for the same reason the
 * Journal's entry form is: the clock that matters is the writer's.
 */
function emptyForm(): HsaForm {
  return {
    entryDate: todayIsoLocal(),
    entryTime: toLocalTimeLabel(new Date()),
    amount: "",
    productService: "",
    type: "Pharmacy",
    payee: "",
    serviceDate: "",
    paidWith: "",
    note: "",
    isReimbursed: false,
  };
}

function toForm(expense: HsaExpense): HsaForm {
  return {
    entryDate: expense.entryDate,
    entryTime: expense.entryTime,
    amount: (expense.amountCents / 100).toFixed(2),
    productService: expense.productService,
    type: expense.type,
    payee: expense.payee,
    serviceDate: expense.serviceDate ?? "",
    paidWith: expense.paidWith,
    note: expense.note,
    isReimbursed: expense.isReimbursed,
  };
}

/**
 * How the list is cut. "All" is the flat grid; "By year" groups it.
 *
 * A `ViewModeSwitch` rather than a lone "By year" button, per components.md: every
 * option answers the same question about the same rows, and a one-way button would
 * leave no way back to the flat list.
 */
const VIEW_MODE_OPTIONS: readonly ViewModeOption<"all" | "year">[] = [
  { key: "all", label: "All", hint: "Every expense in one list" },
  { key: "year", label: "By year", hint: "Grouped by the year of each expense's date" },
];

/**
 * Where a receipt is served from.
 *
 * `?v=` busts the route's 5-minute private cache off `updatedAt`, so a replaced
 * receipt doesn't keep showing the file it replaced.
 */
function receiptHref(expense: HsaExpense): string {
  return `/api/household/hsa/${expense.id}/receipt?v=${encodeURIComponent(expense.updatedAt)}`;
}

type Dialog =
  | { kind: "closed" }
  | { kind: "view"; expense: HsaExpense }
  | {
      kind: "edit";
      id?: number;
      form: HsaForm;
      receipt: HsaReceiptChoice;
      existingReceiptName: string;
      error?: string;
    }
  | { kind: "delete"; expense: HsaExpense }
  | { kind: "bulk-delete"; rows: HsaExpense[]; clear: () => void };

/** How many of a set carry a receipt file — what a delete warning has to name. */
function countWithReceipt(rows: HsaExpense[]): number {
  return rows.filter((row) => row.hasReceipt).length;
}

export function HouseholdHsaView({
  expenses,
  cards,
  productServices,
  receiptRootSet,
}: {
  expenses: HsaExpense[];
  /** Every card; only the active ones are offered in the editor. */
  cards: HsaCard[];
  productServices: string[];
  /** Whether a receipt folder is configured. Without one, a receipt cannot be attached. */
  receiptRootSet: boolean;
}) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [dialog, setDialog] = useState<Dialog>({ kind: "closed" });
  const [viewMode, setViewMode] = useState<"all" | "year">("all");
  // Which year is expanded. One at a time: several open grids each carry their own
  // toolbar, paging and footer total, at which point nothing reads as a summary —
  // the same call the Expense Transactions screen makes.
  const [openYear, setOpenYear] = useState<string>();

  const activeCardNames = cards.filter((card) => card.isActive).map((card) => card.name);
  // Grouped in the library, not here — the view only renders what it returns.
  const yearGroups = groupHsaExpensesByYear(expenses);

  /**
   * Runs an action, surfaces its error in the page banner, and refreshes on success.
   *
   * A delete can succeed on the rows and still leave a file behind, so a successful
   * result carrying `filesNotDeleted` is reported too — silently dropping it would
   * leave files in the folder that nothing on screen accounts for.
   */
  async function run(
    work: () => Promise<{ ok: boolean; error?: string; filesNotDeleted?: string[] }>,
    after?: () => void,
  ) {
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
    if (result.filesNotDeleted && result.filesNotDeleted.length > 0) {
      setError(
        `Deleted, but these receipt files are still in the receipt folder and need removing by hand: ${result.filesNotDeleted.join(", ")}.`,
      );
    }
    router.refresh();
  }

  /**
   * Saves the editor, then applies the receipt choice.
   *
   * Two round trips, in this order: a new expense has no id until it exists. They fail
   * independently, and the message says which got through — a saved expense whose
   * receipt failed must not read as "nothing was saved", or the whole form is retyped
   * over a row that is already there.
   */
  async function save(current: Extract<Dialog, { kind: "edit" }>) {
    const { form, receipt } = current;
    const input = { ...form, serviceDate: form.serviceDate || null };

    setIsBusy(true);
    const fail = (message: string) => {
      setIsBusy(false);
      // Shown inside the dialog: a banner in the page body sits behind the overlay.
      setDialog({ ...current, error: message });
    };

    let expenseId: number;
    if (current.id === undefined) {
      const created = await createHsaExpenseAction(input);
      if (!created.ok || created.id === undefined) {
        return fail(created.error ?? "Could not save that expense.");
      }
      expenseId = created.id;
    } else {
      const updated = await updateHsaExpenseAction(current.id, input);
      if (!updated.ok) return fail(updated.error ?? "Could not save that expense.");
      expenseId = current.id;
    }

    if (receipt.kind !== "keep") {
      const result =
        receipt.kind === "new"
          ? await setHsaReceiptAction(expenseId, receipt.upload)
          : await clearHsaReceiptAction(expenseId);
      if (result.ok && "oldFileNotDeleted" in result && result.oldFileNotDeleted) {
        setIsBusy(false);
        setDialog({ kind: "closed" });
        setError(
          `Saved. The receipt it replaced, ${result.oldFileNotDeleted}, could not be deleted and is still in the receipt folder.`,
        );
        router.refresh();
        return;
      }
      if (!result.ok) {
        setIsBusy(false);
        setDialog({ kind: "closed" });
        setError(
          `The expense was saved, but its receipt could not be ${
            receipt.kind === "new" ? "attached" : "removed"
          }: ${result.error ?? "something went wrong."} Open it and try again.`,
        );
        router.refresh();
        return;
      }
    }

    setIsBusy(false);
    setDialog({ kind: "closed" });
    router.refresh();
  }

  const columns: DataGridColumn<HsaExpense>[] = [
    {
      key: "date",
      header: "Date",
      render: (row) => (
        <div className="whitespace-nowrap text-ink">
          {row.entryDate}
          {row.entryTime && <span className="text-muted"> {row.entryTime}</span>}
        </div>
      ),
      value: (row) => `${row.entryDate} ${row.entryTime}`.trim(),
    },
    {
      key: "amount",
      header: "Amount",
      render: (row) => <span className="whitespace-nowrap">{formatCents(row.amountCents)}</span>,
      value: (row) => centsToDollars(row.amountCents),
      aggregate: "sum",
      formatAggregate: (total) => formatCents(Math.round(total * 100)),
    },
    {
      key: "productService",
      header: "Product or service",
      render: (row) => row.productService,
      value: (row) => row.productService,
    },
    { key: "type", header: "Type", render: (row) => row.type, value: (row) => row.type },
    { key: "payee", header: "Payee", render: (row) => row.payee, value: (row) => row.payee },
    {
      key: "serviceDate",
      header: "Date of service",
      render: (row) => row.serviceDate ?? <span className="text-muted">—</span>,
      value: (row) => row.serviceDate ?? "",
    },
    {
      key: "paidWith",
      header: "Paid with",
      render: (row) => row.paidWith || <span className="text-muted">—</span>,
      value: (row) => row.paidWith,
    },
    {
      key: "isReimbursed",
      header: "Reimbursed?",
      render: (row) => (row.isReimbursed ? "Yes" : "No"),
      value: (row) => (row.isReimbursed ? "Yes" : "No"),
    },
    {
      // One column, not the "Receipt attached?" Yes/No plus a separate file-name link
      // it used to be: both answered the same question and the pair cost width on
      // every row. `value` stays "Yes"/"No" so the column still sorts, filters and
      // exports as the flag it is — the link is presentation over that.
      key: "receipt",
      header: "Receipt",
      render: (row) =>
        row.hasReceipt ? (
          <a
            href={receiptHref(row)}
            target="_blank"
            rel="noreferrer noopener"
            className="whitespace-nowrap text-brass underline"
            title={row.receiptPath}
            // The row opens the viewer; this link opens the file instead.
            onClick={(event) => event.stopPropagation()}
          >
            ◉ Open
          </a>
        ) : (
          <span className="text-muted">—</span>
        ),
      value: (row) => (row.hasReceipt ? "Yes" : "No"),
    },
    {
      key: "note",
      header: "Note",
      render: (row) => row.note || <span className="text-muted">—</span>,
      value: (row) => row.note,
    },
    {
      key: "actions",
      header: "",
      excludeFromRecordView: true,
      render: (row) => (
        <div className="flex gap-1" onClick={(event) => event.stopPropagation()}>
          <Button
            size="sm"
            variant="secondary"
            disabled={isBusy}
            onClick={() =>
              setDialog({
                kind: "edit",
                id: row.id,
                form: toForm(row),
                receipt: { kind: "keep" },
                // The stored path, not the name the upload arrived under: it is what
                // the file is actually called in the receipt folder.
                existingReceiptName: row.hasReceipt ? row.receiptPath : "",
              })
            }
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={isBusy}
            onClick={() => setDialog({ kind: "delete", expense: row })}
          >
            Delete
          </Button>
        </div>
      ),
    },
  ];

  /**
   * The expenses table. One definition, rendered either flat or inside a year —
   * identical columns, selection, bulk actions and export, because it is one table
   * looked at two ways rather than two tables.
   */
  function renderGrid(rows: HsaExpense[], storageKey: string) {
    return (
      <DataGrid
        columns={columns}
        rows={rows}
        // The row's real database id, never its position.
        getRowKey={(row) => row.id}
        enableSelection
        // Forwarded to DataGridCompact too, so bulk actions survive below 1024px.
        renderSelectionActions={(selectedRows, clearSelection) => (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={isBusy}
              onClick={() =>
                run(
                  () => setHsaReimbursedAction(selectedRows.map((row) => row.id), true),
                  clearSelection,
                )
              }
            >
              Mark {selectedRows.length} reimbursed
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={isBusy}
              onClick={() =>
                run(
                  () => setHsaReimbursedAction(selectedRows.map((row) => row.id), false),
                  clearSelection,
                )
              }
            >
              Mark not reimbursed
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
        // Same destination as a row's own record view would be, but this is the
        // purpose-built one. The Edit/Delete buttons stop propagation, so clicking
        // them never opens it.
        onRowClick={(row) => setDialog({ kind: "view", expense: row })}
        // The generic column-dump modal is off: this screen has its own viewer, and
        // two "open the record" affordances that look different would be confusing.
        enableRecordView={false}
        emptyMessage="No HSA expenses yet — add the first one."
        exportFileName="hsa-expenses"
        storageKey={storageKey}
      />
    );
  }

  return (
    <div className={PAGE_CONTAINER}>
      {error && (
        <p className="mb-3 rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink">
          {error}
        </p>
      )}

      {!receiptRootSet && (
        <p className="mb-3 rounded-md border border-line bg-paper px-3 py-2 text-sm text-muted">
          No receipt folder is set, so receipts cannot be attached yet. An administrator
          can set one under Household → Configuration. Expenses can still be recorded.
        </p>
      )}

      <div className="mb-4 flex gap-2 max-lg:flex-col">
        <Button
          variant="primary"
          onClick={() =>
            setDialog({
              kind: "edit",
              form: emptyForm(),
              receipt: { kind: "keep" },
              existingReceiptName: "",
            })
          }
        >
          Add expense
        </Button>
      </div>

      <div className="mb-3">
        <ViewModeSwitch
          options={VIEW_MODE_OPTIONS}
          value={viewMode}
          onChange={(next) => {
            setViewMode(next);
            // Closing on a switch is the honest reset: an open year means nothing in
            // the flat list, and leaving it set would surprise on the way back.
            setOpenYear(undefined);
          }}
          label="View"
        />
      </div>

      {viewMode === "all" ? (
        renderGrid(expenses, "household-hsa")
      ) : yearGroups.length === 0 ? (
        <p className="rounded-md border border-line bg-paper px-3 py-6 text-center text-sm text-muted">
          No HSA expenses yet — add the first one.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-md border border-line bg-paper">
          {yearGroups.map((group) => {
            const isOpen = group.key === openYear;
            return (
              <li key={group.key}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-paper-raised max-lg:flex-col max-lg:items-start"
                  aria-expanded={isOpen}
                  onClick={() => setOpenYear(isOpen ? undefined : group.key)}
                >
                  <span className="font-display text-base text-ink">
                    <span aria-hidden="true" className="mr-2 text-muted">
                      {isOpen ? "▾" : "▸"}
                    </span>
                    {group.key}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                    <span>
                      {group.expenseCount} {group.expenseCount === 1 ? "expense" : "expenses"}
                    </span>
                    <span>
                      {group.receiptCount} receipt{group.receiptCount === 1 ? "" : "s"}
                    </span>
                    {group.unreimbursedCents > 0 && (
                      <span>{formatCents(group.unreimbursedCents)} unreimbursed</span>
                    )}
                    <span className="font-medium text-ink">{formatCents(group.totalCents)}</span>
                  </span>
                </button>
                {isOpen && (
                  <div className="border-t border-line bg-paper-raised p-3">
                    {/* One storageKey across every year, so the columns you arranged
                        stay arranged as you move between them — a per-year key would
                        make each year forget. A different key from the flat list, since
                        the two are laid out independently. */}
                    {renderGrid(group.rows, "household-hsa-year")}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {dialog.kind === "view" && (
        <HsaExpenseViewer
          expense={dialog.expense}
          onClose={() => setDialog({ kind: "closed" })}
          onEdit={() =>
            setDialog({
              kind: "edit",
              id: dialog.expense.id,
              form: toForm(dialog.expense),
              receipt: { kind: "keep" },
              existingReceiptName: dialog.expense.hasReceipt ? dialog.expense.receiptPath : "",
            })
          }
        />
      )}

      {dialog.kind === "edit" && (
        <HsaEditor
          form={dialog.form}
          expenseId={dialog.id}
          existingReceiptName={dialog.existingReceiptName}
          receipt={dialog.receipt}
          activeCards={activeCardNames}
          productServices={productServices}
          canAttachReceipt={receiptRootSet}
          isNew={dialog.id === undefined}
          isBusy={isBusy}
          error={dialog.error}
          onChange={(form) => setDialog({ ...dialog, form, error: undefined })}
          onReceipt={(receipt) => setDialog({ ...dialog, receipt, error: undefined })}
          onCancel={() => setDialog({ kind: "closed" })}
          onSave={() => save(dialog)}
        />
      )}

      {dialog.kind === "delete" && (
        <Modal
          title="Delete this expense?"
          description={`${dialog.expense.productService} — ${formatCents(dialog.expense.amountCents)}`}
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
                onClick={() => run(() => deleteHsaExpensesAction([dialog.expense.id]))}
              >
                Delete
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">
            {dialog.expense.hasReceipt ? (
              <>
                This deletes the expense <strong className="text-ink">and its receipt file</strong>{" "}
                from the receipt folder (
                <span className="text-ink">{dialog.expense.receiptPath}</span>). It cannot be
                undone.
              </>
            ) : (
              <>This deletes the expense. It cannot be undone.</>
            )}
          </p>
        </Modal>
      )}

      {dialog.kind === "bulk-delete" && (
        <Modal
          title={`Delete ${dialog.rows.length} expenses?`}
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
                  run(() => deleteHsaExpensesAction(dialog.rows.map((row) => row.id)), dialog.clear)
                }
              >
                Delete {dialog.rows.length}
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">
            {countWithReceipt(dialog.rows) > 0 ? (
              <>
                This deletes {dialog.rows.length} expenses and{" "}
                <strong className="text-ink">
                  {countWithReceipt(dialog.rows)} receipt{countWithReceipt(dialog.rows) === 1 ? "" : "s"}
                </strong>{" "}
                from the receipt folder. It cannot be undone.
              </>
            ) : (
              <>This deletes {dialog.rows.length} expenses. None has a receipt. It cannot be undone.</>
            )}
          </p>
          <ul className="mt-2 flex max-h-40 list-disc flex-col gap-0.5 overflow-auto pl-5 text-sm text-ink">
            {dialog.rows.map((row) => (
              <li key={row.id}>
                {row.entryDate} · {row.productService} · {formatCents(row.amountCents)}
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}

/** One labelled fact in the viewer. Renders a dash rather than nothing when empty. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}

/**
 * The record view for one expense.
 *
 * Purpose-built rather than `DataGrid`'s generic column dump, for the receipt: that
 * modal can only print a column's rendered cell, where this gives the attachment its
 * own block with the stored file name and a control that opens it.
 *
 * The file is a LINK, not an inline image — a receipt is read full-size or not at all,
 * and a PDF cannot be previewed in an `img` anyway. So nothing here loads the bytes;
 * opening is one deliberate click.
 */
function HsaExpenseViewer({
  expense,
  onClose,
  onEdit,
}: {
  expense: HsaExpense;
  onClose: () => void;
  onEdit: () => void;
}) {
  const dash = <span className="text-muted">—</span>;

  return (
    <Modal
      title={`${expense.productService} — ${formatCents(expense.amountCents)}`}
      description={`${expense.entryDate}${expense.entryTime ? ` ${expense.entryTime}` : ""} · ${expense.payee}`}
      size="lg"
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
        {/* Two columns on a desktop, one on a phone — `max-lg:` so the wide layout
            cannot regress. */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 max-lg:grid-cols-1">
          <Fact label="Amount">{formatCents(expense.amountCents)}</Fact>
          <Fact label="Type">{expense.type}</Fact>
          <Fact label="Product or service">{expense.productService}</Fact>
          <Fact label="Payee">{expense.payee}</Fact>
          <Fact label="Date">
            {expense.entryDate}
            {expense.entryTime && <span className="text-muted"> {expense.entryTime}</span>}
          </Fact>
          <Fact label="Date of service">{expense.serviceDate ?? dash}</Fact>
          <Fact label="Paid with">{expense.paidWith || dash}</Fact>
          <Fact label="Reimbursed">{expense.isReimbursed ? "Yes" : "No"}</Fact>
        </dl>

        {expense.note && (
          // `.panel-inset` — design.md's groove, over bg-paper because the recess
          // darkens whatever surface it is given.
          <div className="panel-inset rounded-md bg-paper px-3 py-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Note</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{expense.note}</p>
          </div>
        )}

        <div className="panel-inset rounded-md bg-paper px-3 py-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Receipt</h3>
          {expense.hasReceipt ? (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-sm text-ink">◉ Attached</span>
              <a
                href={receiptHref(expense)}
                target="_blank"
                rel="noreferrer noopener"
                className="break-all text-sm text-brass underline"
              >
                {expense.receiptPath}
              </a>
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted">
              No receipt attached. Use Edit to add one.
            </p>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line pt-3 text-xs text-muted max-lg:grid-cols-1">
          <div>
            <dt className="inline font-medium uppercase tracking-wide">Added</dt>{" "}
            <dd className="inline text-ink">{expense.createdAt}</dd>
          </div>
          <div>
            <dt className="inline font-medium uppercase tracking-wide">Updated</dt>{" "}
            <dd className="inline text-ink">{expense.updatedAt}</dd>
          </div>
        </dl>
      </div>
    </Modal>
  );
}
