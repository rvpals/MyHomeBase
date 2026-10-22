// Public surface. Deliberately free of `node:fs` — the About view is a
// `"use client"` module and imports these types, so anything Node-only here
// would follow the barrel into the browser bundle. The concrete
// FileFeatureListRepository is wired in wiring.ts instead.

export type { FeatureList } from "./types";
export type { FeatureListRepository } from "./ports";
export { getFeatureList } from "./feature-list";
