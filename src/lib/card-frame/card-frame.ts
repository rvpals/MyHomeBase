import { decodeImageUpload, type ImageUploadInput } from "@/lib/shared/image-upload";
import type { CardFrameRepository } from "./ports";
import { cardFrameNameSchema, cardFrameSettingsSchema } from "./schema";
import type { CardFrame, CardFrameSelection, CardFrameSettings } from "./types";

/**
 * 4 MB, as the texture modules use. A frame is usually far smaller — the
 * artwork is a few hundred pixels square — but matching the neighbouring cap
 * means one number for an admin to learn instead of two.
 */
export const MAX_CARD_FRAME_BYTES = 4 * 1024 * 1024;

/**
 * The library cap, as `MAX_DASHBOARD_TEXTURES`. Frames are chrome, not content:
 * an installation needs a handful to choose between, and an unbounded gallery
 * is a slow admin screen plus an unbounded number of BLOBs in a DB that lives
 * on a NAS.
 */
export const MAX_CARD_FRAMES = 20;

/** What every `CustomizableCard` draws, application-wide. */
export function getCardFrameSelection(repo: CardFrameRepository): CardFrameSelection {
  return repo.getSelection();
}

/** Every frame in the library, in gallery order. Never the bytes. */
export function listCardFrames(repo: CardFrameRepository): CardFrame[] {
  return repo.listFrames();
}

/** One frame by id, or `undefined`. Never the bytes. */
export function getCardFrameById(repo: CardFrameRepository, id: number): CardFrame | undefined {
  return repo.getFrameById(id);
}

/**
 * One frame's bytes, for the serving route alone. With no `id`, the selected
 * frame's.
 */
export function getCardFrameImage(repo: CardFrameRepository, id?: number) {
  return repo.getFrameImage(id);
}

export function addCardFrame(
  repo: CardFrameRepository,
  name: string,
  input: ImageUploadInput,
  settings: CardFrameSettings,
): number {
  // The cap is checked here rather than in the repository because it is a
  // product rule, not a storage one — the same split `addDashboardTexture` uses.
  if (repo.listFrames().length >= MAX_CARD_FRAMES) {
    throw new Error(`The frame library holds ${MAX_CARD_FRAMES} pictures. Delete one first.`);
  }
  const validName = cardFrameNameSchema.parse(name);
  const validSettings = cardFrameSettingsSchema.parse(settings);
  const image = decodeImageUpload(input, MAX_CARD_FRAME_BYTES);
  return repo.addFrame(validName, image, validSettings);
}

export function replaceCardFrameImage(
  repo: CardFrameRepository,
  id: number,
  input: ImageUploadInput,
): void {
  const image = decodeImageUpload(input, MAX_CARD_FRAME_BYTES);
  if (!repo.replaceFrameImage(id, image)) throw new Error("That frame no longer exists.");
}

export function renameCardFrame(repo: CardFrameRepository, id: number, name: string): void {
  const validName = cardFrameNameSchema.parse(name);
  if (!repo.renameFrame(id, validName)) throw new Error("That frame no longer exists.");
}

export function deleteCardFrame(repo: CardFrameRepository, id: number): void {
  if (!repo.deleteFrame(id)) throw new Error("That frame no longer exists.");
}

/**
 * Points every card at a library frame, or at none.
 *
 * `undefined` is a valid argument and not an error: it is how an admin turns
 * frames off and returns every card to its theme-drawn border.
 */
export function selectCardFrame(repo: CardFrameRepository, id: number | undefined): void {
  if (!repo.selectFrame(id)) throw new Error("That frame no longer exists.");
}

export function saveCardFrameSettings(
  repo: CardFrameRepository,
  id: number,
  settings: CardFrameSettings,
): void {
  const valid = cardFrameSettingsSchema.parse(settings);
  if (!repo.setSettings(id, valid)) throw new Error("That frame no longer exists.");
}

/**
 * The CSS custom properties that draw a frame, or `undefined` when there is none.
 *
 * WHY CUSTOM PROPERTIES AND NOT A PROP ON EACH CARD. The selection is
 * application-wide, so the layout resolves it once and publishes it on a
 * wrapper; `.card-framed` in `globals.css` reads it. Every `CustomizableCard`
 * then follows the selection with **no call site passing anything** — which is
 * what "change the setting, every card changes" requires. The same mechanism
 * `[data-app-texture]` already uses for the background picture.
 *
 * `undefined` means render nothing: the caller omits the attribute entirely and
 * cards fall back to their theme border, rather than emitting a `none` that
 * would still cost a paint.
 */
export function cardFrameVars(selection: CardFrameSelection): Record<string, string> | undefined {
  const frame = selection.frame;
  if (!frame?.hasImage) return undefined;

  const { top, right, bottom, left } = frame.insets;

  // All four slices at zero is a frame with no border — every pixel of the
  // picture would be "centre", and `border-image` draws nothing at all. That is
  // indistinguishable from no frame, so say so rather than emitting a layer
  // that paints an invisible border and leaves the admin hunting for why.
  if (top === 0 && right === 0 && bottom === 0 && left === 0) return undefined;

  // `?v=` is mandatory: the serving route sends a 5-minute max-age, so without
  // it a replaced picture keeps showing the old bytes.
  const url = `url("/api/card-frame?id=${frame.id}&v=${encodeURIComponent(frame.updatedAt)}")`;

  return {
    "--card-frame-image": url,
    // Unitless, per `border-image-slice`: the numbers are source pixels and
    // adding `px` makes the whole declaration invalid.
    //
    // The `fill` keyword is appended by the CSS, not here, so this variable
    // stays a plain four-number slice usable anywhere a slice is wanted.
    "--card-frame-slice": `${top} ${right} ${bottom} ${left}`,
    // The border box the slices are drawn into. Equal to the slices, so the
    // artwork renders at its natural thickness rather than being scaled to some
    // other width — these DO carry units.
    "--card-frame-width": `${top}px ${right}px ${bottom}px ${left}px`,
    "--card-frame-repeat": frame.fill,
    // WHETHER the picture's middle paints at all.
    //
    // The centre is painted by `border-image`'s own `fill` keyword rather than
    // by a second background layer: a separate layer has to pick its own
    // scaling, and any choice disagrees with the border's, leaving a hard seam
    // where the two meet. `fill` slices the middle with the same nine-patch
    // geometry as the edges, so there is nothing to disagree.
    //
    // Turning the centre OFF therefore means omitting the keyword, which is a
    // change to the *syntax* of the declaration rather than to a value in it.
    // A custom property substituting to empty would leave a trailing separator
    // and is fragile, so the CSS carries two explicit rules and switches on the
    // `data-card-frame` attribute, which the layout sets to this value.
    "--card-frame-center": frame.centerFill ? "on" : "off",
    // Dims the whole frame, border included, because `fill` makes the centre
    // part of the same layer and a layer carries one opacity. The seam this
    // avoids was judged worse than losing independent background dimming.
    "--card-frame-fill-opacity": String(frame.fillOpacity),
  };
}
