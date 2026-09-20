// Per-section reference for the Tools module. Each section shows only the part that
// applies to it; the Dashboard carries the module-wide overview. Pure content, no
// state, rendered inside a collapsed CollapsibleCard so it's there when wanted and
// out of the way when not. Mirrors games-instructions.tsx.

// From the leaf module, not the barrel: the barrel re-exports the repository
// and file store, which pull in `better-sqlite3`/`node:fs` and cannot be
// bundled for a browser. `errors.ts` is pure.
import { formatCap } from "@/lib/sqlite-browser/errors";
import type { ToolsSection } from "./tools-sections";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="font-display text-base text-ink">{title}</h3>
      <div className="mt-1 flex flex-col gap-2 text-sm text-muted">{children}</div>
    </section>
  );
}

function DashboardInstructions() {
  return (
    <>
      <p className="text-sm text-muted">
        A home for small standalone utilities — the things that don&apos;t belong to any
        other module. One so far.
      </p>
      <Section title="What is here">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            <strong className="text-ink">SQLite File Browser</strong> — upload a{" "}
            <code className="font-mono text-xs">.db</code> file and look inside it: browse
            its tables, filter and sort the rows, and delete the ones you don&apos;t want.
          </li>
        </ul>
      </Section>
    </>
  );
}

function SqliteBrowserInstructions({ maxUploadBytes }: { maxUploadBytes: number }) {
  return (
    <>
      <p className="text-sm text-muted">
        Opens a SQLite file you upload. Nothing here touches MyHomeBase&apos;s own
        database — only the file you brought.
      </p>
      <Section title="Uploading a file">
        <p>
          Drop a <code className="font-mono text-xs">.db</code>,{" "}
          <code className="font-mono text-xs">.sqlite</code>,{" "}
          <code className="font-mono text-xs">.sqlite3</code> or{" "}
          <code className="font-mono text-xs">.db3</code> file onto the dropzone, up to{" "}
          {formatCap(maxUploadBytes)} (an administrator sets this, under Configuration →
          Application). The file is checked to really be a SQLite database before it is
          accepted, so a mis-picked spreadsheet is rejected straight away rather than
          failing later.
        </p>
        <p>
          Uploads are <strong className="text-ink">shared</strong> — everyone who can see
          this module sees every uploaded file, and the list records who brought each one.
        </p>
      </Section>
      <Section title="Browsing a table">
        <p>
          Pick a file, then a table. Tables and views are both listed, with their row
          counts. The grid gives you a search box, per-column filters, sortable headers,
          show/hide columns and CSV export.
        </p>
        <p>
          A read is capped at the newest 500 rows — the grid is handed already-fetched
          data, so the cap is what stands between your browser and a million-row table.
          The panel says so when there is more.
        </p>
      </Section>
      <Section title="Deleting rows">
        <p>
          <strong className="text-ink">These deletes are real and permanent.</strong> They
          are written straight into the uploaded file, and there is no undo — the uploaded
          copy is a workspace, so work on a copy of anything you care about.
        </p>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            <strong className="text-ink">One row</strong> — the Delete button at the end of
            the row.
          </li>
          <li>
            <strong className="text-ink">Several rows</strong> — tick their checkboxes and
            use <em>Delete selected</em> in the toolbar. Ticking the header checkbox selects
            everything the current filter matches, not just the page you can see.
          </li>
        </ul>
        <p>
          Both ask for confirmation first. Rows are addressed by their SQLite{" "}
          <code className="font-mono text-xs">rowid</code>, so sorting or filtering the grid
          never deletes the wrong one.
        </p>
        <p>
          <strong className="text-ink">Views cannot be deleted from</strong>, and neither
          can a <code className="font-mono text-xs">WITHOUT ROWID</code> table — there is no
          single address for a row. The delete controls are hidden for those rather than
          offered and then refused.
        </p>
      </Section>
      <Section title="Removing a file">
        <p>
          <em>Remove</em> on an uploaded file forgets it and deletes it from the server.
          That does not touch your original — this only ever held a copy.
        </p>
      </Section>
    </>
  );
}

export function ToolsInstructions({
  section,
  maxUploadBytes,
}: {
  section: ToolsSection;
  maxUploadBytes: number;
}) {
  return (
    <div className="flex flex-col gap-4">
      {section === "main" && <DashboardInstructions />}
      {section === "sqlite-browser" && (
        <SqliteBrowserInstructions maxUploadBytes={maxUploadBytes} />
      )}
    </div>
  );
}
