import { describe, expect, it } from "vitest";
import { diagnosePhotoArchive } from "./diagnose";
import type { PhotoFileStore } from "./ports";
import type { PhotoRootCheck } from "./types";

// This is a diagnostic, so its own failure modes matter more than usual: a report that
// throws, or that says "fine" about a folder the app cannot actually read, is worse than
// no report at all.

interface FakeArchive {
  root?: PhotoRootCheck;
  folders?: Record<string, string[]>;
  photos?: Record<string, string[]>;
}

class FakeStore implements PhotoFileStore {
  constructor(private readonly archive: FakeArchive) {}

  async isRootAvailable(): Promise<boolean> {
    return (await this.checkRoot()).kind === "ok";
  }

  async checkRoot(): Promise<PhotoRootCheck> {
    return this.archive.root ?? { kind: "ok", path: "/volume1/MEDIA/PHOTO/BY YEAR" };
  }

  async folderExists(relativeFolder: string): Promise<boolean> {
    return (this.archive.folders ?? {})[relativeFolder] !== undefined;
  }

  async listFolderNames(relativeFolder: string): Promise<string[]> {
    return (this.archive.folders ?? {})[relativeFolder] ?? [];
  }

  async listPhotoNames(relativeFolder: string): Promise<string[]> {
    return (this.archive.photos ?? {})[relativeFolder] ?? [];
  }

  async readHeader(): Promise<Uint8Array | undefined> {
    return undefined;
  }

  async readPhoto(): Promise<{ data: Uint8Array; mimeType: string } | undefined> {
    return undefined;
  }
}

const TODAY = "2026-08-21";

describe("diagnosePhotoArchive", () => {
  it("reports the year folders and proves files are readable", async () => {
    const store = new FakeStore({
      folders: {
        "": ["2024", "2025", "2026"],
        "2026": ["2026-01", "2026-08-15 Beach Day"],
      },
      photos: { "2026/2026-01": ["a.jpg", "b.jpg", "c.jpg"] },
    });

    const report = await diagnosePhotoArchive(store, TODAY);

    expect(report.rootCheck.kind).toBe("ok");
    expect(report.yearFolders).toEqual(["2024", "2025", "2026"]);
    expect(report.yearFolderCount).toBe(3);
    expect(report.sampleYear).toBe("2026");
    expect(report.sampleYearExists).toBe(true);
    expect(report.sampleFolders).toEqual(["2026-01", "2026-08-15 Beach Day"]);
    // The end-to-end signal: a count here means FILES could be listed, not just folders.
    expect(report.samplePhotoCount).toBe(3);
    expect(report.samplePhotoFolder).toBe("2026-01");
  });

  it("stops at the root when the root is unusable, and says why", async () => {
    // Listing years would be noise when the root itself cannot be read — and the reason
    // is the one thing the report has to preserve.
    for (const kind of ["missing", "no-permission", "not-a-directory", "unreachable"] as const) {
      const store = new FakeStore({
        root: { kind, path: "/volume1/MEDIA/PHOTO/BY YEAR" },
        folders: { "": ["2026"] },
      });

      const report = await diagnosePhotoArchive(store, TODAY);

      expect(report.rootCheck.kind).toBe(kind);
      expect(report.yearFolders).toEqual([]);
      expect(report.yearFolderCount).toBe(0);
      expect(report.sampleYearExists).toBe(false);
      // Still reports which year it would have looked in.
      expect(report.sampleYear).toBe("2026");
    }
  });

  it("reports a blank path as not-configured without touching the filesystem", async () => {
    const store = new FakeStore({ root: { kind: "not-configured" } });
    const report = await diagnosePhotoArchive(store, TODAY);
    expect(report.rootCheck.kind).toBe("not-configured");
    expect(report.yearFolders).toEqual([]);
  });

  it("distinguishes a readable root with no children from an unreadable one", async () => {
    // The signature of a permissions problem one level down: the root stats fine but
    // lists nothing. Reported as zero years rather than as a root failure, so the screen
    // can say "readable but empty" instead of blaming the path.
    const store = new FakeStore({ folders: { "": [] } });

    const report = await diagnosePhotoArchive(store, TODAY);

    expect(report.rootCheck.kind).toBe("ok");
    expect(report.yearFolderCount).toBe(0);
    expect(report.sampleYearExists).toBe(false);
    expect(report.samplePhotoCount).toBeUndefined();
  });

  it("reports 0 when the folders it probed are all empty", async () => {
    // Folder names readable, no JPEGs — RAW-only folders, or a deeper ACL problem.
    const store = new FakeStore({
      folders: { "": ["2026"], "2026": ["2026-08-20 Trip"] },
      photos: {},
    });

    const report = await diagnosePhotoArchive(store, TODAY);

    expect(report.sampleYearExists).toBe(true);
    expect(report.samplePhotoCount).toBe(0);
    expect(report.samplePhotoFolder).toBeUndefined();
  });

  it("skips past empty folders to report one that actually holds photos", async () => {
    // The real archive's January is often empty while a later event folder is full;
    // reporting "0 photos" for a healthy archive reads like a failure.
    const store = new FakeStore({
      folders: { "": ["2026"], "2026": ["2026-01", "2026-02", "2026-02-15 New Year Lunch"] },
      photos: { "2026/2026-02-15 New Year Lunch": ["a.jpg", "b.jpg"] },
    });

    const report = await diagnosePhotoArchive(store, TODAY);

    expect(report.samplePhotoCount).toBe(2);
    expect(report.samplePhotoFolder).toBe("2026-02-15 New Year Lunch");
  });

  it("caps long lists and says it truncated them", async () => {
    const manyYears = Array.from({ length: 60 }, (_, index) => String(1970 + index));
    const manyFolders = Array.from({ length: 40 }, (_, index) => `2026-${String(index + 1).padStart(2, "0")}`);
    const store = new FakeStore({
      folders: { "": manyYears, "2026": manyFolders },
      photos: { "2026/2026-01": ["a.jpg"] },
    });

    const report = await diagnosePhotoArchive(store, TODAY);

    expect(report.yearFolderCount).toBe(60);
    expect(report.yearFolders.length).toBeLessThan(60);
    expect(report.truncatedYears).toBe(true);
    expect(report.sampleFolderCount).toBe(40);
    expect(report.truncatedFolders).toBe(true);
  });
});
