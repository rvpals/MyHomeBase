// Administration -> Configuration -> Dashboard Texture.
//
// A server component: it reads the stored settings so the controls start on the
// real values with no fetch-then-populate flicker, and hands them to the client
// control below. The read is cheap — the row carries `hasImage`, never the
// picture's bytes (migrations/0063).

import { getDashboardTexture } from "@/lib/dashboard-texture";
import { deps } from "@/lib/wiring";
import { PAGE_CONTAINER } from "../../../page-container";
import { DashboardTextureControl } from "./dashboard-texture-control";

export default function DashboardTexturePage() {
  const texture = getDashboardTexture(deps.dashboardTextureRepo);

  return (
    <div className={PAGE_CONTAINER}>
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Configuration
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Dashboard Texture</h1>
      <p className="mt-2 text-sm text-muted">
        An optional background picture for the home dashboard. It sits behind the cards, so
        keep it quiet — the opacity and blur below are what keep the text on top readable.
        With no picture uploaded the dashboard uses the color theme&apos;s plain background.
      </p>

      <DashboardTextureControl
        hasImage={texture.hasImage}
        imageVersion={texture.updatedAt}
        opacity={texture.opacity}
        mode={texture.mode}
        blur={texture.blur}
      />
    </div>
  );
}
