// The navigation tree — the app's whole navigation as data.
//
// The barrel every consumer imports from, so `@/lib/navigation` is the one path
// that appears in a shell or a component. Same shape as `src/lib/floating/index.ts`.

export { parseExpandedModules, resolveInitialExpanded, serializeExpandedModules, toggleExpandedModule } from "./collapse";
export { filterTree, groupHitsByModule, type FilterHit } from "./filter";
export type { SectionSource } from "./ports";
export {
  buildNavigationTree,
  findActiveModule,
  findActiveSection,
  flattenTree,
  HOME_SECTION,
  type NavigationModuleInput,
} from "./tree";
export type { NavigationTree, TreeModule, TreeSection } from "./types";
