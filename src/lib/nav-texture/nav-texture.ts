// The background picture the navigation draws behind its rows.
//
// The desktop tree (`NavTree`, a 260px column) and the compact two-tier bar
// (`SectionPanel`) are two shapes of one thing — *where you are in the app* — so
// they share one setting. A reader sees one of them at a time, and tuning them
// apart would be two more settings rows for a difference nobody can observe.
//
// Pure functions over already-read data: no repository, no port, no react, no
// next. The caller reads the two settings and the texture library — both cheap,
// and the layout already reads the library for personal toolbars — and hands
// them here. Same shape as `app-texture`, and for the same reason: this module
// owns a resolution rule and nothing else.
//
// WHY THERE IS NO UPLOAD HERE. A navigation texture points at a picture already
// in the app texture library (`sys_dashboard_textures`, migration 0113). The
// pointer resolves through that library's own serving route, which is already
// session-gated and already cache-busted. So this feature stores two scalars and
// no bytes — the trade migration 0130 made for personal toolbars, unchanged.

import type { DashboardTextureItem } from "@/lib/dashboard-texture";
import type { NavTextureSettings, ResolvedNavTexture } from "./types";

/**
 * The strength a navigation texture draws at when nothing has been chosen.
 *
 * 0.15, matching a personal toolbar's default rather than the 0.10 a full-page
 * background uses. The reasoning migration 0130 gives carries over: the
 * navigation column is 260px wide and the compact bar is shorter still, so a
 * picture tuned to sit quietly behind a whole page is effectively invisible in
 * it. A reader who picks a texture should see that they picked one.
 */
export const DEFAULT_NAV_TEXTURE_OPACITY = 0.15;

/**
 * The settings keys this module reads. Exported so the admin screen and the
 * action write the same strings the resolver reads, rather than three files
 * agreeing on two literals by hand.
 */
export const NAV_TEXTURE_ID_KEY = "nav_texture_id";
/**
 * What `nav_texture_id` holds when no picture is chosen.
 *
 * `"0"` and not `""`, because `settingUpdateSchema` requires a non-empty value —
 * so the admin screen cannot clear the choice by writing a blank through the
 * same path every other setting uses. Library ids are AUTOINCREMENT rowids and
 * start at 1, so this sentinel can never collide with a real picture.
 */
export const NO_NAV_TEXTURE = "0";
export const NAV_TEXTURE_OPACITY_KEY = "nav_texture_opacity";

/**
 * Clamp a stored opacity to 0..1, falling back to the default.
 *
 * Settings values are free-form text — the table has no CHECK to lean on, which
 * is the cost of shipping without a migration — so this is the only thing
 * standing between a hand-edited row and a navigation column drawn at opacity
 * 40. A blank, a word, and a number out of range all resolve to the default
 * rather than erroring: a bad preference should not break navigation.
 */
export function resolveNavTextureOpacity(value?: string): number {
  if (value === undefined || value.trim() === "") return DEFAULT_NAV_TEXTURE_OPACITY;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_NAV_TEXTURE_OPACITY;
  return Math.min(1, Math.max(0, parsed));
}

/**
 * What the navigation should draw, given the saved settings and the library.
 *
 * Resolves to `undefined` — draw a plain column — for every one of:
 *
 *  - **no picture chosen**, the default state of a fresh install;
 *  - **a blank or unparseable id**, which is what a hand-edited settings row or
 *    a half-written value looks like;
 *  - **a pointer at a deleted picture**. There is no foreign key here (the
 *    schema has none anywhere, and migration 0117 set the precedent), so an
 *    admin deleting a library picture leaves this pointer stale rather than
 *    having the delete cascade into unrelated chrome. Falling through to "no
 *    texture" is what stops that from rendering as a layer whose URL 404s —
 *    a visibly broken column rather than a plain one.
 *
 * `hasImage` is checked as well as the lookup, mirroring `resolveAppTexture` and
 * `resolveToolbar`: the column is `NOT NULL` today, so this costs nothing and
 * makes the renderer's precondition explicit.
 */
export function resolveNavTexture(
  settings: NavTextureSettings,
  textures: readonly DashboardTextureItem[],
): ResolvedNavTexture | undefined {
  const raw = settings.id?.trim();
  if (!raw) return undefined;

  const id = Number(raw);
  if (!Number.isInteger(id)) return undefined;

  // `"0"` is the "no texture" sentinel, and it exists because `settingUpdateSchema`
  // rejects a blank value — so clearing the choice cannot be written as `""`
  // through the same path that writes every other setting. A real library id is
  // an AUTOINCREMENT rowid and therefore always >= 1, so no picture is shadowed
  // by this. Anything negative is nonsense and lands here too.
  if (id < 1) return undefined;

  const picture = textures.find((texture) => texture.id === id);
  if (!picture?.hasImage) return undefined;

  return {
    // `?v=<updatedAt>` because the serving route sends a 5-minute max-age —
    // without it, replacing the picture in the library would appear to do
    // nothing in the navigation. The same cache-buster the other two resolvers
    // build.
    image: `url("/api/dashboard/texture?id=${picture.id}&v=${encodeURIComponent(
      picture.updatedAt,
    )}")`,
    // The navigation's own opacity, NOT the library row's. Same divergence from
    // `resolveAppTexture` that migration 0130 documents for a toolbar, and for
    // the same reason: a narrow strip of a picture tuned for a full page reads
    // as nothing at all.
    opacity: resolveNavTextureOpacity(settings.opacity),
  };
}

/**
 * The custom properties the `[data-nav-textured]` rule in globals.css reads.
 *
 * Here rather than at the call site because two components render this layer —
 * the desktop tree and the compact bar — and two copies of the same object
 * literal is how the two drift. The CSS never asks which one it is drawing for.
 */
export function navTextureVars(texture: ResolvedNavTexture): Record<string, string> {
  return {
    "--nav-texture-image": texture.image,
    "--nav-texture-opacity": String(texture.opacity),
  };
}
