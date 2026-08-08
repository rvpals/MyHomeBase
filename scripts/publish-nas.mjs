// Builds a ready-to-copy deployment folder for the Synology NAS (aarch64).
//
// The NAS is a DS223: 2 GB RAM, quad Cortex-A55, already swapping at idle. A
// `next build` there would thrash for an hour and probably be OOM-killed, so
// everything is built here on Windows and only *finished bytes* are copied
// across. The NAS runs no npm, no compiler and no build step.
//
// Two things make that possible:
//   1. The app has exactly one native module that matters — `better-sqlite3`.
//      (`sharp` is also present but is never loaded: nothing imports
//      `next/image`, and sharp isn't even a declared dependency.) Its arm64
//      binary is a published prebuild, so we download it rather than compile.
//   2. The migration runner is bundled to plain CJS, so the NAS doesn't need
//      `tsx` — which would drag in esbuild's own platform binary and reintroduce
//      the very problem we're avoiding.
//
// Usage:  npm run publish:nas
// Output: dist-nas/  — copy the whole folder to the NAS.

import { execFileSync, execSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "dist-nas");

/**
 * The target Node's ABI, not its version string — that is what a prebuild is
 * keyed on, and the usual way to get this wrong. Package Center's Node.js v20
 * on DSM is ABI 115. Node 22 would be 127.
 */
const NODE_ABI = 115;
const TARGET = "linux-arm64";

const BETTER_SQLITE3_VERSION = JSON.parse(
  readFileSync(path.join(ROOT, "package.json"), "utf8"),
).dependencies["better-sqlite3"];

function step(message) {
  console.log(`\n▸ ${message}`);
}

// ---------------------------------------------------------------------------

step("Building (clears .next first)");
// `execSync` with one command string, not `execFileSync(..., { shell: true })`:
// the latter emits Node's DEP0190 warning on every publish (args concatenated
// rather than escaped). Passing `npm.cmd` to execFileSync without a shell is
// not an alternative — Node refuses to spawn `.cmd` directly since 20.12.
execSync("npm run build", { stdio: "inherit" });

step("Assembling dist-nas/");
rmSync(OUT, { recursive: true, force: true });
// `.next/standalone` is the server plus its traced node_modules.
//
// `dereference` is essential, not tidiness. Turbopack rewrites
// `require("better-sqlite3")` to a hash-suffixed name and satisfies it with a
// **symlink** at `.next/node_modules/better-sqlite3-<hash>` pointing at an
// absolute path on this machine. Copied as a link it is dead the moment the
// folder leaves Windows, and the server dies at startup with
// "Cannot find module 'better-sqlite3-<hash>'". Materialising it also means the
// arm64 patch below can actually see the binary inside.
cpSync(path.join(ROOT, ".next", "standalone"), OUT, { recursive: true, dereference: true });
// Next does not copy these two into standalone; they have to be placed by hand.
cpSync(path.join(ROOT, ".next", "static"), path.join(OUT, ".next", "static"), {
  recursive: true,
});
if (existsSync(path.join(ROOT, "public"))) {
  cpSync(path.join(ROOT, "public"), path.join(OUT, "public"), { recursive: true });
}
// Needed on the NAS: migrations to apply, and the changelog the About page reads
// from process.cwd().
cpSync(path.join(ROOT, "migrations"), path.join(OUT, "migrations"), { recursive: true });
cpSync(path.join(ROOT, "CHANGE_HISTORY.md"), path.join(OUT, "CHANGE_HISTORY.md"));

step("Materialising symlinks");
// `cpSync`'s `dereference` does not expand Windows *directory* symlinks, and
// Turbopack uses exactly that for `.next/node_modules/better-sqlite3-<hash>`.
// Each surviving link is replaced by a real copy of what it points at. Looped,
// because materialising one can expose another nested inside it.
for (let pass = 0; pass < 5; pass += 1) {
  const links = [...walkEntries(OUT)].filter((entry) => entry.isSymbolicLink);
  if (links.length === 0) break;
  for (const link of links) {
    const target = realpathSync(link.path);
    rmSync(link.path, { recursive: true, force: true });
    cpSync(target, link.path, { recursive: true, dereference: true });
    console.log(`  materialised ${path.relative(OUT, link.path)}`);
  }
}

step("Removing what the build should never have included");
// Next traces both of these into standalone because the build opens the
// database while collecting page data. `outputFileTracingExcludes` does not
// stop it (verified on Next 16.2), so they are deleted here instead.
//
// The database matters more than the size: `wiring.ts` falls back to
// `./data/myhomebase.db` when MYHOMEBASE_DB is unset, so shipping one means a
// misconfigured deploy silently serves stale data instead of failing loudly.
for (const unwanted of ["data", ".env", ".env.local", ".env.production"]) {
  const target = path.join(OUT, unwanted);
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
    console.log(`  removed ${unwanted}`);
  }
}

