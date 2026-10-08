"use client";

// A run report, on screen and on paper.
//
// Printing goes through the `print-sheet` / `no-print` classes defined in the
// @media print block in globals.css — no per-view print CSS. The sheet is what
// gets printed; every control is marked `no-print`. See design.md.
//
// "Save as PDF" in the browser's print dialog is how a report becomes a PDF.
// That is deliberate: it needs no dependency, and it matches whatever paper size
// the reader actually has.

import { useState } from "react";
import { Button } from "@/components/button";
import { SlotIcon } from "@/components/slot-icon";
import { getIconSlot } from "@/lib/icons";
import type { JournalReport } from "@/lib/journal-reports";

const RUN_SLOT = getIconSlot("journal_report_run")!;
const EDIT_SLOT = getIconSlot("journal_report_edit")!;

export function JournalReportRunView({
  report,
  html,
  entryCount,
  document: documentHtml,
  fileName,
  error,
}: {
  report: JournalReport;
  html?: string;
  entryCount?: number;
  /** The standalone file the Download button saves. */
  document?: string;
  fileName?: string;
  /** Set when the report could not be run — a bad query or a bad SQL fragment. */
  error?: string;
}) {
  const [hasDownloaded, setHasDownloaded] = useState(false);

  function handleDownload() {
    if (!documentHtml || !fileName) return;

    // A Blob and a temporary link: the document is already built server-side, so
    // there is nothing to fetch and no route to add for it.
    const blob = new Blob([documentHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = fileName;
    window.document.body.appendChild(link);
    link.click();
    window.document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setHasDownloaded(true);
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-md border border-red-800/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" href={`/modules/journal/report?edit=${report.id}`}>
            <SlotIcon slot={EDIT_SLOT} className="h-4 w-4" />
            Fix this report
          </Button>
          <Button variant="secondary" href="/modules/journal/report">
            Back to reports
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* The toolbar never prints. Wraps and goes full-width under 1024px so the
          buttons stack rather than squeezing. */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted">
            {entryCount ?? 0} {entryCount === 1 ? "entry" : "entries"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => window.print()}>
            <SlotIcon slot={RUN_SLOT} className="h-4 w-4" />
            Print / Save as PDF
          </Button>
          <Button variant="secondary" onClick={handleDownload} disabled={!documentHtml}>
            {hasDownloaded ? "Downloaded" : "Download HTML"}
          </Button>
          <Button variant="secondary" href={`/modules/journal/report?edit=${report.id}`}>
            <SlotIcon slot={EDIT_SLOT} className="h-4 w-4" />
            Edit
          </Button>
          <Button variant="secondary" href="/modules/journal/report">
            Back
          </Button>
        </div>
      </div>

      {/*
        The printed sheet. `print-sheet` is what the @media print block reveals;
        everything else on the page is hidden.

        `print-grid` is deliberately NOT set: it is for a wide term-wide data
        grid (the attendance report), and these reports are narrow — a ruled,
        airy table reads better on paper here. See the globals.css comment.
      */}
      <div className="print-sheet rounded-xl border border-line bg-paper p-6 max-lg:p-4">
        <h1 className="font-display text-2xl font-semibold text-ink">{report.name}</h1>
        {report.description && <p className="mt-1 text-sm text-muted">{report.description}</p>}
        <div className="mt-4 h-px w-full bg-line" />

        {/*
          The author's own markup, rendered as HTML — that is the whole point of
          a stored-HTML report. It was sanitised on save (script/handler/URL
          stripping) and every substituted value is escaped by the renderer, so
          an entry titled `<script>` prints as text.
        */}
        <div
          className="report-output mt-4 text-sm text-ink"
          dangerouslySetInnerHTML={{ __html: html ?? "" }}
        />

        {(html ?? "").trim() === "" && (
          <p className="mt-4 text-sm text-muted">
            This report rendered nothing. Its template may be empty.
          </p>
        )}
      </div>
    </div>
  );
}
