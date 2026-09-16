// Administration -> Display Settings -> Floating Components.
//
// A server component, mirroring the Dashboard Widgets screen beside it: it reads the
// stored enabled list so the switches start on the real values with no
// fetch-then-populate flicker. One settings row, so one lookup.
//
// This screen decides which floating components *exist* for the household. It
// deliberately does not decide whether any reader's window is open — that is each
// reader's own, on Account -> Preferences, because "bring my clock back" is a personal
// gesture and an admin-only control would leave a non-admin unable to undo their own X.

import { FLOATING_COMPONENTS, FLOATING_ENABLED_SETTING_KEY, resolveEnabledFloating } from "@/lib/floating";
import { getSetting } from "@/lib/settings";
import { deps } from "@/lib/wiring";
import { PAGE_CONTAINER } from "../../../page-container";
import { FloatingComponentsView } from "./view";

export default function FloatingComponentsPage() {
  const stored = getSetting(deps.settingsRepo, FLOATING_ENABLED_SETTING_KEY)?.value;

  return (
    <div className={PAGE_CONTAINER}>
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Display Settings
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Floating Components</h1>
      <p className="mt-2 text-sm text-muted">
        Which components may float over the application — a small image parked in a corner
        that opens into a window. This is one setting for the whole application, not per
        person: turning something off here removes it from everyone&apos;s screen. Each
        person then chooses whether to open it, on their own Account page.
      </p>

      <FloatingComponentsView
        components={FLOATING_COMPONENTS}
        enabled={resolveEnabledFloating(stored)}
      />
    </div>
  );
}
