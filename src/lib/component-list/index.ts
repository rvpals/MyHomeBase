// Public surface. Deliberately free of `node:fs` — the About view is a
// `"use client"` module and imports these types, so anything Node-only here
// would follow the barrel into the browser bundle. The concrete
// FileComponentListRepository is wired in wiring.ts instead.

export type { ComponentEntry, ComponentList } from "./types";
export type { ComponentListRepository } from "./ports";
export { getComponentList } from "./component-list";
