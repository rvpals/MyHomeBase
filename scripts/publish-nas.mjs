// Builds a ready-to-copy deployment folder for the Synology NAS (aarch64).
//
// The NAS is a DS223: 2 GB RAM, quad Cortex-A55, already swapping at idle. A
// `next build` there would thrash for an hour and probably be OOM-killed, so
// everything is built here on Windows and only *finished bytes* are copied
// across. The NAS runs no npm, no compiler and no build step.
//
// Two things make that possible:
//   1. The app has TWO native modules that matter — `better-sqlite3` and `sharp`.
//      Both have published arm64 prebuilds, so we download rather than compile.
//      (`sharp` used to be dead weight here: it ships with Next but nothing
//      imported it. It is loaded now — `src/lib/icons/image-processor.ts` uses it
//      to normalise uploaded icons — so its win32 binary has to be swapped too,
//      or every icon upload fails on the NAS.)
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
  mkdirSync,
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
 * keyed on, and the usual way to get this wrong.
 *
 * | DSM Node | ABI |
 * |----------|-----|
 * | v18      | 108 |
 * | v20      | 115 |
 * | v22      | 127 |
 *
 * **This must match the Node actually installed on the NAS.** Upgrading Node in
 * Package Center without changing this ships a binary the new runtime refuses to
 * load, and the failure is a startup crash naming NODE_MODULE_VERSION rather than
 * anything about the deploy:
 *
 *     Error: The module ... was compiled against a different Node.js version using
 *     NODE_MODULE_VERSION 115. This version of Node.js requires NODE_MODULE_VERSION 127.
 *
 * Check the NAS with `node -p process.versions.modules` (not `node -v` — the ABI is
 * what matters), then set this to match. Override without editing the file:
 *
 *     NAS_NODE_ABI=127 npm run publish:nas
 */
const NODE_ABI = Number(process.env.NAS_NODE_ABI ?? 127);
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
console.log(
  `  targeting Node ${NODE_ABI === 127 ? "22" : NODE_ABI === 115 ? "20" : "?"} on the NAS` +
    ` — confirm with \`node -p process.versions.modules\` over SSH`,
);
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

