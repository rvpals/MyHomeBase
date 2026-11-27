// Lists one level of the photo archive from the terminal -- the same use-case the photo
// viewer's Browse tree calls, with argv instead of a click.
//
// Usage:
//   npm run cli -- browse-photos              the archive root
//   npm run cli -- browse-photos "2019"       one folder, path from the photo root
//
// Read-only: two directory listings, no file opened.

import { NodePhotoFileStore, listArchiveFolder, photoBrowseSchema } from "@/lib/journal-photos";
import { deps } from "@/lib/wiring";

export async function browsePhotosCommand(args: string[]): Promise<void> {
  const parsed = photoBrowseSchema.safeParse({ relativePath: args[0] ?? "" });
  if (!parsed.success) {
    console.error(parsed.error.issues[0]?.message ?? "Not a valid photo folder.");
    process.exitCode = 1;
    return;
  }

  const result = await listArchiveFolder(
    new NodePhotoFileStore(deps.photoRootFromEnv),
    parsed.data,
  );

  if (!result.isAvailable) {
    console.error(`Couldn't read "${result.relativePath || "/"}": ${result.reason}`);
    process.exitCode = 1;
    return;
  }

  console.log(`/${result.relativePath}`);
  for (const folder of result.folders) console.log(`  [dir]  ${folder}`);
  for (const photo of result.photos) console.log(`         ${photo}`);
  console.log(`${result.folders.length} folder(s), ${result.photos.length} photo(s).`);
}
