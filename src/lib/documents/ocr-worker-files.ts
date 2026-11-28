// Checks, BEFORE a tesseract.js worker is spawned, that every module the worker thread
// will `require` is actually installed.
//
// ## Why this exists
//
// tesseract.js starts its worker with `new Worker(".../worker-script/node/index.js")`
// and attaches only a 'message' listener. If that script can't load one of its
// requires, the Worker emits 'error' with no listener, and Node kills the whole server
// process -- no exception the caller can catch, no response, just "An unexpected
// response was received from the server" in the browser. That is exactly what happened
// on the NAS when Next's file tracing left the worker's half of tesseract.js out of the
// standalone build (see the "Copying tesseract.js" step in scripts/publish-nas.mjs).
//
// Walking the worker's static require graph from the main thread costs a few ms and
// ~30 small file reads, and turns that crash into an ordinary error naming the files.

import { existsSync, readFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import path from "node:path";

const BUILTINS = new Set(builtinModules);

/**
 * The string-literal `require("...")` specifiers in a CommonJS source, in order,
 * without duplicates. Dynamic requires (`require(variable)`) are not reported -- the
 * worker's are the six tesseract.js-core variants, checked by `CORE_VARIANT` below.
 */
export function extractRequireSpecifiers(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const specifier = match[1]!;
    if (!found.includes(specifier)) found.push(specifier);
  }
  return found;
}

/** `fs`, `node:fs`, `fs/promises` -- needs no file. */
export function isBuiltinSpecifier(specifier: string): boolean {
  const bare = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
  return BUILTINS.has(bare) || BUILTINS.has(bare.split("/")[0]!);
}

/**
 * Specifiers some file requires only on a code path the Node worker never takes.
 * `node-fetch` is required as `global.fetch || require('node-fetch')`, and node-fetch in
 * turn tries `encoding` inside a try/catch; neither is needed on Node 18+.
 */
const OPTIONAL = new Set(["encoding"]);

/** One WASM build the worker is guaranteed to pick on any CPU (no SIMD needed). */
const CORE_VARIANT = "tesseract.js-core/tesseract-core-lstm";

export interface OcrWorkerFilesCheck {
  /** The worker script checked, or where it was expected. */
  workerScript: string;
  /** How many source files the walk read. */
  filesChecked: number;
  /** `<specifier> (required by <file>)` for everything that didn't resolve. */
  missing: string[];
}

/**
 * Walks the worker script's static require graph from `nodeModulesDir` and reports
 * what doesn't resolve. Never throws.
 *
 * `nodeModulesDir` is `<cwd>/node_modules`: on the NAS the standalone server's
 * `node_modules` sits beside `server.js`, which is the process's cwd.
 */
export function checkOcrWorkerFiles(
  nodeModulesDir: string = path.join(process.cwd(), "node_modules"),
): OcrWorkerFilesCheck {
  const workerScript = path.join(nodeModulesDir, "tesseract.js", "src", "worker-script", "node", "index.js");
  const missing: string[] = [];
  if (!existsSync(workerScript)) {
    return { workerScript, filesChecked: 0, missing: [`tesseract.js/src/worker-script/node/index.js (the worker script itself)`] };
  }

  const visited = new Set<string>();
  const queue = [workerScript];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      missing.push(`${path.relative(nodeModulesDir, file)} (unreadable)`);
      continue;
    }
    const resolveFrom = createRequire(file);
    for (const specifier of extractRequireSpecifiers(source)) {
      if (isBuiltinSpecifier(specifier) || OPTIONAL.has(specifier)) continue;
      let resolved: string;
      try {
        resolved = resolveFrom.resolve(specifier);
      } catch {
        missing.push(`${specifier} (required by ${path.relative(nodeModulesDir, file)})`);
        continue;
      }
      // Follow JavaScript only; a .json or .wasm needs no walking.
      if (/\.(c?js)$/.test(resolved)) queue.push(resolved);
    }
  }

  try {
    createRequire(workerScript).resolve(CORE_VARIANT);
  } catch {
    missing.push(`${CORE_VARIANT} (the OCR engine, picked at run time)`);
  }

  return { workerScript, filesChecked: visited.size, missing };
}
