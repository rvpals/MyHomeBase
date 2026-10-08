"use client";

// The Report section's list of reports: name, description, and what each one
// covers, with Run / Edit / Duplicate / Delete per row.
//
// Route-local rather than registered — nothing outside My Journal renders this.
// The pieces it is made of (CollapsibleCard, Button, SlotIcon, TreeIcon) all
// come from the registry.
//
// No logic here: which reports exist, whether one may be deleted, and what a
// selection means all come from `@/lib/journal-reports`.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { SlotIcon } from "@/components/slot-icon";
import { TreeIcon } from "@/components/tree-icons";
import { getIconSlot } from "@/lib/icons";
import type { JournalReportSummary } from "@/lib/journal-reports";
import { deleteReportAction, duplicateReportAction } from "./journal-report-actions";

const LIST_SLOT = getIconSlot("journal_report_list")!;
const RUN_SLOT = getIconSlot("journal_report_run")!;
const EDIT_SLOT = getIconSlot("journal_report_edit")!;

/** One line saying what a report covers, for the row. */
function describeSelection(report: JournalReportSummary): string {
  if (report.whereText.trim() === "") return "Every entry";
  return report.whereMode === "sql" ? `SQL: ${report.whereText}` : report.whereText;
}

export function JournalReportsView({
  reports,
  canUseSql,
}: {
  reports: JournalReportSummary[];
  /** Admin. Only used to label a SQL-mode row — the gate itself is in the action. */
  canUseSql: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<number>();
  const [error, setError] = useState<string>();
  // Delete asks first. A report carries a hand-written template, so an
  // accidental click costs real work.
  const [confirmId, setConfirmId] = useState<number>();

  async function handleDuplicate(id: number) {
    setBusyId(id);
    setError(undefined);
    const result = await duplicateReportAction(id);
    setBusyId(undefined);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Straight into the copy's editor: duplicating is almost always the first
    // step of editing the copy.
    if (result.reportId) router.push(`/modules/journal/report?edit=${result.reportId}`);
    else router.refresh();
  }

  async function handleDelete(id: number) {
    setBusyId(id);
    setError(undefined);
    const result = await deleteReportAction(id);
    setBusyId(undefined);
    setConfirmId(undefined);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <CollapsibleCard
        title="Reports"
        titleIcon={<SlotIcon slot={LIST_SLOT} />}
        defaultOpen
      >
        {error && (
          <p className="mb-4 rounded-md border border-red-800/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        {reports.length === 0 ? (
          <p className="text-sm text-muted">
            No reports yet. Create one to print a slice of your journal.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {reports.map((report) => (
              <li
                key={report.id}
                // Row goes to a column under 1024px so the actions drop below
                // the name rather than squeezing it. `max-lg:` only, so the
                // desktop classes are untouched.
                className="flex items-start justify-between gap-4 py-3 max-lg:flex-col max-lg:gap-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-display text-base font-semibold text-ink">
                      {report.name}
                    </p>
                    {report.isBuiltin && (
                      <span
                        className="rounded-full border border-line px-2 py-0.5 text-[0.65rem] uppercase tracking-wide text-muted"
                        title="A built-in report. You can edit it, but it can't be deleted."
                      >
                        Built-in
                      </span>
                    )}
                    {report.whereMode === "sql" && canUseSql && (
                      <span
                        className="rounded-full border border-line px-2 py-0.5 text-[0.65rem] uppercase tracking-wide text-muted"
                        title="This report selects its entries with raw SQL."
                      >
                        SQL
                      </span>
                    )}
                  </div>
                  {report.description && (
                    <p className="mt-0.5 text-sm text-muted">{report.description}</p>
                  )}
                  <p className="mt-1 truncate text-xs text-muted" title={describeSelection(report)}>
                    {describeSelection(report)}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2 max-lg:w-full max-lg:flex-wrap">
                  <Button
                    size="sm"
                    href={`/modules/journal/report?run=${report.id}`}
                    title={`Run ${report.name}`}
                  >
                    <SlotIcon slot={RUN_SLOT} className="h-4 w-4" />
                    Run
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    href={`/modules/journal/report?edit=${report.id}`}
                    title={`Edit ${report.name}`}
                  >
                    <SlotIcon slot={EDIT_SLOT} className="h-4 w-4" />
                    Edit
                  </Button>
                  {/* Duplicate and Delete keep bare glyphs: they are row
                      actions, not places, so they are deliberately not slotted.
                      `clip` rather than a copy glyph -- TREE_ICON_NAMES has no
                      "copy", and inventing one for a row action would be a new
                      glyph for the whole app to carry. */}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleDuplicate(report.id)}
                    disabled={busyId === report.id}
                    title={`Duplicate ${report.name}`}
                    ariaLabel={`Duplicate ${report.name}`}
                  >
                    <TreeIcon name="clip" className="h-4 w-4" />
                  </Button>
                  {!report.isBuiltin &&
                    (confirmId === report.id ? (
                      <>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleDelete(report.id)}
                          disabled={busyId === report.id}
                        >
                          Really delete
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setConfirmId(undefined)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => setConfirmId(report.id)}
                        title={`Delete ${report.name}`}
                        ariaLabel={`Delete ${report.name}`}
                      >
                        <TreeIcon name="trash" className="h-4 w-4" />
                      </Button>
                    ))}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 border-t border-line pt-4">
          <Button href="/modules/journal/report?edit=new">New report</Button>
        </div>
      </CollapsibleCard>
    </div>
  );
}
