import { pickTestPhotos, type ScannedPhoto } from "./pick-test-photos";
import { testServerResizeImage, type ServerResizeTestDeps } from "./test-server-resize-image";

// Experiment: the server-resize test, run on three photos picked from one folder -- one
// with an EXIF preview, one without, and the biggest file. Plain-text report, never throws
// (each single-photo report carries its own errors as lines).

export async function runServerResizeSuite(
  deps: ServerResizeTestDeps,
  input: { folderPath: string; photos: { relativePath: string; name: string }[] },
): Promise<string> {
  const lines: string[] = ["Server image resize suite", "", `Folder:  ${input.folderPath}`];

  if (input.photos.length === 0) {
    lines.push("", "No photos in that folder. Nothing was run.");
    return lines.join("\n");
  }

  const picked = await pickTestPhotos(deps.reader, input.photos);
  lines.push(
    `Scanned: ${picked.scanned} of ${picked.totalInFolder} photos` +
      (picked.isCapped ? " (capped, the rest were not read)" : "") +
      (picked.unreadable > 0 ? `, ${picked.unreadable} unreadable` : ""),
    `Found:   ${picked.withPreviewCount} with an EXIF preview, ${picked.withoutPreviewCount} without`,
  );

  const tests: { title: string; photo: ScannedPhoto | undefined; missing: string }[] = [
    {
      title: "has an EXIF preview",
      photo: picked.withPreview,
      missing: "No scanned photo has an EXIF preview.",
    },
    {
      title: "no EXIF preview",
      photo: picked.withoutPreview,
      missing: "Every scanned photo has an EXIF preview.",
    },
    {
      title: "largest file",
      photo: picked.largest,
      missing: "No photo could be read.",
    },
  ];

  for (const [index, test] of tests.entries()) {
    lines.push("", `=== Test ${index + 1} of ${tests.length}: ${test.title} ===`);
    if (test.photo === undefined) {
      lines.push(`Skipped. ${test.missing}`);
      continue;
    }
    lines.push(await testServerResizeImage(deps, { relativePath: test.photo.relativePath }));
  }

  return lines.join("\n");
}
