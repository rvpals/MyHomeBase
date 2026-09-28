// Which background picture a given screen draws.
//
// The app has two sources — the selected library picture (0063/0113, made
// app-wide by 0116) and a module's own (0064) — and exactly one of them can win
// on any screen. This module owns that precedence and nothing else. Neither
// texture module learned about the other: both still answer only for themselves,
// and this is the single place they meet.
//
// Pure functions over already-read domain objects — no repository, no port, no
// react, no next. The caller does the two cheap reads (both carry `hasImage`,
// never the bytes) and hands them here.

import type { DashboardTexture, DashboardTextureItem } from "@/lib/dashboard-texture";
import type { ModuleTexture } from "@/lib/module-texture";
import type { ResolvedAppTexture } from "./types";

/**
 * The custom properties the shared `[data-app-texture]` rule reads.
 *
 * One namespace for both sources, rather than the `--dashboard-texture-*` and
 * `--module-texture-*` pairs the two modules emit for their own rules. The CSS
 * cannot ask which source won — it just draws what it is handed — so
 * normalising here is what let two near-identical rules in `globals.css` become
 * one.
 */
function toVars(
  image: string,
  opacity: number,
  mode: "cover" | "tile",
  blur: number,
): Record<string, string> {
  return {
    "--app-texture-image": image,
    "--app-texture-opacity": String(opacity),
    // `cover` stretches one copy over the viewport; `tile` repeats it at its
    // natural size. Two properties rather than one shorthand, because
    // background-size and background-repeat have to disagree between the modes.
    "--app-texture-size": mode === "cover" ? "cover" : "auto",
    "--app-texture-repeat": mode === "cover" ? "no-repeat" : "repeat",
    "--app-texture-blur": `${blur}px`,
  };
}

/**
 * What this screen draws, given the app's selection and — on a module screen —
 * that module's texture row plus the library picture it points at.
 *
 * Precedence, highest first:
 *
 *  1. **The module said `none`.** An explicit opt-out wins over everything,
 *     including an app-wide background. This is how a table-heavy screen stays
 *     on flat paper while the rest of the app carries a picture.
 *  2. **The module's own upload** (`own`) — what the Music Library does.
 *  3. **The library picture the module chose** (`library`), drawn with *that
 *     picture's* opacity, mode and blur. A pointer to a deleted picture falls
 *     through rather than erroring.
 *  4. **The app-wide selection**, when the admin has ticked the scope on.
 *  5. **Nothing** — the theme's flat paper.
 *
 * Pass `moduleTexture` as `undefined` on a screen that belongs to no module
 * (home, Administration, the account screen): those can only reach rules 4-5.
 *
 * `libraryTexture` is the row `moduleTexture.textureId` names, looked up by the
 * caller. Passed in rather than fetched here because this module owns a
 * precedence rule and holds no repository — the same reason it takes the other
 * two as data.
 *
 * Note what is deliberately absent: there is no blending. Two photographs at
 * 0.10 each is not a design anyone chose, and the layer sits behind text whose
 * legibility is already the cards' job — see `design.md` → *The one sanctioned
 * exception*.
 */
export function resolveAppTexture(
  appTexture: DashboardTexture,
  moduleTexture?: ModuleTexture,
  libraryTexture?: DashboardTextureItem,
): ResolvedAppTexture {
  // An explicit "no background here" outranks the app-wide picture. Checked
  // before everything else because it is the one mode that means *less* than
  // what the app would otherwise draw.
  if (moduleTexture?.source === "none") return { source: "none" };

  if (moduleTexture?.source === "own" && moduleTexture.hasImage) {
    return {
      source: "module",
      vars: toVars(
        // The URL carries `?v=<updatedAt>` because the serving route sends a
        // 5-minute max-age; without it, replacing the picture would appear to do
        // nothing.
        `url("/api/modules/${encodeURIComponent(
          moduleTexture.moduleSlug,
        )}/texture?v=${encodeURIComponent(moduleTexture.updatedAt)}")`,
        moduleTexture.opacity,
        moduleTexture.mode,
        moduleTexture.blur,
      ),
    };
  }

  // A library pointer. `libraryTexture` is undefined when the picture has since
  // been deleted, and this falls through to the app-wide texture rather than
  // emitting a layer whose image 404s — 0117 chose that over a foreign key.
  //
  // The knobs come from the library row, not from the module's own columns:
  // picking "Linen" means getting Linen as it was tuned. That is why two modules
  // cannot show one picture at different opacities; see the migration log.
  if (moduleTexture?.source === "library" && libraryTexture?.hasImage) {
    return {
      source: "module",
      vars: toVars(
        `url("/api/dashboard/texture?id=${libraryTexture.id}&v=${encodeURIComponent(
          libraryTexture.updatedAt,
        )}")`,
        libraryTexture.opacity,
        libraryTexture.mode,
        libraryTexture.blur,
      ),
    };
  }

  // `hasImage` is checked as well as `appWide`: the flag can be on with nothing
  // selected (an admin ticked the scope before choosing a picture, or deleted
  // the selected one), and that state draws nothing rather than a broken URL.
  if (appTexture.appWide && appTexture.hasImage) {
    return {
      source: "app",
      vars: toVars(
        `url("/api/dashboard/texture?v=${encodeURIComponent(appTexture.updatedAt)}")`,
        appTexture.opacity,
        appTexture.mode,
        appTexture.blur,
      ),
    };
  }

  return { source: "none" };
}

/**
 * Whether the home dashboard should draw the selection on its own.
 *
 * The home screen is the one place the picture appears **whether or not** the
 * app-wide flag is set — that is the original 0063 behaviour, and turning scope
 * off must put it back rather than leaving the install with no texture at all.
 *
 * Kept separate from `resolveAppTexture` rather than folded in as a "screen is
 * home" argument: the layout resolves the app-wide case for every screen
 * including home, so home would otherwise be resolved twice and have to agree
 * with itself. This answers only the narrow question the home page asks —
 * *does the layout already have this covered, or is it mine to draw?*
 */
export function homeDrawsOwnTexture(appTexture: DashboardTexture): boolean {
  return appTexture.hasImage && !appTexture.appWide;
}

/**
 * What the home dashboard draws on its own, when the layout is not covering it.
 *
 * A thin pairing of the two functions above, here rather than at the call site
 * so the home page never has to fabricate an `appWide: true` object to get the
 * vars out of `resolveAppTexture` — a spread that reads like a trick and would
 * break quietly if the precedence rule ever grew a third source.
 */
export function homeTexture(appTexture: DashboardTexture): ResolvedAppTexture {
  if (!homeDrawsOwnTexture(appTexture)) return { source: "none" };
  return resolveAppTexture({ ...appTexture, appWide: true });
}

/**
 * The library id a module's texture needs looked up, or `undefined` when it
 * needs none.
 *
 * A tiny helper so a module shell doesn't hand-write the `source === "library"`
 * test before calling `getDashboardTextureById` — nine shells each repeating
 * that condition is nine chances to get it subtly wrong, and the shells are
 * presentation.
 */
export function moduleTextureLibraryId(moduleTexture?: ModuleTexture): number | undefined {
  return moduleTexture?.source === "library" ? moduleTexture.textureId : undefined;
}
