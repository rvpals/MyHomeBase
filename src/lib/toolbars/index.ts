// The public surface of the toolbars module. Import from here, never from a file
// inside this folder.

export type { ToolbarItemWrite, ToolbarRepository, ToolbarWrite } from "./ports";
export { SqliteToolbarRepository } from "./repository";
export {
  MAX_TOOLBAR_LABEL_LENGTH,
  MAX_TOOLBAR_NAME_LENGTH,
  toolbarItemSchema,
  toolbarSchema,
  type ToolbarInput,
  type ToolbarItemInput,
} from "./schema";
export {
  addToolbarItem,
  createToolbar,
  deleteToolbar,
  getToolbar,
  listToolbars,
  occupiedEdges,
  removeToolbarItem,
  reorderToolbarItems,
  resolveToolbar,
  resolveToolbarsFor,
  type ResolveToolbarOptions,
  updateToolbar,
  updateToolbarItem,
} from "./toolbars";
export {
  parseHiddenToolbars,
  serializeHiddenToolbars,
  setToolbarHidden,
  TOOLBARS_HIDDEN_PREFERENCE_KEY,
} from "./visibility";
export {
  isOrnamentalKind,
  isToolbarEdge,
  isToolbarItemKind,
  ORNAMENTAL_TOOLBAR_KINDS,
  TOOLBAR_EDGES,
  TOOLBAR_ITEM_KINDS,
  type ResolvedToolbar,
  type ResolvedToolbarItem,
  type ResolvedToolbarTexture,
  type Toolbar,
  type ToolbarEdge,
  type ToolbarItem,
  type ToolbarItemKind,
  type ToolbarWithItems,
} from "./types";
