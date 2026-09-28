// Administration -> Configuration -> Dashboard Texture.
//
// A server component: it reads the texture library and which picture is
// selected, so the gallery starts on the real values with no
// fetch-then-populate flicker, and hands them to the client control below. The
// read is cheap — every row carries `hasImage`, never the picture's bytes
// (migrations/0113). The thumbnails come from the serving route instead.

import {
  getDashboardTexture,
  listDashboardTextures,
  MAX_DASHBOARD_TEXTURES,
} from "@/lib/dashboard-texture";
import { deps } from "@/lib/wiring";
import { PAGE_CONTAINER } from "../../../page-container";
import { DashboardTextureControl } from "./dashboard-texture-control";

export default function DashboardTexturePage() {
  const textures = listDashboardTextures(deps.dashboardTextureRepo);
  const selected = getDashboardTexture(deps.dashboardTextureRepo);

  return (
    <div className={PAGE_CONTAINER}>
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Configuration
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Dashboard Texture</h1>
      <p className="mt-2 text-sm text-muted">
        Background pictures for the home dashboard — keep up to {MAX_DASHBOARD_TEXTURES} and
        choose one to show. Each picture keeps its own opacity, blur and layout, so switching
        between them restores the way you tuned each one. A texture sits behind the cards, so
        keep it quiet. With none chosen the dashboard uses the color theme&apos;s plain
        background.
      </p>

      <DashboardTextureControl textures={textures} selectedId={selected.selectedId} />
    </div>
  );
}
