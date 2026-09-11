// The public surface of the fav-photos module. Import from here, never from a file
// inside it.
//
// Favourited photographs: the home screen's random photo card draws one picture at a
// time and replaces it on the next click, and this is how one is kept. A row is a path
// from the configured photo root plus a note; see
// migrations/0073_create_fav_photo.md for why the path is relative and not absolute.
export type { FavPhoto } from "./types";
export type { FavPhotoRepository } from "./ports";
export {
  favPhotoSchema,
  favPhotoPathSchema,
  favPhotoNoteSchema,
  favPhotoNoteInputSchema,
  type FavPhotoInput,
  type FavPhotoNoteInput,
} from "./schema";
export { SqliteFavPhotoRepository } from "./repository";
export {
  addFavPhoto,
  getFavPhoto,
  isFavPhoto,
  listFavPhotos,
  removeFavPhoto,
  removeFavPhotos,
  setFavPhotoNote,
  toggleFavPhoto,
  type FavPhotoBulkRemoval,
} from "./fav-photos";
// The zip-download planner used to live here as `download.ts`. Nothing in it was ever
// about favourites — it takes archive paths and returns archive paths with names — so
// when Albums became a second caller it moved to `@/lib/photo-download` rather than
// being copied. Import it from there; it is deliberately NOT re-exported through this
// front door, because a module's index should name what the module owns.
