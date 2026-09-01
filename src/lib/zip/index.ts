// The public surface of the zip module. Import from here, never from a file inside it.
//
// Bundles several in-memory files into one ZIP archive, so a screen offering a
// multi-file download can hand the browser a single response instead of firing one
// download per file. Store-only and dependency-free — see `zip.ts` for what that buys
// and what it deliberately doesn't support.
export { buildZip, crc32, MAX_ARCHIVE_BYTES, type ZipEntry } from "./zip";
