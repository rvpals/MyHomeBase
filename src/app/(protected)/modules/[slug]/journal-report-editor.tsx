"use client";

// The report editor: the header fields, the entry selection, and the three HTML
// template boxes with a field picker that inserts a placeholder at the cursor.
//
// Route-local rather than registered — nothing outside My Journal renders this.
//
// No logic here: the field list, what counts as a valid selection, and the
// render itself all come from `@/lib/journal-reports` through the actions. The
// preview calls the same `renderReportFor` a real print does, so what you see
// is what prints.
//
// Narrow behaviour: the editor is a two-column grid at >=1024px (form left,
// preview right) and a single column below it, where the preview moves under the
// form. `max-lg:` variants only, so the desktop layout can't regress.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { SlotIcon } from "@/components/slot-icon";
import { getIconSlot } from "@/lib/icons";
import {
  JOURNAL_REPORT_ENTRY_FIELDS,
  JOURNAL_REPORT_STAT_FIELDS,
  JOURNAL_REPORT_TABLE_FIELDS,
  REPORT_PART_KINDS,
  REPORT_SORT_FIELDS,
  reportPlaceholder,
  unknownTokens,
  type JournalReport,
  type JournalReportDetail,
  type JournalReportField,
  type ReportPartKind,
} from "@/lib/journal-reports";
import { countReportMatchesAction, previewReportAction, saveReportAction } from "./journal-report-actions";

const EDIT_SLOT = getIconSlot("journal_report_edit")!;
const FIELD_SLOT = getIconSlot("journal_report_field")!;

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

const SELECT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

const TEXTAREA_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-2 font-mono text-xs leading-relaxed text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

const LABEL_CLASS = "text-xs font-medium uppercase tracking-wide text-muted";

const PART_LABELS: Record<ReportPartKind, string> = {
  header: "Header",
  row: "Row (once per entry)",
  footer: "Footer",
};

const PART_HINTS: Record<ReportPartKind, string> = {
  header: "Rendered once, before the rows. Report-wide fields and tables belong here.",
  row: "Rendered once per matching entry. Leave empty for a summary-only report.",
  footer: "Rendered once, after the rows.",
};

const SORT_FIELD_LABELS: Record<string, string> = {
  date: "Date",
  time: "Time",
  title: "Title",
  placeName: "Place",
  createdAt: "Created",
};

/** A draft as the editor holds it, before it is a stored report. */
interface Draft {
  id?: number;
  name: string;
  description: string;
  whereMode: "filter" | "sql";
  whereQuery: string;
  whereSql: string;
  sortField: string;
  sortDirection: "asc" | "desc";
  maxRows: number;
  parts: Record<ReportPartKind, string>;
}

function draftFrom(report?: JournalReport, details?: JournalReportDetail[]): Draft {
  const parts = { header: "", row: "", footer: "" } as Record<ReportPartKind, string>;
  for (const detail of details ?? []) parts[detail.part] = detail.html;

  return {
    id: report?.id,
    name: report?.name ?? "",
    description: report?.description ?? "",
    whereMode: report?.whereMode ?? "filter",
    whereQuery: report?.whereQuery ?? "",
    whereSql: report?.whereSql ?? "",
    sortField: report?.sortField ?? "date",
    sortDirection: report?.sortDirection ?? "desc",
    maxRows: report?.maxRows ?? 0,
    parts,
  };
}

/** The draft in the shape the actions' schemas parse. */
function payload(draft: Draft) {
  return {
    id: draft.id,
    name: draft.name,
    description: draft.description,
    whereMode: draft.whereMode,
    whereQuery: draft.whereQuery,
    whereSql: draft.whereSql,
    sortField: draft.sortField,
    sortDirection: draft.sortDirection,
    maxRows: draft.maxRows,
    parts: REPORT_PART_KINDS.map((part) => ({ part, html: draft.parts[part] })),
  };
}

