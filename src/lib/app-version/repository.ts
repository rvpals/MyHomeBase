import { readFileSync } from "node:fs";
import path from "node:path";
import type { BuildIdRepository } from "./ports";

// `next build` writes a fresh random id to `.next/BUILD_ID` on every build, so
// it changes exactly when a deployment changes and never otherwise -- which is
// precisely the signal we want. `next dev` writes no such file; that read fails
// and the module reports "unknown", which the logic treats as "never prompt".
//
// Deliberately not re-exported from index.ts, for the same reason as
// FileChangeHistoryRepository: `node:fs` would follow the barrel into any
// "use client" module importing this module's types, and AppVersionWatch is one.
// Wired in wiring.ts instead.

export const BUILD_ID_FILENAME = "BUILD_ID";

export class FileBuildIdRepository implements BuildIdRepository {
  // Read once per process, not once per request. The file cannot change under a
  // running server -- a new build means a new deployment and a restart -- and
  // the version endpoint is hit on every foreground of every installed client.
  private cached: string | null | undefined;

  constructor(private readonly rootDir: string = process.cwd()) {}

  readBuildId(): string | null {
    if (this.cached !== undefined) return this.cached;
    this.cached = this.read();
    return this.cached;
  }

  private read(): string | null {
    // `output: "standalone"` runs the server with cwd at the deployment root,
    // so `.next/BUILD_ID` resolves the same there as in a local `next start`.
    try {
      return readFileSync(path.join(this.rootDir, ".next", BUILD_ID_FILENAME), "utf8");
    } catch {
      return null;
    }
  }
}
