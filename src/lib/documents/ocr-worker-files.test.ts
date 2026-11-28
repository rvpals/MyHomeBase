import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkOcrWorkerFiles, extractRequireSpecifiers, isBuiltinSpecifier } from "./ocr-worker-files";

describe("extractRequireSpecifiers", () => {
  it("lists literal requires once each, in order, and skips dynamic ones", () => {
    const source = `
      const a = require('a');
      const { b } = require("b/sub");
      const again = require('a');
      const dyn = require(name);
      const fetch = global.fetch || require( 'node-fetch' );
    `;
    expect(extractRequireSpecifiers(source)).toEqual(["a", "b/sub", "node-fetch"]);
  });
});

describe("isBuiltinSpecifier", () => {
  it("knows Node built-ins with and without the node: prefix", () => {
    expect(isBuiltinSpecifier("fs")).toBe(true);
    expect(isBuiltinSpecifier("node:worker_threads")).toBe(true);
    expect(isBuiltinSpecifier("fs/promises")).toBe(true);
    expect(isBuiltinSpecifier("wasm-feature-detect")).toBe(false);
  });
});

describe("checkOcrWorkerFiles", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  /** A fake node_modules: `files` maps a path under it to its contents. */
  function fakeNodeModules(files: Record<string, string>): string {
    const root = mkdtempSync(path.join(os.tmpdir(), "ocr-worker-files-"));
    roots.push(root);
    const nodeModules = path.join(root, "node_modules");
    for (const [file, contents] of Object.entries(files)) {
      const full = path.join(nodeModules, file);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, contents);
    }
    return nodeModules;
  }

  const WORKER = "tesseract.js/src/worker-script/node/index.js";
  const complete = {
    [WORKER]: "const fs = require('fs'); const getCore = require('./getCore'); require('..');",
    "tesseract.js/src/worker-script/node/getCore.js": "require('wasm-feature-detect');",
    "tesseract.js/src/worker-script/index.js": "require('bmp-js');",
    "wasm-feature-detect/package.json": JSON.stringify({ name: "wasm-feature-detect", main: "index.js" }),
    "wasm-feature-detect/index.js": "module.exports = {};",
    "bmp-js/package.json": JSON.stringify({ name: "bmp-js", main: "index.js" }),
    "bmp-js/index.js": "module.exports = {};",
    "tesseract.js-core/tesseract-core-lstm.js": "module.exports = {};",
  };

  it("finds nothing missing in a complete install", () => {
    const result = checkOcrWorkerFiles(fakeNodeModules(complete));
    expect(result.missing).toEqual([]);
    expect(result.filesChecked).toBe(5);
  });

  it("names the worker's missing files and packages -- the NAS standalone build's gaps", () => {
    const broken: Record<string, string> = { ...complete };
    delete broken["tesseract.js/src/worker-script/index.js"];
    delete broken["wasm-feature-detect/package.json"];
    delete broken["wasm-feature-detect/index.js"];
    delete broken["tesseract.js-core/tesseract-core-lstm.js"];

    const { missing } = checkOcrWorkerFiles(fakeNodeModules(broken));
    expect(missing).toHaveLength(3);
    expect(missing[0]).toMatch(/^\.\. \(required by tesseract\.js[\\/]src[\\/]worker-script[\\/]node[\\/]index\.js\)$/);
    expect(missing[1]).toMatch(/^wasm-feature-detect \(required by .*getCore\.js\)$/);
    expect(missing[2]).toContain("tesseract.js-core/tesseract-core-lstm");
  });

  it("reports a missing worker script without walking anything", () => {
    const result = checkOcrWorkerFiles(fakeNodeModules({ "other/index.js": "" }));
    expect(result.filesChecked).toBe(0);
    expect(result.missing[0]).toContain("the worker script itself");
  });
});