/** The picker's three groups, so entry fields read apart from report-wide ones. */
const FIELD_GROUPS: { label: string; fields: readonly JournalReportField[] }[] = [
  { label: "This entry", fields: JOURNAL_REPORT_ENTRY_FIELDS },
  { label: "Whole report", fields: JOURNAL_REPORT_STAT_FIELDS },
  { label: "Tables", fields: JOURNAL_REPORT_TABLE_FIELDS },
];

export function JournalReportEditor({
  report,
  details,
  canUseSql,
}: {
  /** Undefined for a new report. */
  report?: JournalReport;
  details?: JournalReportDetail[];
  /** Admin. Hides the SQL toggle — the real gate is `requireAdmin()` in the action. */
  canUseSql: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(report, details));
  const [activePart, setActivePart] = useState<ReportPartKind>("header");
  const [preview, setPreview] = useState<string>();
  const [previewError, setPreviewError] = useState<string>();
  const [matchCount, setMatchCount] = useState<number>();
  const [matchError, setMatchError] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);

  // One ref per part, so the field picker can insert at the real cursor rather
  // than appending. Appending would be useless for a template whose structure
  // matters, which is most of them.
  const textareas = useRef<Partial<Record<ReportPartKind, HTMLTextAreaElement | null>>>({});

  const setPart = useCallback((part: ReportPartKind, html: string) => {
    setDraft((current) => ({ ...current, parts: { ...current.parts, [part]: html } }));
  }, []);

  /**
   * Inserts a placeholder at the cursor in the active box.
   *
   * Replaces the selection when there is one, and puts the caret after the
   * inserted text so typing continues where you'd expect.
   */
  function insertField(token: string) {
    const element = textareas.current[activePart];
    const placeholder = reportPlaceholder(token);
    if (!element) {
      setPart(activePart, draft.parts[activePart] + placeholder);
      return;
    }

    const start = element.selectionStart;
    const end = element.selectionEnd;
    const text = draft.parts[activePart];
    setPart(activePart, `${text.slice(0, start)}${placeholder}${text.slice(end)}`);

    // After React has written the new value. Without the rAF the caret lands
    // using the pre-update value and ends up in the wrong place.
    requestAnimationFrame(() => {
      element.focus();
      const caret = start + placeholder.length;
      element.setSelectionRange(caret, caret);
    });
  }

  // The live preview and the match count, debounced together. 500ms is long
  // enough that typing a template doesn't fire a render per keystroke, short
  // enough that the preview feels attached to the box.
  useEffect(() => {
    const timer = setTimeout(async () => {
      const body = payload(draft);

      const counted = await countReportMatchesAction({ ...body, previewLimit: 25 });
      if (counted.ok) {
        setMatchCount(counted.count);
        setMatchError(undefined);
      } else {
        setMatchCount(undefined);
        setMatchError(counted.error);
      }

      const rendered = await previewReportAction({ ...body, previewLimit: 25 });
      if (rendered.ok) {
        setPreview(rendered.html);
        setPreviewError(undefined);
      } else {
        setPreview(undefined);
        setPreviewError(rendered.error);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [draft]);

  async function handleSave() {
    setIsSaving(true);
    setSaveError(undefined);
    const result = await saveReportAction(payload(draft));
    setIsSaving(false);

    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    router.push("/modules/journal/report");
    router.refresh();
  }

  const warnings = REPORT_PART_KINDS.flatMap((part) => {
    const tokens = unknownTokens(draft.parts[part]);
    return tokens.length === 0 ? [] : [{ part, tokens }];
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-6 max-lg:grid-cols-1">
        {/* --- The form ------------------------------------------------- */}
        <div className="flex flex-col gap-6">
          <CollapsibleCard
            title={draft.id ? "Edit report" : "New report"}
            titleIcon={<SlotIcon slot={EDIT_SLOT} />}
            defaultOpen
          >
            <div className="flex flex-col gap-4">
              <div>
                <label className={LABEL_CLASS} htmlFor="report-name">
                  Name
                </label>
                <input
                  id="report-name"
                  className={`${INPUT_CLASS} mt-1`}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="Year in Review"
                />
              </div>

              <div>
                <label className={LABEL_CLASS} htmlFor="report-description">
                  Description
                </label>
                <input
                  id="report-description"
                  className={`${INPUT_CLASS} mt-1`}
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  placeholder="What this report shows."
                />
              </div>
            </div>
          </CollapsibleCard>

          <CollapsibleCard title="Which entries" defaultOpen>
            <div className="flex flex-col gap-4">
              {canUseSql && (
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="radio"
                      name="where-mode"
                      checked={draft.whereMode === "filter"}
                      onChange={() => setDraft({ ...draft, whereMode: "filter" })}
                    />
                    Filter query
                  </label>
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="radio"
                      name="where-mode"
                      checked={draft.whereMode === "sql"}
                      onChange={() => setDraft({ ...draft, whereMode: "sql" })}
                    />
                    Raw SQL
                  </label>
                </div>
              )}

              {draft.whereMode === "filter" ? (
                <div>
                  <label className={LABEL_CLASS} htmlFor="report-where-query">
                    Filter query
                  </label>
                  <input
                    id="report-where-query"
                    className={`${INPUT_CLASS} mt-1 font-mono`}
                    value={draft.whereQuery}
                    onChange={(event) => setDraft({ ...draft, whereQuery: event.target.value })}
                    placeholder="category = TRIP and date >= 2026-01-01"
                  />
                  <p className="mt-1 text-xs text-muted">
                    Leave empty for every entry. Fields: date, time, title, content, place,
                    category, tag, pinned, locked.
                  </p>
                </div>
              ) : (
                <div>
                  <label className={LABEL_CLASS} htmlFor="report-where-sql">
                    SQL condition (after WHERE)
                  </label>
                  <textarea
                    id="report-where-sql"
                    className={`${TEXTAREA_CLASS} mt-1`}
                    rows={3}
                    value={draft.whereSql}
                    onChange={(event) => setDraft({ ...draft, whereSql: event.target.value })}
                    placeholder="e.entry_date >= '2026-01-01' AND e.title LIKE '%trip%'"
                  />
                  <p className="mt-1 text-xs text-muted">
                    The entries table is aliased <code>e</code>. Read-only conditions only —
                    no semicolons, comments or write statements. Encrypted entries are always
                    excluded.
                  </p>
                </div>
              )}

              {/* The line that tells an author their query did something. An
                  empty report and a broken query look identical without it. */}
              {matchError ? (
                <p className="rounded-md border border-red-800/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
                  {matchError}
                </p>
              ) : (
                matchCount !== undefined && (
                  <p className="text-sm text-muted">
                    Matches {matchCount} {matchCount === 1 ? "entry" : "entries"}.
                  </p>
                )
              )}

              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className={LABEL_CLASS} htmlFor="report-sort-field">
                    Order by
                  </label>
                  <select
                    id="report-sort-field"
                    className={`${SELECT_CLASS} mt-1`}
                    value={draft.sortField}
                    onChange={(event) => setDraft({ ...draft, sortField: event.target.value })}
                  >
                    {REPORT_SORT_FIELDS.map((field) => (
                      <option key={field} value={field}>
                        {SORT_FIELD_LABELS[field] ?? field}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={LABEL_CLASS} htmlFor="report-sort-direction">
                    Direction
                  </label>
                  <select
                    id="report-sort-direction"
                    className={`${SELECT_CLASS} mt-1`}
                    value={draft.sortDirection}
                    onChange={(event) =>
                      setDraft({ ...draft, sortDirection: event.target.value as "asc" | "desc" })
                    }
                  >
                    <option value="desc">Newest first</option>
                    <option value="asc">Oldest first</option>
                  </select>
                </div>

                <div>
                  <label className={LABEL_CLASS} htmlFor="report-max-rows">
                    Max rows
                  </label>
                  <input
                    id="report-max-rows"
                    type="number"
                    min={0}
                    className={`${SELECT_CLASS} mt-1 w-28`}
                    value={draft.maxRows}
                    onChange={(event) =>
                      setDraft({ ...draft, maxRows: Number(event.target.value) || 0 })
                    }
                  />
                  <p className="mt-1 text-xs text-muted">0 = no limit</p>
                </div>
              </div>
            </div>
          </CollapsibleCard>

          <CollapsibleCard title="Template" defaultOpen>
            {/* Part tabs. Three boxes rather than one, so an aggregate report
                can leave `row` empty and still have a header and footer. */}
            <div className="flex flex-wrap gap-2 border-b border-line pb-3">
              {REPORT_PART_KINDS.map((part) => (
                <Button
                  key={part}
                  size="sm"
                  variant={activePart === part ? "primary" : "secondary"}
                  onClick={() => setActivePart(part)}
                >
                  {PART_LABELS[part]}
                  {draft.parts[part].trim() === "" ? " (empty)" : ""}
                </Button>
              ))}
            </div>

            <p className="mt-3 text-xs text-muted">{PART_HINTS[activePart]}</p>

            <textarea
              ref={(element) => {
                textareas.current[activePart] = element;
              }}
              className={`${TEXTAREA_CLASS} mt-2`}
              rows={14}
              value={draft.parts[activePart]}
              onChange={(event) => setPart(activePart, event.target.value)}
              placeholder="<h1>{{stat.reportName}}</h1>"
              spellCheck={false}
            />

            {/* --- The field picker --------------------------------------- */}
            <div className="mt-4 border-t border-line pt-4">
              <div className="flex items-center gap-2">
                <SlotIcon slot={FIELD_SLOT} className="h-4 w-4" />
                <p className={LABEL_CLASS}>Insert a field</p>
              </div>
              <p className="mt-1 text-xs text-muted">
                Click to insert at the cursor in the {PART_LABELS[activePart]} box.
              </p>

              {FIELD_GROUPS.map((group) => (
                <div key={group.label} className="mt-3">
                  <p className="text-xs font-semibold text-ink">{group.label}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {group.fields.map((field) => (
                      <button
                        key={field.token}
                        type="button"
                        onClick={() => insertField(field.token)}
                        title={field.description}
                        className="rounded-full border border-line bg-paper-raised px-2.5 py-1 text-xs text-ink transition-colors hover:border-brass hover:text-brass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                      >
                        {field.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {warnings.length > 0 && (
              <div className="mt-4 rounded-md border border-line bg-paper-raised px-3 py-2 text-xs text-muted">
                {/* A typo renders as nothing, which looks exactly like a field
                    that happened to be empty. Naming it is the only way to tell. */}
                <p className="font-semibold text-ink">Unrecognised fields</p>
                {warnings.map((warning) => (
                  <p key={warning.part} className="mt-0.5">
                    {PART_LABELS[warning.part as ReportPartKind]}: {warning.tokens.join(", ")} —
                    these will render as nothing.
                  </p>
                ))}
              </div>
            )}
          </CollapsibleCard>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleSave} disabled={isSaving || draft.name.trim() === ""}>
              {isSaving ? "Saving…" : "Save report"}
            </Button>
            <Button variant="secondary" href="/modules/journal/report">
              Cancel
            </Button>
            {saveError && <p className="text-sm text-red-300">{saveError}</p>}
          </div>
        </div>

        {/* --- The preview ---------------------------------------------- */}
        <div>
          <CollapsibleCard title="Preview" defaultOpen>
            <p className="text-xs text-muted">
              The first 25 matching entries, rendered the same way a print is.
            </p>

            {previewError ? (
              <p className="mt-3 rounded-md border border-red-800/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
                {previewError}
              </p>
            ) : (
              <div className="mt-3 overflow-auto rounded-md border border-line bg-paper p-4">
                {/* The author's own markup. Sanitised on save, and every
                    substituted value is escaped by the renderer. */}
                <div
                  className="report-output text-sm text-ink"
                  dangerouslySetInnerHTML={{ __html: preview ?? "" }}
                />
                {(preview ?? "").trim() === "" && (
                  <p className="text-sm text-muted">Nothing to preview yet.</p>
                )}
              </div>
            )}
          </CollapsibleCard>
        </div>
      </div>
    </div>
  );
}
