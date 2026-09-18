import { CollapsibleCard } from "@/components/collapsible-card";
import { listUploadedDatabases } from "@/lib/sqlite-browser";
import { deps } from "@/lib/wiring";
import { ToolsDashboardView } from "./tools-dashboard-view";
import { ToolsInstructions } from "./tools-instructions";
import { ToolsShell } from "./tools-shell";
import { ToolsSqliteBrowserView } from "./tools-sqlite-browser-view";
import { TOOLS_SECTION_INFO, type ToolsSection as ToolsSectionName } from "./tools-sections";

// Composes one Tools section: the section nav, a heading, and the section's own
// view. A server component, so it can read `deps` directly and hand plain data to
// the client views. Mirrors csv-section.tsx.

export async function ToolsSection({ section }: { section: ToolsSectionName }) {
  const info = TOOLS_SECTION_INFO[section];

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
          <ToolsInstructions section={section} />
        </CollapsibleCard>

        <div className="mt-4">
          {section === "main" && <ToolsDashboardView />}
          {section === "sqlite-browser" && (
            // Only the upload list is loaded here. The tables inside a file are
            // read on demand, once the reader picks one: opening every uploaded
            // database on every page load would make the screen pay for files
            // nobody is looking at.
            <ToolsSqliteBrowserView databases={listUploadedDatabases(deps.uploadedDatabaseRepo)} />
          )}
        </div>
      </div>
    </ToolsShell>
  );
}
