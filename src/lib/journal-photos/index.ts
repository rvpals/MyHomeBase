// The public surface of the journal-photos module. Import from here, never from a
// file inside it.
//
// Finds the photographs a journal entry's date can be illustrated with, in an archive
// organised as: photo root -> year folder -> either a `YYYY-MM` month folder of loose
// photos or a `YYYY-MM-DD <event>` day folder. Read-only throughout.
export type {
  PhotoFile,
  PhotoFolder,
  PhotoFolderContents,
  PhotoFolderKind,
  FolderPhotos,
  PhotoFolderLookup,
  PhotoMatchSource,
  PhotoRootCheck,
  PhotoArchiveDiagnosis,
} from "./types";
export type { PhotoFileStore } from "./ports";
export {
  photoDateSchema,
  photoRelativePathSchema,
  photoFolderLookupSchema,
  photoFolderContentsSchema,
  photoFolderAllSchema,
  photoRangeSchema,
  photoRangeContentsSchema,
  type PhotoFolderLookupInput,
  type PhotoFolderContentsInput,
  type PhotoFolderAllInput,
  type PhotoRangeInput,
  type PhotoRangeContentsInput,
} from "./schema";
export { listPhotoFoldersForDate, listPhotosInFolder, monthFolderLabel } from "./photos";
export { listAllPhotosInFolder } from "./folder";
export {
  DEFAULT_SLIDESHOW_OPTIONS,
  SLIDESHOW_EFFECT_CHOICES,
  SLIDESHOW_INTERVAL_CHOICES,
  normaliseSlideshowOptions,
  slideshowIntervalMs,
  type SlideshowEffect,
  type SlideshowOptions,
} from "./slideshow";
export { listPhotoFoldersForRange } from "./range";
export { pickRandomPhoto, type RandomPhotoPick } from "./random";
export { diagnosePhotoArchive } from "./diagnose";
export { EXIF_HEADER_BYTES, readExifDate, parseExifDate } from "./exif";
export {
  dateFromFileName,
  dayFolderDateOf,
  isDayFolderFor,
  isDayFolderInRange,
  isMonthFolderInRange,
  monthFolderMonthOf,
  yearFoldersInRange,
  isMonthFolderFor,
  isMonthPrecisionDayFolder,
  isPhotoFileName,
  isSafeRelativePath,
  monthFolderNameOf,
  normaliseRelativePath,
  resolvePhotoPath,
  yearFolderOf,
} from "./paths";
export { NodePhotoFileStore } from "./file-store";