step(`Swapping in the ${TARGET} sharp`);
//
// `sharp` is not one binary but two npm packages: `@img/sharp-<platform>` (the small
// N-API binding) and `@img/sharp-libvips-<platform>` (the large image library it calls).
// Installing on Windows brings only the win32-x64 pair, so both linux-arm64 packages are
// fetched from the registry and dropped in beside them. sharp resolves the platform
// package at require time, so having both present is fine — the NAS picks its own.
//
// Unlike better-sqlite3 these are plain npm tarballs rather than GitHub release assets,
// and there are TWO of them: the binding (`@img/sharp-<platform>`) and the image library it
// dlopens at runtime (`@img/sharp-libvips-<platform>`). Shipping the binding alone gets you
// `ERR_DLOPEN_FAILED: libvips-cpp.so...: cannot open shared object file` on first use — a
// runtime failure on the NAS, which is exactly what this script exists to prevent.
//
// The libvips version floats independently of sharp's, so it is read from the *arm64*
// binding's own `optionalDependencies` after download. Reading it from the installed win32
// binding does not work and was the original bug here: on Windows libvips is statically
// linked into the binding, so that package declares no libvips dependency at all, the
// lookup produced `undefined`, and the whole libvips step was silently skipped.
{
  const sharpVersion = JSON.parse(
    readFileSync(path.join(ROOT, "node_modules", "sharp", "package.json"), "utf8"),
  ).version;

  const outImg = path.join(OUT, "node_modules", "@img");
  mkdirSync(outImg, { recursive: true });

  /** Downloads one @img package into `dist-nas/node_modules/@img/<short>` and verifies it. */
  async function addImgPackage(pkg, version) {
    const short = pkg.replace("@img/", "");
    const url = `https://registry.npmjs.org/${pkg}/-/${short}-${version}.tgz`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `No ${TARGET} prebuild for ${pkg}@${version} (HTTP ${res.status}) at ${url}. ` +
          `Icon uploads would fail on the NAS. Check the version or pin sharp.`,
      );
    }
    const scratchDir = mkdtempSync(path.join(tmpdir(), "mhb-sharp-"));
    const tgz = path.join(scratchDir, `${short}.tgz`);
    writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
    // npm tarballs put everything under `package/`; --strip-components lands it flat.
    const dest = path.join(outImg, short);
    mkdirSync(dest, { recursive: true });
    // `cwd` + a RELATIVE tarball path, not `-C <abs>`. Git Bash's GNU tar reads a
    // `C:\...` argument to `-f` as a remote host spec and dies with
    // "Cannot connect to C: resolve failed"; `--force-local` does not save it either.
    // Running from the destination sidesteps the whole drive-letter question.
    execFileSync("tar", ["-xzf", path.relative(dest, tgz), "--strip-components", "1"], {
      cwd: dest,
    });
    rmSync(scratchDir, { recursive: true, force: true });

    // Prove it really is arm64 before shipping it, the same guarantee the
    // better-sqlite3 swap gives.
    let verified = 0;
    for (const file of walk(dest)) {
      const base = path.basename(file);
      if (base.endsWith(".node") || base.includes(".so")) {
        assertIsAarch64Elf(file, path.relative(OUT, file));
        verified += 1;
      }
    }
    console.log(`  added ${path.relative(OUT, dest)} (${version}, ${verified} AArch64 binaries)`);
    return { dest, verified };
  }

  const binding = await addImgPackage(`@img/sharp-${TARGET}`, sharpVersion);

  // The binding names the exact libvips build it dlopens. Read it from what we just
  // downloaded rather than guessing — 0.34.5's binding wants libvips 1.2.4, not the 1.2.3
  // a version-number guess would land on.
  const bindingManifest = JSON.parse(
    readFileSync(path.join(binding.dest, "package.json"), "utf8"),
  );
  const libvipsEntry = Object.entries({
    ...(bindingManifest.dependencies ?? {}),
    ...(bindingManifest.optionalDependencies ?? {}),
  }).find(([name]) => name.startsWith("@img/sharp-libvips-"));

  if (!libvipsEntry) {
    throw new Error(
      `@img/sharp-${TARGET}@${sharpVersion} declares no @img/sharp-libvips-* dependency, ` +
        `so this script cannot tell which libvips to ship. Inspect its package.json.`,
    );
  }

  const [libvipsPkg, libvipsRange] = libvipsEntry;
  const libvips = await addImgPackage(libvipsPkg, libvipsRange.replace(/^[^0-9]*/, ""));

  // Fatal rather than a warning: a binding with no libvips beside it fails at *runtime*,
  // on the first icon upload, long after the deploy looked successful.
  if (libvips.verified === 0) {
    throw new Error(
      `Shipped ${libvipsPkg} but found no .so inside it — sharp would fail to dlopen on the NAS.`,
    );
  }
}

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

step("Bundling the startup-message setter");
// Same reasoning as the migration runner: plain CJS so the NAS needs no tsx. It
// imports from src/lib/, so the `@/` path alias has to be resolved at bundle time.
await build({
  entryPoints: [path.join(ROOT, "scripts", "set-startup-message.ts")],
  outfile: path.join(OUT, "set-startup-message.cjs"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
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
console.log(`\nBuilt for Node ABI ${NODE_ABI} (${NODE_ABI === 127 ? "Node 22" : NODE_ABI === 115 ? "Node 20" : "unknown"}).`);
console.log("If the NAS crashes at startup with NODE_MODULE_VERSION, its Node was upgraded:");
console.log("  node -p process.versions.modules      # on the NAS -- the ABI it wants");
console.log("  NAS_NODE_ABI=<abi> npm run publish:nas");
console.log("\nOn the NAS:");
console.log("  node migrate.cjs               # apply any pending migrations");
console.log("  node server.js                 # start the app");
console.log("  node set-startup-message.cjs   # announce the deployment (start.sh does this)");

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
