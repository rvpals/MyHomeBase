import type { DecodedImage } from "@/lib/shared/image-upload";
import type { DashboardTexture, DashboardTextureItem, DashboardTextureSettings } from "./types";

// The use-cases depend on THIS interface, not on a concrete database.
export interface DashboardTextureRepository {
  /**
   * What the dashboard draws: the selected library picture, flattened, or the
   * "no texture" state when nothing is selected. **Never includes the image
   * bytes** — the domain type carries only `hasImage`, so this read is safe on
   * the home dashboard's render path.
   */
  getTexture(): DashboardTexture;

  /**
   * Every picture in the library, in gallery order. **Never includes the image
   * bytes**: at 20 rows of up to 4 MB, a read that pulled them would put 80 MB
   * through a page render. The admin screen renders thumbnails from the serving
   * route instead.
   */
  listTextures(): DashboardTextureItem[];

  /**
   * One picture's bytes. **The only read that touches a BLOB** — call it from
   * the serving route and nowhere else.
   *
   * With no `id`, returns the selected picture's bytes; that is what the
   * dashboard's own CSS url resolves to.
   */
  getTextureImage(id?: number): DecodedImage | undefined;

  /**
   * Appends a picture to the library and returns its new id. The 20-picture cap
   * is enforced by the use-case, not here — see `addDashboardTexture`.
   */
  addTexture(name: string, image: DecodedImage): number;

  /**
   * Swaps the bytes of an existing picture, keeping its name, its knobs and its
   * place in the gallery. Returns false when the id is not in the library.
   */
  replaceTextureImage(id: number, image: DecodedImage): boolean;

  /** Renames a picture. Returns false when the id is not in the library. */
  renameTexture(id: number, name: string): boolean;

  /**
   * Removes a picture from the library, clearing the selection if it was the
   * selected one. Returns false when the id is not in the library.
   */
  deleteTexture(id: number): boolean;

  /**
   * Points the dashboard at a library picture, or at nothing when given
   * `undefined`. Returns false when the id is not in the library.
   */
  selectTexture(id: number | undefined): boolean;

  /**
   * Updates one picture's display knobs, leaving its bytes alone. Returns false
   * when the id is not in the library.
   */
  setSettings(id: number, settings: DashboardTextureSettings): boolean;
}
