"use client";

// Client presentation for the About screen. The server page (page.tsx) fetches
// system info and reads CHANGE_HISTORY.md, and hands down fully serializable,
// display-ready data — this view only renders it. Columns carry a `value`
// accessor (raw sort key) alongside `render` (formatted display) so the grids
// sort and export correctly.

import type { ReactNode } from "react";
import { useState, useEffect, useRef } from "react";
import { clearCachesAndReload } from "@/components/app-version-watch";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { Modal } from "@/components/modal";
import { Tabs, type TabItem } from "@/components/tabs";
import { UsageMeter } from "@/components/usage-meter";
import {
  parseInlineMarkdown,
  readChangeTag,
  type ChangeCounts,
  type ChangeHistorySummary,
  type ChangeKind,
} from "@/lib/change-history";
import { formatBytes } from "@/lib/system-info";
import { PAGE_CONTAINER } from "../../page-container";
import { deleteDeploymentAction } from "./actions";

interface StatItem {
  label: string;
  value: string;
}

// A memory figure that has a known total, so it renders as a meter rather than a
// plain tile. Byte values stay raw here — the view formats them.
interface MeterItem {
  label: string;
  usedBytes: number;
  totalBytes: number;
  caption?: string;
}

interface DatabaseRow {
  label: string;
  path: string;
  sizeBytes: number;
  sizeText: string;
  modifiedAt: string;
  modifiedText: string;
}

interface EnvRow {
  key: string;
  value: string;
}

/**
 * One deployment, formatted by the server page. Everything but `id`, `deployedAt` and
 * `migrated` can be null — the build log that supplies those fields may not have shipped
 * with the package (see migrations/0078_create_deployments.md), and the grid shows an em
 * dash rather than dropping the row.
 */
interface DeploymentRow {
  id: number;
  deployedAt: string;
  deployedText: string;
  builtAt: string | null;
  builtText: string | null;
  buildId: string | null;
  appVersion: string | null;
  builtOnHost: string | null;
  nodeAbi: number | null;
  packageSizeBytes: number | null;
  packageSizeText: string | null;
  migrated: boolean;
  buildOutput: string | null;
  isCurrent: boolean;
}

function StatTile({ label, value }: StatItem) {
  return (
    <div className="rounded-xl border border-line p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-display text-lg text-ink">{value}</p>
    </div>
  );
}

// Added / Changed / Fixed use emphasis rather than three hues, per design.md:
// "added" takes the documented tinted accent chip, "changed" is a quiet outline.
// "fixed" is the one literal color — a resolved defect is the success semantic
// the design system reserves emerald for.
const KIND_CHIP: Record<ChangeKind, string> = {
  added: "bg-brass-soft text-brass-dark",
  changed: "border border-line text-muted",
  fixed: "border border-emerald-400/40 text-emerald-400",
};

