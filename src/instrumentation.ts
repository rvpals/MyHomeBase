// The Next.js instrumentation hook. This file's NAME is the whole contract.
//
// Next discovers the hook by filename and nothing else: `next/dist/build/index.js`
// builds `^instrumentation\.(ts|tsx|js|jsx)$` from `INSTRUMENTATION_HOOK_FILENAME`
// ('instrumentation', constants.js:291) and matches it only in the directory that
// holds `app/` -- here, `src/`. There is no config flag and no alternative name;
// the hook became stable in Next 15 and `experimental.instrumentationHook` is
// obsolete.
//
// THIS MATTERS BECAUSE IT SILENTLY BROKE ONCE. From 2026-08-26 (commit 473f2e3)
// this file was named `instrumentation-node.ts`, on the belief that the `-node`
// suffix was what scoped it to the Node runtime. It is not a name Next looks for,
// so `register()` was never called, every background job was silently never armed,
// and nothing logged a word about it -- a missing hook is not an error. Six weeks
// of "the scheduler is armed" on the admin screen meant only "the switch is on".
// Do not rename this file. If it must move, it moves to the repo root, not to a
// new name.
//
// The real runtime scoping is the `NEXT_RUNTIME` guard below, which is the
// documented pattern: Next calls `register()` in EVERY environment, so anything
// that cannot run on Edge has to be behind both the check and a dynamic import.

export async function register() {
  // Node only. The work lives in `./instrumentation-node`, which reaches for
  // better-sqlite3, node:fs and node:crypto -- none of which exist on Edge.
  //
  // Both halves are load-bearing. The `await import()` keeps the module out of any
  // graph this check excludes, and the check keeps it from executing where it would
  // throw. A static import at the top of this file would be pulled into every
  // runtime's graph regardless of the guard.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
