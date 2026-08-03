import { existsSync, readFileSync, readdirSync, renameSync } from "node:fs";
import path from "node:path";

// File access for the auto-importer, behind a port so the scheduling and
// matching logic can be tested with an in-memory folder instead of real files.

export interface CsvFolderPort {
  directoryExists(directory: string): boolean;
  /** Names (not paths) of the immediate sub-folders — one per card. */
  listSubdirectoryNames(directory: string): string[];
  /** Names (not paths) of the *.csv files directly in `directory`. */
  listCsvFileNames(directory: string): string[];
  readFileText(directory: string, fileName: string): string;
  /** Renames within the same directory. */
  renameFile(directory: string, fromName: string, toName: string): void;
  /** Joining lives here so the use-case never needs to know about separators. */
  joinPath(...segments: string[]): string;
}

export class NodeCsvFolder implements CsvFolderPort {
  directoryExists(directory: string): boolean {
    return existsSync(directory);
  }

  listSubdirectoryNames(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  }

  listCsvFileNames(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csv"))
      .map((entry) => entry.name)
      .sort();
  }

  readFileText(directory: string, fileName: string): string {
    return readFileSync(path.join(directory, fileName), "utf8");
  }

  renameFile(directory: string, fromName: string, toName: string): void {
    renameSync(path.join(directory, fromName), path.join(directory, toName));
  }

  joinPath(...segments: string[]): string {
    return path.join(...segments);
  }
}
