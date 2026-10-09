import type { DecodedImage } from "@/lib/shared/image-upload";
import type { CardFrame, CardFrameSelection, CardFrameSettings } from "./types";

// The use-cases depend on THIS interface, not on a concrete database.
export interface CardFrameRepository {
  /**
   * The frame every `CustomizableCard` draws, or the "no frame" state.
   * **Never includes the image bytes** — this is read on every protected
   * render, so it must stay a cheap scalar read.
   */
  getSelection(): CardFrameSelection;

  /**
   * Every frame in the library, in gallery order. **Never includes the image
   * bytes**: the admin screen renders thumbnails from the serving route, and a
   * read that pulled BLOBs would put every frame through a page render.
   */
  listFrames(): CardFrame[];

  /** One frame by id, or `undefined`. **Never includes the image bytes.** */
  getFrameById(id: number): CardFrame | undefined;

  /**
   * One frame's bytes. **The only read that touches a BLOB** — call it from the
   * serving route and nowhere else.
   *
   * With no `id`, returns the selected frame's bytes, which is what the
   * application-wide CSS url resolves to.
   */
  getFrameImage(id?: number): DecodedImage | undefined;

  /**
   * Appends a frame to the library and returns its new id. The library cap is
   * enforced by the use-case, not here — see `addCardFrame`.
   */
  addFrame(name: string, image: DecodedImage, settings: CardFrameSettings): number;

  /**
   * Swaps the bytes of an existing frame, keeping its name, its slices and its
   * place in the gallery. Returns false when the id is not in the library.
   *
   * Deliberately leaves the insets alone: replacing a picture with a re-export
   * of the same artwork is the common case, and clearing the slices would make
   * the admin retype four numbers every time. A genuinely different frame needs
   * them retyped anyway, and the preview shows that immediately.
   */
  replaceFrameImage(id: number, image: DecodedImage): boolean;

  /** Renames a frame. Returns false when the id is not in the library. */
  renameFrame(id: number, name: string): boolean;

  /**
   * Removes a frame, clearing the selection if it was the selected one.
   * Returns false when the id is not in the library.
   */
  deleteFrame(id: number): boolean;

  /**
   * Points every card at a library frame, or at nothing when given `undefined`.
   * Returns false when the id is not in the library.
   */
  selectFrame(id: number | undefined): boolean;

  /**
   * Updates one frame's slices and knobs, leaving its bytes alone. Returns
   * false when the id is not in the library.
   */
  setSettings(id: number, settings: CardFrameSettings): boolean;
}
