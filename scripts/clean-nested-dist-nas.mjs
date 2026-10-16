// One-off cleanup for the `dist-nas/dist-nas/dist-nas/...` recursion.
//
// Background: `dist-nas` sits in the repo root, so Next's file tracing swept it
// into `.next/standalone/dist-nas`, and publish-nas.mjs then copied that back
// into the next build's output -- nesting one level deeper per build until
// robocopy hit the 260-character path limit and the publish died with
// "ERROR 123 ... The filename, directory name, or volume label syntax is
// incorrect".
//
// The cause is fixed in scripts/publish-nas.mjs (a `filter` on the standalone
// copy) and defended again in its removal step. This script clears the trees
// that the broken builds already left behind, in three places:
//
//   1. <repo>/dist-nas                     -- local build output
//   2. <repo>/.next/standalone/dist-nas    -- the poisoned copy source
//   3. <nas>/dist-nas                      -- what got published
//
// Node's rmSync handles the deep paths that Explorer refuses to delete.
//
// Usage:
//   node scripts/clean-nested-dist-nas.mjs            # dry run, deletes nothing
//   node scripts/clean-nested-dist-nas.mjs --apply    # actually delete
//
//   node scripts/clean-nested-dist-nas.mjs --apply --nas "\\\\NAS_DS223\\app\\myhomebase"
//     (the NAS path defaults to the one below; pass --nas to override, or
//      --skip-nas to leave the NAS untouched)

import { existsSync, rmSync, statSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_NAS = "\\\\NAS_DS223\\app\\myhomebase";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const skipNas = args.includes("--skip-nas");
const nasFlag = args.indexOf("--nas");
const nasPath = nasFlag !== -1 ? args[nasFlag + 1] : DEFAULT_NAS;

if (nasFlag !== -1 && !args[nasFlag + 1]) {
  console.error("--nas needs a path after it.");
  process.exit(1);
}

/**
 * How many `dist-nas` levels are nested under `dir`, and how many bytes they
 * hold. Walks the chain rather than the whole tree: each level contains only
 * CHANGE_HISTORY.md plus the next `dist-nas`, so this stays cheap even at depth
 * 60. Stops at 500 to avoid spinning on an unexpected structure.
 */
function measure(dir) {
  let depth = 0;
  let bytes = 0;
  let cursor = path.join(dir, "dist-nas");
  while (existsSync(cursor) && depth < 500) {
    depth += 1;
    for (const entry of readdirSync(cursor, { withFileTypes: true })) {
      if (entry.isFile()) {
        try {
          bytes += statSync(path.join(cursor, entry.name)).size;
        } catch {
          // A path already too long to stat is exactly what we are cleaning up;
          // it still gets deleted below, it just does not get counted.
        }
      }
    }
    cursor = path.join(cursor, "dist-nas");
  }
  return { depth, bytes };
}

const megabytes = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

const targets = [
  { label: "local build output", dir: ROOT },
  { label: "poisoned copy source", dir: path.join(ROOT, ".next", "standalone") },
];
if (!skipNas) targets.push({ label: "published to NAS", dir: nasPath });

console.log(apply ? "Cleaning nested dist-nas trees\n" : "DRY RUN -- nothing will be deleted\n");

let found = 0;
for (const { label, dir } of targets) {
  const nested = path.join(dir, "dist-nas");
  process.stdout.write(`${label.padEnd(22)} ${nested}\n`);

  if (!existsSync(dir)) {
    console.log("  parent does not exist -- skipped\n");
    continue;
  }
  if (!existsSync(nested)) {
    console.log("  nothing to clean\n");
    continue;
  }

  const { depth, bytes } = measure(dir);
  console.log(`  ${depth} nested level(s), ${megabytes(bytes)}`);
  found += 1;

  if (!apply) {
    console.log("  would delete (re-run with --apply)\n");
    continue;
  }

  try {
    rmSync(nested, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    console.log(existsSync(nested) ? "  FAILED -- still present\n" : "  deleted\n");
  } catch (error) {
    console.log(`  FAILED -- ${error.message}\n`);
  }
}

if (found === 0) {
  console.log("Nothing nested anywhere. Already clean.");
} else if (!apply) {
  console.log("Re-run with --apply to delete.");
} else {
  console.log(
    "Done.\n\n" +
      "The local `dist-nas` here is the whole build output, not just the nested\n" +
      "part -- the next `npm run publish:nas` rebuilds it from scratch.",
  );
}
