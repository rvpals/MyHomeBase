// Deliberately does NOT re-export `SqliteCardFrameRepository`.
//
// The admin control is a client component and imports `MAX_CARD_FRAME_BYTES`
// and the settings type from here. Re-exporting the concrete repository would
// pull `better-sqlite3` into the browser bundle through that import — the same
// reason `src/lib/module-texture/index.ts` withholds its own. `wiring.ts`
// imports the class from `./card-frame/repository` directly.

export type {
  CardFrame,
  CardFrameFill,
  CardFrameInsets,
  CardFrameSelection,
  CardFrameSettings,
} from "./types";
export type { CardFrameRepository } from "./ports";
export {
  MAX_CARD_FRAME_SLICE,
  cardFrameInsetsSchema,
  cardFrameNameSchema,
  cardFrameSettingsSchema,
} from "./schema";
export type { CardFrameSettingsInput } from "./schema";
export {
  MAX_CARD_FRAMES,
  MAX_CARD_FRAME_BYTES,
  addCardFrame,
  cardFrameVars,
  deleteCardFrame,
  getCardFrameById,
  getCardFrameImage,
  getCardFrameSelection,
  listCardFrames,
  renameCardFrame,
  replaceCardFrameImage,
  saveCardFrameSettings,
  selectCardFrame,
} from "./card-frame";
