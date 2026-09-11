// The public surface of the photo-download module. Import from here, never from a
// file inside it.
//
// Turning a selection of paths from the photo archive into the shape of a zip file:
// what each entry is called inside the archive, what the archive itself is called, and
// how many photographs and bytes one request may ask for.
//
// Owned by neither of its callers on purpose. The Picture Gallery's Favorite photos
// screen and its Albums screen both download several pictures at once, and the rules
// for doing that well — flat layout, collision-free names, a ceiling that keeps the
// server from reading an entire archive into memory — are the same for both.
export {
  MAX_DOWNLOAD_BYTES,
  MAX_DOWNLOAD_PHOTOS,
  photoArchiveName,
  planPhotoDownload,
  type PhotoDownloadEntry,
} from "./plan";
