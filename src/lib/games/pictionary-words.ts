import { PICTIONARY_TIERS, type PictionaryTier, type PictionaryWord } from "./types";

/**
 * The word bank for Pictionary, in code rather than in a table.
 *
 * Same reasoning as `GAME_CATALOGUE` in `catalogue.ts`: what the app *can* do is code,
 * only what the player *did* is data. A words table would let an admin insert a prompt
 * no one can draw, and would need a screen, a migration and a seed to say what shipping
 * a string literal says here.
 *
 * Unlike a game key, a word is **not** persisted — `gam_scores` records a score, never
 * the prompt — so this list can be rewritten freely. Add, remove and retier at will; no
 * player's history breaks.
 *
 * Each entry is a noun or a short noun phrase that can be drawn without letters,
 * numbers or arrows, because the one rule Pictionary has is that the drawer may not
 * write. Verbs and abstractions are deliberately rare and live in `hard`.
 */

/** Easy: concrete, compact, and drawable with four or five strokes. */
const EASY: readonly string[] = [
  "house",
  "sun",
  "tree",
  "fish",
  "cat",
  "dog",
  "star",
  "boat",
  "cup",
  "hat",
  "key",
  "book",
  "clock",
  "apple",
  "chair",
  "door",
  "ball",
  "car",
  "moon",
  "shoe",
  "spoon",
  "flower",
  "cloud",
  "egg",
  "ladder",
  "balloon",
  "candle",
  "umbrella",
  "snowman",
  "bridge",
  "pencil",
  "banana",
  "glasses",
  "mountain",
  "bed",
  "kite",
  "heart",
  "train",
  "bone",
  "hammer",
];

/** Medium: still an object or a scene, but it needs planning before the pen moves. */
const MEDIUM: readonly string[] = [
  "bicycle",
  "elephant",
  "guitar",
  "lighthouse",
  "octopus",
  "windmill",
  "telescope",
  "campfire",
  "waterfall",
  "dinosaur",
  "penguin",
  "sandcastle",
  "helicopter",
  "treasure chest",
  "rollercoaster",
  "microscope",
  "violin",
  "cactus",
  "jellyfish",
  "typewriter",
  "hot air balloon",
  "skateboard",
  "squirrel",
  "fireplace",
  "wheelbarrow",
  "pineapple",
  "submarine",
  "giraffe",
  "mailbox",
  "tent",
  "anchor",
  "beehive",
  "vending machine",
  "shopping cart",
  "piano",
  "scarecrow",
  "volcano",
  "igloo",
  "tractor",
  "chandelier",
];

/**
 * Hard: an idea rather than a thing, so the drawer has to find a picture for it.
 *
 * This is the tier where a drawer is allowed to be inventive — "gravity" has no agreed
 * drawing, which is the point. Kept to concepts a household will actually guess rather
 * than obscure nouns: the difficulty should come from needing a metaphor, not from the
 * guessers never having heard the word.
 */
const HARD: readonly string[] = [
  "gravity",
  "homesick",
  "recycling",
  "teamwork",
  "echo",
  "shadow",
  "whisper",
  "balance",
  "migration",
  "daydream",
  "traffic jam",
  "hiccup",
  "sunrise",
  "freedom",
  "jealousy",
  "gossip",
  "exhausted",
  "surprise party",
  "stage fright",
  "growing up",
  "time travel",
  "deja vu",
  "hibernation",
  "allergy",
  "camouflage",
  "invisible",
  "upside down",
  "overflowing",
  "frozen",
  "tangled",
  "sneeze",
  "argument",
  "celebration",
  "nightmare",
  "patience",
  "reflection",
  "stretch",
  "escape",
  "tickle",
  "silence",
];

/**
 * Every word, by tier.
 *
 * Exported as the whole map rather than three constants so a caller can iterate the
 * tiers generically — `PICTIONARY_TIERS` is the order, this is the content.
 */
export const PICTIONARY_WORDS: Readonly<Record<PictionaryTier, readonly string[]>> = {
  easy: EASY,
  medium: MEDIUM,
  hard: HARD,
};

/** Every word in the bank, across all tiers, as drawable prompts. */
export function allWords(): readonly PictionaryWord[] {
  return PICTIONARY_TIERS.flatMap((tier) =>
    PICTIONARY_WORDS[tier].map((word) => ({ word, tier })),
  );
}

/** The words in one tier, as prompts. */
export function wordsInTier(tier: PictionaryTier): readonly PictionaryWord[] {
  return PICTIONARY_WORDS[tier].map((word) => ({ word, tier }));
}

/**
 * How many words a tier holds. Used by the CLI to report the bank's size, and by the
 * tests to assert no tier was emptied by an edit.
 */
export function tierSize(tier: PictionaryTier): number {
  return PICTIONARY_WORDS[tier].length;
}

/**
 * A word drawn at random from `tier`, excluding anything in `used`.
 *
 * `used` is how a session avoids repeating a prompt it has already shown. When every
 * word in the tier has been used the exclusion is dropped rather than returning
 * `undefined` — a long session should start recycling prompts, not run out of game.
 * That decision is here rather than in the caller because "the bank is exhausted" is a
 * fact about the bank.
 *
 * `random` is injected for the reason it is in every other game here: a test needs to
 * pick a known word without stubbing `Math.random` globally.
 */
export function pickWord(
  tier: PictionaryTier,
  used: readonly string[],
  random: () => number,
): PictionaryWord {
  const pool = PICTIONARY_WORDS[tier];
  const unused = pool.filter((word) => !used.includes(word));
  const from = unused.length > 0 ? unused : pool;
  const index = Math.min(from.length - 1, Math.floor(random() * from.length));
  return { word: from[index], tier };
}
