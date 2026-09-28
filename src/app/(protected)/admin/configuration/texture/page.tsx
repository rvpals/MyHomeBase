// Administration -> Configuration -> App Texture.
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
import { listModulesWithTexture } from "@/lib/module-texture";
import { listModules } from "@/lib/modules";
import { deps } from "@/lib/wiring";
import { PAGE_CONTAINER } from "../../../page-container";
import { DashboardTextureControl } from "./dashboard-texture-control";

export default function DashboardTexturePage() {
  const textures = listDashboardTextures(deps.dashboardTextureRepo);
  const selected = getDashboardTexture(deps.dashboardTextureRepo);

  // Which modules override the app-wide picture with one of their own (0116),
  // resolved from slugs to the names the admin actually sees in the nav. A slug
  // with no matching module is dropped rather than shown raw: the texture table
  // is keyed by slug and keeps inert rows for modules that no longer exist.
  // `includeHidden` because a hidden module still renders its own screens to
  // anyone with a link, so its texture still overrides — leaving it out of this
  // notice would make the one module that ignores the setting invisible here.
  const moduleNames = new Map(
    listModules(deps.moduleRepo, { includeHidden: true }).map((appModule) => [
      appModule.slug,
      appModule.shortName,
    ]),
  );
  const overridingModules = listModulesWithTexture(deps.moduleTextureRepo)
    .map((slug) => moduleNames.get(slug))
    .filter((name): name is string => Boolean(name));

  return (
    <div className={PAGE_CONTAINER}>
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Configuration
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">App Texture</h1>
      <p className="mt-2 text-sm text-muted">
        Background pictures for the app — keep up to {MAX_DASHBOARD_TEXTURES} and choose one
        to show. Each picture keeps its own opacity, blur and layout, so switching between
        them restores the way you tuned each one. A texture sits behind the cards, so keep it
        quiet. With none chosen the app uses the color theme&apos;s plain background.
      </p>

      <DashboardTextureControl
        textures={textures}
        selectedId={selected.selectedId}
        appWide={selected.appWide}
        overridingModules={overridingModules}
      />
    </div>
  );
}
