// Administration -> Display Settings -> Dashboard Widgets.
//
// A server component: it reads the stored layout so the list starts on the real
// values with no fetch-then-populate flicker, and hands it to the client view
// below. One settings row, so the read is a single lookup.

import { HOME_WIDGETS_SETTING_KEY, resolveHomeWidgets } from "@/lib/home-dashboard";
import { getSetting } from "@/lib/settings";
import { deps } from "@/lib/wiring";
import { PAGE_CONTAINER } from "../../../page-container";
import { DashboardWidgetsView } from "./view";

export default function DashboardWidgetsPage() {
  const stored = getSetting(deps.settingsRepo, HOME_WIDGETS_SETTING_KEY)?.value;

  return (
    <div className={PAGE_CONTAINER}>
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Display Settings
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Dashboard Widgets</h1>
      <p className="mt-2 text-sm text-muted">
        Which cards the home screen draws, and the order they appear in. This is one layout
        for the whole application, not per person — everyone sees what you set here.
      </p>

      <DashboardWidgetsView widgets={resolveHomeWidgets(stored)} />
    </div>
  );
}
