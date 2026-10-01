// Administration -> Display Settings -> Border Weight.
//
// A server component: it reads the saved weights so the inputs start on the real
// values with no fetch-then-populate flicker, and hands them to the client view
// below. One settings row holding all three axes, so the read is a single lookup.
//
// The inputs are draft fields on the admin shell — they commit on "Save
// Settings", like Chrome Style and the theme and icon pickers — so the values
// read here are the *saved* ones, which is what the view compares its draft
// against.

import { getSetting, resolveBorderWidths } from "@/lib/settings";
import { deps } from "@/lib/wiring";
import { PAGE_CONTAINER } from "../../../page-container";
import { BorderWeightView } from "./view";

export default function BorderWeightPage() {
  const savedWidths = resolveBorderWidths(
    getSetting(deps.settingsRepo, "border_widths")?.value,
  );

  return (
    <div className={PAGE_CONTAINER}>
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Display Settings
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Border Weight</h1>
      <p className="mt-2 text-sm text-muted">
        How thick the application&apos;s borders are drawn, in pixels. Three separate
        weights, so a heavier navigation frame doesn&apos;t force every table and card to
        thicken with it. This is one choice for the whole application, not per person.
        Thicker borders take their space from inside the element they edge, so nothing
        moves on the page whichever values you pick.
      </p>

      <BorderWeightView savedWidths={savedWidths} />
    </div>
  );
}
