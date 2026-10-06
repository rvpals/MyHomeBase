// The seam between the toolbar use-cases and storage.

import type { Toolbar, ToolbarItem, ToolbarWithItems } from "./types";

/** One toolbar's editable properties, on the way in. */
export interface ToolbarWrite {
  name: string;
  backgroundColor?: string;
  borderColor?: string;
  textColor?: string;
  /** The library picture to draw behind the bar, or absent for none (0130). */
  textureId?: number;
  textureOpacity: number;
  edge: Toolbar["edge"];
  fullModeOnly: boolean;
  isVisible: boolean;
}

/** One row's editable properties, on the way in. */
export interface ToolbarItemWrite {
  kind: ToolbarItem["kind"];
  menuItemId?: string;
  label?: string;
}

export interface ToolbarRepository {
  /** Every toolbar with its rows, in arranged order. The screen's and the shell's read. */
  listToolbars(): ToolbarWithItems[];
  getToolbar(id: number): ToolbarWithItems | undefined;
  /** Creates one and returns it, so the caller gets the assigned id. */
  createToolbar(toolbar: ToolbarWrite): ToolbarWithItems;
  updateToolbar(id: number, toolbar: ToolbarWrite): void;
  /** Removes a toolbar and every row on it. */
  deleteToolbar(id: number): void;
  /** Appends a row to the end of a toolbar. */
  addItem(toolbarId: number, item: ToolbarItemWrite): ToolbarItem;
  updateItem(itemId: number, item: ToolbarItemWrite): void;
  removeItem(itemId: number): void;
  /**
   * Rewrites one toolbar's row order from a list of row ids.
   *
   * Takes the whole order rather than a move: reordering by swapping adjacent
   * `sort_order` values leaves gaps and ties that two concurrent edits can
   * interleave into an arbitrary arrangement.
   */
  setItemOrder(toolbarId: number, itemIds: number[]): void;
}
