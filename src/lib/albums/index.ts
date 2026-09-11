// The public surface of the albums module. Import from here, never from a file
// inside it.
//
// Photo albums: named, ordered collections of paths into the photo archive. The first
// thing the Picture Gallery module owns — everything else it shows belongs to another
// module (the archive to `journal-photos`, the kept pictures to `fav-photos`), which
// is why this is where its `pho_` tables and its first real use-cases live.
//
// An album stores PATHS, never bytes. A picture can be in any number of albums, and
// deleting an album never touches a file. See migrations/0087_create_albums.md.
export type { Album, AlbumPhoto, AlbumSummary, AlbumWithPhotos } from "./types";
export type { AlbumRepository } from "./ports";
export {
  albumCreateSchema,
  albumDescriptionSchema,
  albumIdSchema,
  albumNameSchema,
  albumOrderSchema,
  albumPhotoPathSchema,
  albumPhotosSchema,
  albumUpdateSchema,
  MAX_ALBUM_PHOTOS,
  type AlbumCreateInput,
  type AlbumOrderInput,
  type AlbumPhotosInput,
  type AlbumUpdateInput,
} from "./schema";
export { SqliteAlbumRepository } from "./repository";
export {
  addPhotosToAlbum,
  albumIdsContaining,
  createAlbum,
  deleteAlbum,
  getAlbum,
  listAlbums,
  removePhotosFromAlbum,
  reorderAlbumPhotos,
  updateAlbum,
  type AlbumResult,
} from "./albums";