function KindBadge({ kind, count }: { kind: ChangeKind; count?: number }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide ${KIND_CHIP[kind]}`}
    >
      {count === undefined ? null : <span className="font-mono">{count}</span>}
      {kind}
    </span>
  );
}

function CountsCard({ label, caption, counts }: { label: string; caption: string; counts: ChangeCounts }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl text-ink">
        {counts.total}{" "}
        <span className="text-base text-muted">{counts.total === 1 ? "change" : "changes"}</span>
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <KindBadge kind="added" count={counts.added} />
        <KindBadge kind="changed" count={counts.changed} />
        <KindBadge kind="fixed" count={counts.fixed} />
      </div>
      <p className="mt-3 text-xs text-muted">{caption}</p>
    </div>
  );
}

function ChangeHistoryTotals({ summary }: { summary: ChangeHistorySummary }) {
  const releaseCount = summary.releases.length;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {summary.latest ? (
        <CountsCard label="This release" caption={summary.latest.title} counts={summary.latest.counts} />
      ) : null}
      <CountsCard
        label="All time"
        caption={`Across ${releaseCount} ${releaseCount === 1 ? "release" : "releases"}.`}
        counts={summary.allTime}
      />
    </div>
  );
}

// Renders one line's inline markup — bold, italic, code, links — from the spans
// the lib parser produced. Emphasis takes the ink token so it reads as weight
// rather than colour; a code span gets the same treatment as an inline `<code>`
// elsewhere in the app.
function InlineText({ text }: { text: string }) {
  return (
    <>
      {parseInlineMarkdown(text).map((span, index) => {
        const body =
          span.style === "bold" ? (
            <strong className="font-semibold text-ink">{span.text}</strong>
          ) : span.style === "italic" ? (
            <em className="italic">{span.text}</em>
          ) : span.style === "code" ? (
            <code className="rounded bg-brass-soft px-1 py-0.5 font-mono text-[0.85em] text-brass-dark">
              {span.text}
            </code>
          ) : (
            span.text
          );

        if (span.href) {
          return (
            <a
              key={index}
              href={span.href}
              className="text-brass-dark underline underline-offset-2"
            >
              {body}
            </a>
          );
        }
        return <span key={index}>{body}</span>;
      })}
    </>
  );
}

// Block renderer for CHANGE_HISTORY.md: `#`–`####` headings, "-"/"*" bullet
// lists (with one level of indent), fenced code blocks, and paragraphs — plus
// this project's `[Added]` / `[Changed]` / `[Fixed]` item tags, which are lifted
// out of the text and shown as a badge. Inline markup inside each block is
// handled by `InlineText`.
//
// Still not a general markdown parser (no tables, no block quotes, no ordered
// lists), but it covers what the `build_project` skill writes and degrades to
// literal text rather than dropping anything it doesn't know.
function renderChangeHistory(markdown: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  let listItems: { kind: ChangeKind | null; text: string; nested: boolean }[] = [];
  let fence: string[] | null = null;

  function flushList() {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={`list-${blocks.length}`} className="list-disc space-y-1 pl-5 text-sm text-ink">
        {listItems.map((item, index) => (
          <li key={index} className={item.nested ? "ml-5 list-[circle]" : undefined}>
            {item.kind ? (
              <>
                <KindBadge kind={item.kind} />{" "}
              </>
            ) : null}
            <InlineText text={item.text} />
          </li>
        ))}
      </ul>,
    );
    listItems = [];
  }

  function flushFence() {
    if (fence === null) return;
    blocks.push(
      <pre
        key={blocks.length}
        className="overflow-x-auto rounded-xl border border-line p-3 font-mono text-xs text-ink"
      >
        {fence.join("\n")}
      </pre>,
    );
    fence = null;
  }

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trimEnd();

    // Inside a fence every line is literal until the closing marker, so this
    // has to come before any other block test.
    if (fence !== null) {
      if (line.trimStart().startsWith("```")) flushFence();
      else fence.push(rawLine);
      continue;
    }
    if (line.trimStart().startsWith("```")) {
      flushList();
      fence = [];
      continue;
    }

    const indented = /^\s+[-*] /.test(rawLine);

    if (line.startsWith("#### ")) {
      flushList();
      const { kind, text } = readChangeTag(line.slice(5));
      blocks.push(
        <h4
          key={blocks.length}
          className="mt-3 flex flex-wrap items-center gap-2 font-display text-sm font-semibold text-ink"
        >
          {kind ? <KindBadge kind={kind} /> : null}
          <InlineText text={text} />
        </h4>,
      );
    } else if (line.startsWith("### ")) {
      flushList();
      const { kind, text } = readChangeTag(line.slice(4));
      blocks.push(
        <h3
          key={blocks.length}
          className="mt-4 flex flex-wrap items-center gap-2 font-display text-base font-semibold text-ink"
        >
          {kind ? <KindBadge kind={kind} /> : null}
          <InlineText text={text} />
        </h3>,
      );
    } else if (line.startsWith("## ")) {
      flushList();
      blocks.push(
        <h2
          key={blocks.length}
          className="mt-6 border-t border-line pt-4 font-display text-lg font-semibold text-ink first:mt-0 first:border-t-0 first:pt-0"
        >
          <InlineText text={line.slice(3)} />
        </h2>,
      );
    } else if (line.startsWith("# ")) {
      flushList();
      blocks.push(
        <h1 key={blocks.length} className="font-display text-2xl font-semibold text-ink">
          <InlineText text={line.slice(2)} />
        </h1>,
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      listItems.push({ ...readChangeTag(line.slice(2)), nested: false });
    } else if (indented) {
      const trimmed = line.trimStart();
      listItems.push({ ...readChangeTag(trimmed.slice(2)), nested: true });
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      blocks.push(
        <p key={blocks.length} className="text-sm text-muted">
          <InlineText text={line} />
        </p>,
      );
    }
  }
  flushList();
  flushFence();

  return blocks;
}

