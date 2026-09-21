import { Button } from "@/components/button";
import { SlotIcon } from "@/components/slot-icon";
import { getIconSlot, sectionSlotId } from "@/lib/icons";
import {
  TOOLS_SECTION_INFO,
  toolsSectionHref,
  type ToolsSection,
} from "./tools-sections";

// The Tools landing screen: one card per utility. A server component — it renders
// static content and holds no state, so there is nothing to make it a client one.
//
// Deliberately still a plain card list rather than a new reusable component: two
// tools is not the second *caller* of a "module landing grid" abstraction, it is
// the same caller with a longer list. Worth promoting if another module wants the
// same shape.
//
// The cards are driven off a list rather than written out, which is what keeps
// each one's title, blurb and icon identical to its entry in the section panel —
// they all come from the same two registries.
const TOOL_SECTIONS: ToolsSection[] = ["sqlite-browser", "csv-browser"];

export function ToolsDashboardView() {
  return (
    <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
      {TOOL_SECTIONS.map((section) => (
        <ToolCard key={section} section={section} />
      ))}
    </div>
  );
}

function ToolCard({ section }: { section: ToolsSection }) {
  const info = TOOLS_SECTION_INFO[section];
  // The card and the nav entry share one slot, so an admin who replaces the
  // icon changes both. The id is derived with the same helper `SectionPanel`
  // uses rather than spelled out here — that derivation is what ties the id to
  // the slug, and two copies of it could drift. See coding-guide.md,
  // "Data-driven navs derive the id instead".
  const slot = getIconSlot(sectionSlotId("tools", section));

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
      <h2 className="flex items-center gap-2 font-display text-lg text-ink">
        {slot && <SlotIcon slot={slot} className="h-5 w-5" />}
        {info.label}
      </h2>
      <p className="flex-1 text-sm text-muted">{info.description}</p>
      <div>
        <Button href={toolsSectionHref(section)}>Open</Button>
      </div>
    </section>
  );
}