step(`Swapping in the ${TARGET} better-sqlite3 (ABI ${NODE_ABI})`);
const tarballName = `better-sqlite3-v${BETTER_SQLITE3_VERSION}-node-v${NODE_ABI}-${TARGET}.tar.gz`;
const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${BETTER_SQLITE3_VERSION}/${tarballName}`;

const response = await fetch(url);
if (!response.ok) {
  throw new Error(`No prebuild at ${url} (HTTP ${response.status}).`);
}
const scratch = mkdtempSync(path.join(tmpdir(), "mhb-prebuild-"));
const tarballPath = path.join(scratch, tarballName);
writeFileSync(tarballPath, Buffer.from(await response.arrayBuffer()));
execFileSync("tar", ["-xzf", tarballPath, "-C", scratch]);

const arm64Binary = path.join(scratch, "build", "Release", "better_sqlite3.node");
assertIsAarch64Elf(arm64Binary);

// Replace *every* copy. A standalone tree has carried a second, hash-named copy
// under `.next/node_modules/` in the past; missing one gives a runtime crash
// rather than an honest error, so this searches rather than assuming a path.
const replaced = [];
for (const file of walk(OUT)) {
  if (path.basename(file) === "better_sqlite3.node") {
    cpSync(arm64Binary, file);
    chmodSync(file, 0o755);
    replaced.push(path.relative(OUT, file));
  }
}
rmSync(scratch, { recursive: true, force: true });
if (replaced.length === 0) throw new Error("Found no better_sqlite3.node to replace.");
for (const file of replaced) console.log(`  patched ${file}`);

step("Bundling the migration runner (so the NAS needs no tsx)");
await build({
  entryPoints: [path.join(ROOT, "scripts", "migrate.ts")],
  outfile: path.join(OUT, "migrate.cjs"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  // Kept external so it resolves to the arm64 module we just patched, rather
  // than being inlined (which is impossible for a native addon anyway).
  external: ["better-sqlite3"],
  logLevel: "warning",
});

step("Verifying the folder is actually portable");
// Any surviving symlink points at a path on this machine and will be broken on
// the NAS — which is how the hash-named better-sqlite3 module failed the first
// time, with an error that named a module rather than a missing file.
const symlinks = [...walkEntries(OUT)].filter((entry) => entry.isSymbolicLink);
if (symlinks.length > 0) {
  throw new Error(
    `${symlinks.length} symlink(s) left in the output, e.g. ${path.relative(OUT, symlinks[0].path)}`,
  );
}
console.log("  no symlinks");

// Every copy of the driver must be the arm64 one, not just the first found.
let checked = 0;
for (const file of walk(OUT)) {
  if (path.basename(file) === "better_sqlite3.node") {
    assertIsAarch64Elf(file, path.relative(OUT, file));
    checked += 1;
  }
}
console.log(`  ${checked} better-sqlite3 binaries, all AArch64`);

step("Done");
console.log(`  ${OUT}`);
console.log(`  ${(directorySize(OUT) / 1024 / 1024).toFixed(1)} MB`);
console.log("\nOn the NAS:");
console.log("  node migrate.cjs      # apply any pending migrations");
console.log("  node server.js        # start the app");

// ---------------------------------------------------------------------------

/** Every file under `dir`, recursively. Does not descend into symlinks. */
function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

/** Like `walk`, but reports symlinks too — they're invisible to `walk`. */
function* walkEntries(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) yield { path: full, isSymbolicLink: true };
    else if (entry.isDirectory()) yield* walkEntries(full);
  }
}

function directorySize(dir) {
  let total = 0;
  for (const file of walk(dir)) total += statSync(file).size;
  return total;
}

/**
 * Confirms the downloaded binary really is an AArch64 ELF object.
 *
 * Cheap insurance against a silently wrong download: the alternative is
 * discovering it on the NAS as an unhelpful load error at first request.
 */
function assertIsAarch64Elf(file, label = file) {
  const header = readFileSync(file).subarray(0, 20);
  const isElf = header.subarray(0, 4).toString("binary") === "\x7fELF";
  // e_machine is a 16-bit LE field at offset 18; 0xB7 is AArch64.
  const machine = header.readUInt16LE(18);
  if (!isElf || machine !== 0xb7) {
    throw new Error(`${label} is not an AArch64 ELF (machine=0x${machine.toString(16)}).`);
  }
}
