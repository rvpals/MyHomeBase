// Grouping the reader's modules into the home screen's systems.
//
// Pure, and generic over the module shape: this takes whatever the caller has
// (the full `Module` row on the web, a slug and a name on the CLI) and only ever
// reads `slug`. That keeps the library free of any opinion about what a card
// looks like — the view decides that — and makes the function trivial to test.

import { HOME_SYSTEMS, type HomeSystem, type HomeSystemCard } from "./types";

/**
 * Clusters modules into systems, in registry order.
 *
 * Four rules, each of which exists because the alternative loses a module:
 *
 * - **Order inside a panel is the caller's**, not the registry's. The web app
 *   passes modules already sorted by `sequence` and already filtered by access,
 *   so an admin who reorders the modules reorders these rows too.
 * - **A slug claimed by two systems lands in the first** that claims it, so a
 *   copy-paste in the registry duplicates nothing on screen.
 * - **A slug no system claims lands in the catch-all.** New modules arrive
 *   without this file being edited, and a module missing from the home screen
 *   is invisible rather than merely misfiled. With no catch-all registered the
 *   unclaimed modules are dropped — asserted in the tests, so the shipped
 *   registry can't quietly lose one.
 * - **A system with nothing in it is left out.** Access is already applied by
 *   the caller, so an empty panel would be a heading for modules this reader
 *   cannot open.
 */
export function groupModulesBySystem<M extends { slug: string }>(
  modules: readonly M[],
  systems: readonly HomeSystem[] = HOME_SYSTEMS,
): HomeSystemCard<M>[] {
  const claimedBy = new Map<string, HomeSystem>();
  for (const system of systems) {
    for (const slug of system.slugs) {
      if (!claimedBy.has(slug)) claimedBy.set(slug, system);
    }
  }

  const catchAll = systems.find((system) => system.catchAll);
  const buckets = new Map<HomeSystem, M[]>(systems.map((system) => [system, []]));
  const seen = new Set<string>();

  for (const appModule of modules) {
    // A duplicate slug would otherwise draw the same module twice in one panel.
    if (seen.has(appModule.slug)) continue;
    seen.add(appModule.slug);

    const system = claimedBy.get(appModule.slug) ?? catchAll;
    if (!system) continue;
    buckets.get(system)?.push(appModule);
  }

  return systems
    .map((system) => ({ system, modules: buckets.get(system) ?? [] }))
    .filter((card) => card.modules.length > 0);
}
