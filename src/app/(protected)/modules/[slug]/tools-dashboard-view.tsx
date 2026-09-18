import { Button } from "@/components/button";
import { SlotIcon } from "@/components/slot-icon";
import { getIconSlot } from "@/lib/icons";
import { TOOLS_SECTION_INFO, toolsSectionHref } from "./tools-sections";

// The Tools landing screen: one card per utility. A server component — it renders
// static content and holds no state, so there is nothing to make it a client one.
//
// Deliberately a plain card list rather than a new reusable component: there is one
// tool today, and a "module landing grid" abstraction invented for a single caller
// is the gold-plating ARCHITECTURE.md warns about. Worth promoting if a third
// module wants the same shape.

const SQLITE_BROWSER_SLOT = getIconSlot("tools_section_sqlite_browser");

export function ToolsDashboardView() {
  const info = TOOLS_SECTION_INFO["sqlite-browser"];

  return (
    <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
      <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
        <h2 className="flex items-center gap-2 font-display text-lg text-ink">
          {SQLITE_BROWSER_SLOT && <SlotIcon slot={SQLITE_BROWSER_SLOT} className="h-5 w-5" />}
          {info.label}
        </h2>
        <p className="flex-1 text-sm text-muted">{info.description}</p>
        <div>
          <Button href={toolsSectionHref("sqlite-browser")}>Open</Button>
        </div>
      </section>
    </div>
  );
}
