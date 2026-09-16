export {
  getScratchpad,
  listNotes,
  createNote,
  saveNote,
  deleteNote,
  noteLabel,
  resolveActiveCategoryId,
} from "./scratchpad";
export {
  listCategories,
  createCategory,
  renameCategory,
  reorderCategories,
  deleteCategory,
  describeDeleteRefusal,
} from "./categories";
export { noteToTextFile, categoryToTextFile } from "./export";
export type { NoteCategoryRepository, ScratchpadRepository } from "./ports";
export {
  NOTES_PER_CATEGORY_LIMIT,
  CATEGORY_LIMIT,
  NOTE_BODY_LIMIT,
  categoryNameSchema,
  createCategorySchema,
  renameCategorySchema,
  reorderCategoriesSchema,
  deleteCategorySchema,
  noteTitleSchema,
  noteBodySchema,
  createNoteSchema,
  saveNoteSchema,
  deleteNoteSchema,
  listNotesSchema,
  type CreateCategoryInput,
  type RenameCategoryInput,
  type ReorderCategoriesInput,
  type DeleteCategoryInput,
  type CreateNoteInput,
  type SaveNoteInput,
  type DeleteNoteInput,
  type ListNotesInput,
} from "./schema";
export {
  SqliteNoteCategoryRepository,
  SqliteScratchpadRepository,
} from "./repository";
export type {
  Note,
  NoteCategory,
  NoteTextFile,
  ScratchpadSnapshot,
  CategoryDeleteRefusal,
  CategoryDeleteResult,
} from "./types";
