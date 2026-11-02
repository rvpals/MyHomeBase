import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getComponentList } from "./component-list";
import type { ComponentListRepository } from "./ports";
import { COMPONENT_LIST_FILENAME, FileComponentListRepository } from "./repository";

const SAMPLE = `# Components Registry

Prose above the table, which must not be read as a row.

## Index

| Component | Use it for | Source | Client? |
|-----------|-----------|--------|---------|
| [\`Button\`](#button) | Any button or button-styled link | [src/components/button.tsx](src/components/button.tsx) | no |
| [\`DataGrid\`](#datagrid) | **Result grid** — any table of records | [src/components/data-grid.tsx](src/components/data-grid.tsx) | yes |

## Button

The section below the table, which is not part of the index.

| Prop | Type | Notes |
|------|------|-------|
| \`children\` | \`ReactNode\` | Label. |
`;

function repoReturning(markdown: string | null): ComponentListRepository {
  return { readComponentList: () => markdown };
}

describe("getComponentList", () => {
  it("reads every row of the Index table", () => {
    const result = getComponentList(repoReturning(SAMPLE));

    expect(result.isAvailable).toBe(true);
    expect(result.entries).toEqual([
      {
        name: "Button",
        purpose: "Any button or button-styled link",
        sourcePath: "src/components/button.tsx",
        isClient: false,
      },
      {
        name: "DataGrid",
        purpose: "Result grid — any table of records",
        sourcePath: "src/components/data-grid.tsx",
        isClient: true,
      },
    ]);
  });

  // The boundary that makes this parser correct rather than merely working: the
  // document is mostly tables, and only the one under `## Index` is the registry.
  it("stops at the next heading, so a later table is not read as components", () => {
    const names = getComponentList(repoReturning(SAMPLE)).entries.map((entry) => entry.name);

    expect(names).not.toContain("children");
    expect(names).toHaveLength(2);
  });

  it("strips link, code and bold syntax from the name and purpose", () => {
    const [button, grid] = getComponentList(repoReturning(SAMPLE)).entries;

    expect(button.name).toBe("Button");
    expect(grid.purpose).toBe("Result grid — any table of records");
  });

  // A hand-edited document, so a purpose mentioning a union type is a question of
  // when, not whether. The row must survive with its text intact.
  it("keeps a backslash-escaped pipe inside a cell", () => {
    const markdown = `## Index

| Component | Use it for | Source | Client? |
|---|---|---|---|
| \`ViewModeSwitch\` | Takes \`"grid" \\| "list"\` | [src/components/view-mode-switch.tsx](src/components/view-mode-switch.tsx) | yes |
`;

    const [entry] = getComponentList(repoReturning(markdown)).entries;

    expect(entry.name).toBe("ViewModeSwitch");
    expect(entry.purpose).toBe('Takes "grid" | "list"');
  });

  it("skips a malformed row rather than losing the whole table", () => {
    const markdown = `## Index

| Component | Use it for | Source | Client? |
|---|---|---|---|
| \`Broken\` | missing cells |
| \`Fine\` | works | [src/components/fine.tsx](src/components/fine.tsx) | no |
`;

    const names = getComponentList(repoReturning(markdown)).entries.map((entry) => entry.name);

    expect(names).toEqual(["Fine"]);
  });

  // The two empty states are different and the view draws them differently, so
  // the flag has to tell them apart.
  it("reports a missing file as unavailable", () => {
    expect(getComponentList(repoReturning(null))).toEqual({ entries: [], isAvailable: false });
  });

  it("reports a document with no Index table as available but empty", () => {
    const result = getComponentList(repoReturning("# Components Registry\n\nNo table here.\n"));

    expect(result).toEqual({ entries: [], isAvailable: true });
  });
});

describe("FileComponentListRepository", () => {
  const dirs: string[] = [];

  function tempDir(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "component-list-"));
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it("reads the document from the root directory it was given", () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, COMPONENT_LIST_FILENAME), SAMPLE, "utf8");

    expect(new FileComponentListRepository(dir).readComponentList()).toBe(SAMPLE);
  });

  it("returns null when the file is absent rather than throwing", () => {
    expect(new FileComponentListRepository(tempDir()).readComponentList()).toBeNull();
  });
});
