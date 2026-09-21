import { CollapsibleCard } from "@/components/collapsible-card";
import { listUploadedCsvFiles } from "@/lib/csv-file-browser";
import { getMaxUploadBytes, listUploadedDatabases } from "@/lib/sqlite-browser";
import { deps } from "@/lib/wiring";
import { ToolsDashboardView } from "./tools-dashboard-view";
import { ToolsInstructions } from "./tools-instructions";
import { ToolsShell } from "./tools-shell";
import { ToolsCsvBrowserView } from "./tools-csv-browser-view";
import { ToolsSqliteBrowserView } from "./tools-sqlite-browser-view";
import { TOOLS_SECTION_INFO, type ToolsSection as ToolsSectionName } from "./tools-sections";

// Composes one Tools section: the section nav, a heading, and the section's own
// view. A server component, so it can read `deps` directly and hand plain data to
// the client views. Mirrors csv-section.tsx.

export async function ToolsSection({ section }: { section: ToolsSectionName }) {
  const info = TOOLS_SECTION_INFO[section];
  const maxUploadBytes = getMaxUploadBytes(deps.moduleRepo, deps.moduleSettingsRepo);

  return (
    // The two-tier shell: a module rail, a section panel and a utility header,
    // all placed by `ToolsShell`. See design.md, "Navigation: the two-tier shell".
    //
    // `async` because the shell reads cookies for the session and the pinned
    // layout, which `next/headers` only exposes as a promise.
    <ToolsShell>
      <div>
        <header className="mb-4">
          <h1 className="font-display text-2xl text-ink">{info.label}</h1>
          <p className="text-sm text-muted">{info.description}</p>
        </header>

        <CollapsibleCard title="Instruction">
          <ToolsInstructions section={section} maxUploadBytes={maxUploadBytes} />
        </CollapsibleCard>

        <div className="mt-4">
          {section === "main" && <ToolsDashboardView />}
          {section === "sqlite-browser" && (
            // The cap is read here rather than imported by the view, so the
            // screen shows the limit an admin actually configured.
            // Only the upload list is loaded here. The tables inside a file are
            // read on demand, once the reader picks one: opening every uploaded
            // database on every page load would make the screen pay for files
            // nobody is looking at.
            <ToolsSqliteBrowserView
              databases={listUploadedDatabases(deps.uploadedDatabaseRepo)}
              maxUploadBytes={maxUploadBytes}
            />
          )}
          {section === "csv-browser" && (
            // Same shape as above, and the same cap: both browsers read the
            // one `tools_max_upload_bytes` setting. Only the file list is
            // loaded here — a file's rows are read on demand once the reader
            // picks it, so the screen doesn't pay for files nobody opens.
            <ToolsCsvBrowserView
              files={listUploadedCsvFiles(deps.uploadedCsvFileRepo)}
              maxUploadBytes={maxUploadBytes}
            />
          )}
        </div>
      </div>
    </ToolsShell>
  );
}
