// Remembering which cards a reader left open.
//
// The barrel every consumer imports from, so `@/lib/collapsible-state` is the
// one path that appears in a component. Same shape as
// `src/lib/user-shortcuts/index.ts`.

export {
  cardStateStorageKey,
  parseCardStates,
  resolveCardOpen,
  withCardState,
  type StoredCardStates,
} from "./collapsible-state";
