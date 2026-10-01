/**
 * TODO Lists — the front door.
 *
 * Everything outside this folder imports from here and nowhere else (ARCHITECTURE.md →
 * *Modules*). `fakes.ts` is deliberately **not** re-exported: it exists for this
 * module's own tests, and exporting it would put an in-memory repository within reach of
 * production code.
 */

export type {
  CategoryDeleteResult,
  TodoBoard,
  TodoCategory,
  TodoCategoryBoard,
  TodoItem,
} from "./types";

export {
  CATEGORY_LIMIT,
  ITEMS_PER_CATEGORY_LIMIT,
  categoryNameSchema,
  createCategorySchema,
  createItemSchema,
  deleteCategorySchema,
  deleteItemSchema,
  itemNotesSchema,
  itemTitleSchema,
  listBoardSchema,
  renameCategorySchema,
  reorderCategoriesSchema,
  reorderItemsSchema,
  setItemDoneSchema,
  updateItemSchema,
} from "./schema";

export type {
  CreateCategoryInput,
  CreateItemInput,
  DeleteCategoryInput,
  DeleteItemInput,
  ListBoardInput,
  RenameCategoryInput,
  ReorderCategoriesInput,
  ReorderItemsInput,
  SetItemDoneInput,
  UpdateItemInput,
} from "./schema";

export type { TodoCategoryRepository, TodoItemRepository } from "./ports";

export {
  createCategory,
  deleteCategory,
  listCategories,
  renameCategory,
  reorderCategories,
} from "./categories";

export {
  buildTodoBoard,
  clearCompleted,
  createItem,
  deleteItem,
  reorderItems,
  setItemDone,
  splitItems,
  updateItem,
  type TodoDeps,
} from "./todo";

export { SqliteTodoCategoryRepository, SqliteTodoItemRepository } from "./repository";