export function AboutView({
  appName,
  appVersion,
  buildId,
  stats,
  ramMeter,
  processMeters,
  backupText,
  databaseRows,
  envFilePath,
  envRows,
  deployments,
  changeHistoryMarkdown,
  changeHistorySummary,
}: {
  appName: string;
  appVersion: string;
  /** The deployed build's id, or null under `next dev` where there is none. */
  buildId: string | null;
  stats: StatItem[];
  ramMeter: MeterItem;
  processMeters: MeterItem[];
  backupText: string;
  databaseRows: DatabaseRow[];
  envFilePath: string;
  envRows: EnvRow[];
  deployments: DeploymentRow[];
  changeHistoryMarkdown: string | null;
  changeHistorySummary: ChangeHistorySummary | null;
}) {
  // The Server Log tab. Fetched from the client rather than passed down from
  // page.tsx on purpose: the log is the one thing on this screen you want to
  // re-read without reloading the page, and a server component can only give it
  // to you once. `/api/admin/log` returns the last 50 lines as plain text.
  const [logContent, setLogContent] = useState("Loading...");
  const logRef = useRef<HTMLPreElement>(null);

  const refreshLog = async () => {
    setLogContent("Loading...");
    try {
      // `no-store` because a cached log defeats the point of a Refresh button.
      const response = await fetch("/api/admin/log", { cache: "no-store" });
      const text = await response.text();
      // A 404 means start.sh has not written app.log yet -- that is a normal
      // state on a fresh install, not a fault, so it reads as a sentence rather
      // than the route's raw JSON body.
      if (!response.ok) {
        setLogContent(
          response.status === 404
            ? "No log file yet. It appears once the server has written app.log."
            : `Could not read the log (HTTP ${response.status}).`,
        );
        return;
      }
      setLogContent(text.trim() === "" ? "The log file is empty." : text);
    } catch (error) {
      setLogContent(error instanceof Error ? `Error loading log: ${error.message}` : "Error loading log.");
    }
  };

  useEffect(() => {
    void refreshLog();
    // Once on mount. `refreshLog` closes over nothing that changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The deployment pending deletion, or null when the confirm isn't up. Held here rather
  // than as a boolean plus an id so the dialog can name what it is about to remove — and so
  // there is no state in which it is open with nothing to delete.
  const [pendingDelete, setPendingDelete] = useState<DeploymentRow | null>(null);
  /** The deployment whose build log is on screen, or null when none is. */
  const [viewingLog, setViewingLog] = useState<DeploymentRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    const result = await deleteDeploymentAction(pendingDelete.id);
    setIsDeleting(false);
    if (!result.ok) {
      // Kept open on failure: closing would leave the row on screen with no explanation.
      setDeleteError(result.error ?? "Failed to delete the deployment record.");
      return;
    }
    // The action revalidates this route, so the grid re-renders without the row on its own.
    setPendingDelete(null);
  };

  const deploymentColumns: DataGridColumn<DeploymentRow>[] = [
    {
      key: "deployed",
      header: "Deployed",
      value: (row) => row.deployedAt,
      render: (row) => (
        <span className="flex flex-wrap items-center gap-2">
          {row.deployedText}
          {/* The one row worth marking: the build this server is actually running. */}
          {row.isCurrent ? (
            <span className="shrink-0 rounded-full bg-brass-soft px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-brass-dark">
              live
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "buildId",
      header: "Build",
      value: (row) => row.buildId ?? "",
      render: (row) =>
        row.buildId === null ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="break-all font-mono text-xs">{row.buildId}</span>
        ),
    },
    {
      key: "appVersion",
      header: "Version",
      value: (row) => row.appVersion ?? "",
      render: (row) => row.appVersion ?? <span className="text-muted">—</span>,
    },
    {
      key: "built",
      header: "Built",
      value: (row) => row.builtAt ?? "",
      render: (row) => row.builtText ?? <span className="text-muted">—</span>,
    },
    {
      key: "builtOnHost",
      header: "Built on",
      value: (row) => row.builtOnHost ?? "",
      render: (row) => row.builtOnHost ?? <span className="text-muted">—</span>,
    },
    {
      key: "packageSize",
      header: "Package",
      // Sorts on bytes, not on the formatted text — "9.9 MB" must not sort above "41.0 MB".
      value: (row) => row.packageSizeBytes ?? 0,
      render: (row) => row.packageSizeText ?? <span className="text-muted">—</span>,
    },
    {
      key: "nodeAbi",
      header: "Node ABI",
      value: (row) => row.nodeAbi ?? 0,
      render: (row) => row.nodeAbi ?? <span className="text-muted">—</span>,
    },
    {
      key: "migrated",
      header: "Migrated",
      value: (row) => (row.migrated ? "yes" : "no"),
      render: (row) =>
        row.migrated ? (
          <span className="rounded-full border border-emerald-400/40 px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-emerald-400">
            yes
          </span>
        ) : (
          <span className="text-muted">no</span>
        ),
    },
    {
      key: "buildOutput",
      header: "Build log",
      // No `value`: a few KB of console output is not a sortable, searchable or CSV-able
      // cell, and it would wreck the row height inline — hence a button that opens it in a
      // dialog. Its own dialog rather than DataGrid's record view: `setRecordIndex` is
      // private to that component, so a cell cannot reach it, and "open the record" as a
      // hint pointed at an unlabelled icon three columns to the left.
      render: (row) =>
        row.buildOutput === null ? (
          <span className="text-muted">—</span>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setViewingLog(row)}>
            View ({row.buildOutput.split("\n").length} lines)
          </Button>
        ),
    },
    {
      key: "actions",
      header: "Actions",
      // Row actions don't belong in a read-out of the record.
      excludeFromRecordView: true,
      render: (row) => (
        <Button size="sm" variant="danger" onClick={() => setPendingDelete(row)}>
          Delete
        </Button>
      ),
    },
  ];

  const databaseColumns: DataGridColumn<DatabaseRow>[] = [
    { key: "label", header: "File", value: (file) => file.label, render: (file) => file.label },
    {
      key: "path",
      header: "Path",
      value: (file) => file.path,
      render: (file) => <span className="font-mono text-xs">{file.path}</span>,
    },
    { key: "size", header: "Size", value: (file) => file.sizeBytes, render: (file) => file.sizeText },
    { key: "modified", header: "Modified", value: (file) => file.modifiedAt, render: (file) => file.modifiedText },
  ];

  const envColumns: DataGridColumn<EnvRow>[] = [
    {
      key: "key",
      header: "Key",
      value: (variable) => variable.key,
      render: (variable) => <span className="font-mono text-xs">{variable.key}</span>,
    },
    {
      key: "value",
      header: "Value",
      value: (variable) => variable.value,
      render: (variable) => <span className="break-all font-mono text-xs">{variable.value || "—"}</span>,
    },
  ];

  const tabs: TabItem[] = [
    {
      key: "application",
      label: "Application",
      content: (
        <>
          <CollapsibleCard title="Application & System Info" defaultOpen>
            <p className="font-display text-lg text-ink">{appName}</p>
            <p className="mt-1 text-sm text-muted">Version {appVersion}</p>

            {/* The build id, and the button that makes this device match it.
                Together they answer the question that prompted the feature:
                "is my phone actually on the version I just deployed?" — compare
                this string against the one your desktop shows. */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Build</p>
                <p className="mt-1 break-all font-mono text-sm text-ink">
                  {buildId ?? "dev (no build id)"}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Installed to a home screen, the app is suspended rather than closed, so it can
                  keep running an older build after a deploy. This reloads it from the server.
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => void clearCachesAndReload()}>
                Clear cache &amp; relaunch
              </Button>
            </div>

            <p className="mt-4 text-sm text-muted">
              Live details about the server process this instance is running on.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {stats.map((stat) => (
                <StatTile key={stat.label} label={stat.label} value={stat.value} />
              ))}
            </div>

            {/* Memory in two rows: system RAM on its own, then the two process
                figures beside each other. Both collapse to one column on a phone. */}
            <div className="mt-4 grid grid-cols-1 gap-4">
              <UsageMeter
                label={ramMeter.label}
                used={ramMeter.usedBytes}
                total={ramMeter.totalBytes}
                caption={ramMeter.caption}
                formatValue={formatBytes}
              />
            </div>
            <div className="card-grid mt-4 gap-4">
              {processMeters.map((meter) => (
                <UsageMeter
                  key={meter.label}
                  label={meter.label}
                  used={meter.usedBytes}
                  total={meter.totalBytes}
                  caption={meter.caption}
                  formatValue={formatBytes}
                />
              ))}
            </div>
          </CollapsibleCard>

          <div className="mt-10">
            <h2 className="font-display text-xl text-ink">Database Files</h2>
            <p className="mt-1 text-sm text-muted">{backupText}</p>
            <div className="mt-4">
              <DataGrid
                columns={databaseColumns}
                rows={databaseRows}
                getRowKey={(file) => file.path}
                emptyMessage="No database files found."
                exportFileName="database-files"
              />
            </div>
          </div>

          <div className="mt-10">
            <h2 className="font-display text-xl text-ink">Environment Variables</h2>
            <p className="mt-1 text-sm text-muted">
              <span className="font-mono text-xs">{envFilePath}</span> — shown in full, including
              secrets. This page is admin-only; treat it accordingly.
            </p>
            <div className="mt-4">
              <DataGrid
                columns={envColumns}
                rows={envRows}
                getRowKey={(variable) => variable.key}
                emptyMessage="No .env file found at this path."
                exportFileName="env-variables"
              />
            </div>
          </div>
        </>
      ),
    },
    {
      key: "change-history",
      label: "Change History",
      content: (
        <div className="space-y-2">
          {changeHistorySummary ? (
            <div className="mb-8">
              <ChangeHistoryTotals summary={changeHistorySummary} />
            </div>
          ) : null}
          {changeHistoryMarkdown ? (
            renderChangeHistory(changeHistoryMarkdown)
          ) : (
            <div className="rounded-xl border border-dashed border-line p-8 text-center">
              <p className="font-display text-lg text-ink">No change history yet</p>
              <p className="mt-1 text-sm text-muted">
                Run the <code className="font-mono">build_project</code> skill to create{" "}
                <code className="font-mono">CHANGE_HISTORY.md</code>.
              </p>
            </div>
          )}
        </div>
      ),
    },
    {
      key: "deployments",
      label: "Deployments",
      content: (
        <div className="mt-4">
          <p className="text-sm text-muted">
            One row per deployment that went live, newest first, with the build log the
            package carried. Open a row&apos;s record to read its full build output.
          </p>
          <p className="mt-1 text-sm text-muted">
            Recorded on the server as a new build starts, so a restart after a crash
            doesn&apos;t appear here — only an actual publish does.
          </p>
          <div className="mt-4">
            <DataGrid
              columns={deploymentColumns}
              rows={deployments}
              getRowKey={(row) => row.id}
              emptyMessage="No deployments recorded yet. The first one appears after the next publish."
              exportFileName="deployments"
              recordViewTitle={(row) => `Deployment ${row.deployedText}`}
              storageKey="about-deployments"
            />
          </div>
        </div>
      ),
    },
    {
      key: "server-log",
      label: "Server Log",
      content: (
        <div className="mt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm text-muted">
              The last 50 lines of <span className="font-mono text-ink">app.log</span>, newest
              at the bottom.
            </p>
            <Button size="sm" variant="secondary" onClick={() => void refreshLog()}>
              Refresh
            </Button>
          </div>

          {/* Same treatment as the expense cleanup log: a bordered mono block on
              `bg-paper` so long lines are legible and the surface stays quiet. */}
          <pre
            ref={logRef}
            className="mt-3 max-h-96 overflow-auto rounded-md border border-line bg-paper p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap text-ink"
          >
            {logContent}
          </pre>
        </div>
      ),
    },
  ];

  return (
    <div className={PAGE_CONTAINER}>
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Administration
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">About</h1>

      <Tabs items={tabs} className="mt-8" />

      {/* The build log, in the same bordered mono block the Server Log tab uses — long
          lines stay legible and the surface stays quiet. `size="lg"` because a build log is
          wide; it still wraps rather than scrolling sideways on a phone. */}
      {viewingLog ? (
        <Modal
          title="Build log"
          description={`Deployed ${viewingLog.deployedText}${
            viewingLog.buildId ? ` — build ${viewingLog.buildId}` : ""
          }.`}
          size="lg"
          onClose={() => setViewingLog(null)}
          footer={
            <Button variant="secondary" onClick={() => setViewingLog(null)}>
              Close
            </Button>
          }
        >
          <pre className="max-h-[60vh] overflow-auto rounded-md border border-line bg-paper p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap text-ink">
            {viewingLog.buildOutput}
          </pre>
        </Modal>
      ) : null}

      {/* Guarded because the history is append-only: nothing recreates a deleted row short
          of another deployment, so an accidental tap on a phone is unrecoverable. */}
      {pendingDelete ? (
        <Modal
          title="Delete this deployment record?"
          description={`Deployed ${pendingDelete.deployedText}${
            pendingDelete.buildId ? ` — build ${pendingDelete.buildId}` : ""
          }. This removes the record and its build log. It cannot be undone.`}
          onClose={() => {
            setPendingDelete(null);
            setDeleteError(null);
          }}
          isBusy={isDeleting}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setPendingDelete(null);
                  setDeleteError(null);
                }}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void confirmDelete()} disabled={isDeleting}>
                {isDeleting ? "Deleting…" : "Delete"}
              </Button>
            </>
          }
        >
          {deleteError ? (
            <p className="text-sm text-red-400">{deleteError}</p>
          ) : (
            <p className="text-sm text-muted">
              The deployment itself is unaffected — this only forgets that it happened.
            </p>
          )}
        </Modal>
      ) : null}
    </div>
  );
}
