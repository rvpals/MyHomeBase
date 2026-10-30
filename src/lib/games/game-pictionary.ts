import { pickWord } from "./pictionary-words";
import {
  PICTIONARY_BASE_POINTS,
  PICTIONARY_GUESSER_SHARE,
  PICTIONARY_MAX_NAME_LENGTH,
  PICTIONARY_MAX_PLAYERS,
  PICTIONARY_MIN_PLAYERS,
  PICTIONARY_SPEED_BONUS,
  PICTIONARY_TURN_SECONDS,
  type PictionaryPlayer,
  type PictionaryRound,
  type PictionaryState,
  type PictionaryTier,
  type PictionaryWord,
} from "./types";

/**
 * The rules of Pictionary, as pure functions over an immutable `PictionaryState`.
 *
 * Nothing here touches React, the DOM, a timer or `Math.random` directly — the RNG
 * arrives as an argument and the clock arrives as a `tick` call, exactly as in
 * `game-minesweeper.ts`. That is what lets a test play out a six-round session, award
 * points at a known number of seconds, and assert the totals without waiting.
 *
 * Every exported function returns a NEW state and never mutates its argument, so the
 * view can hold one in `useState` and React sees each entry as a change.
 *
 * **The drawing is not here.** Strokes are view state: they live in the canvas, never
 * enter this module, and are discarded when the turn ends. What a round leaves behind
 * is the word, who drew it, who got it and when — see `PictionaryRound`.
 */

/** A source of randomness in [0, 1). `Math.random` in the app; a stub in tests. */
export type Random = () => number;

/**
 * One roster entry as the view supplies it: just a typed name.
 *
 * Kept as an interface rather than collapsing to `string` so the view's setup screen and
 * this module agree on a shape, and so adding anything per-player later (a colour, a
 * handicap) does not change every call site.
 */
export interface PictionaryEntrant {
  name: string;
}

/**
 * Draws the next prompt, from `pool` when the session was given one.
 *
 * A session with no pool falls back to the built-in bank, which is what keeps this
 * module playable with no database behind it — a test, and the CLI, can start a session
 * without one. When a pool *is* supplied it is already the joined bank (built-in plus
 * imported, per `listPlayableWords`), so nothing here knows or cares which words were
 * imported.
 *
 * The exclusion and the recycling rule are `pickWord`'s for the built-in path; they are
 * repeated here for the pool path rather than generalised into `pickWord`, because that
 * function's contract is "a word from this tier of the bank" and a pool is not the bank.
 */
function drawFrom(
  pool: readonly PictionaryWord[] | undefined,
  tier: PictionaryTier,
  used: readonly string[],
  random: Random,
): PictionaryWord {
  if (!pool || pool.length === 0) return pickWord(tier, used, random);

  const unused = pool.filter((entry) => !used.includes(entry.word));
  const from = unused.length > 0 ? unused : pool;
  const index = Math.min(from.length - 1, Math.floor(random() * from.length));
  return from[index];
}

/**
 * A fresh session: a roster, a tier, a number of rounds, and the first prompt drawn.
 *
 * Throws on a roster that cannot play rather than returning a state that is quietly
 * broken. A one-player session has nobody to guess and an empty one has nobody at all;
 * both are programming errors the schema already rejects at the boundary, so by the
 * time a caller reaches here the only way to see one is a bug. Blank names are dropped
 * before counting, so three boxes with one left empty is a two-player session rather
 * than an error — that is what the setup screen actually produces.
 *
 * Starts in `handoff`, not `drawing` — the device has to reach the first drawer before
 * the word appears. See `PictionaryPhase`.
 *
 * `pool` is the words this session may draw from, already joined from the built-in bank
 * and whatever the household imported (`listPlayableWords` does that joining). Omitting
 * it plays from the built-in bank alone, which is what a test or the CLI wants — see
 * `drawFrom`.
 */
export function startGame(
  entrants: readonly PictionaryEntrant[],
  tier: PictionaryTier,
  totalRounds: number,
  random: Random,
  pool?: readonly PictionaryWord[],
): PictionaryState {
  const named = entrants
    .map((entrant) => ({ name: entrant.name.trim().replace(/\s+/g, " ") }))
    .filter((entrant) => entrant.name.length > 0);

  if (named.length < PICTIONARY_MIN_PLAYERS) {
    throw new Error(`Pictionary needs at least ${PICTIONARY_MIN_PLAYERS} named players.`);
  }
  if (named.length > PICTIONARY_MAX_PLAYERS) {
    throw new Error(`Pictionary takes at most ${PICTIONARY_MAX_PLAYERS} players.`);
  }
  if (named.some((entrant) => entrant.name.length > PICTIONARY_MAX_NAME_LENGTH)) {
    throw new Error(`A name can be at most ${PICTIONARY_MAX_NAME_LENGTH} characters.`);
  }

  // Names are the identity here, so two players cannot share one. Compared
  // case-insensitively: "sam" and "Sam" are one person at a table, and the judging
  // buttons would be indistinguishable.
  const unique = new Set(named.map((entrant) => entrant.name.toLowerCase()));
  if (unique.size !== named.length) {
    throw new Error("Each player needs a different name.");
  }

  const first = drawFrom(pool, tier, [], random);

  return {
    phase: "handoff",
    players: named.map((entrant) => ({ name: entrant.name, score: 0, turnsTaken: 0 })),
    drawerIndex: 0,
    tier,
    current: first,
    used: [first.word],
    secondsLeft: PICTIONARY_TURN_SECONDS[tier],
    rounds: [],
    totalRounds,
    pool,
  };
}

/** Whoever is drawing right now. */
export function currentDrawer(state: PictionaryState): PictionaryPlayer | undefined {
  return state.players[state.drawerIndex];
}

/** Everyone who is not drawing — the people who may guess this round. */
export function guessers(state: PictionaryState): readonly PictionaryPlayer[] {
  return state.players.filter((_, index) => index !== state.drawerIndex);
}

/**
 * The drawer has the device and has seen the word: start the clock.
 *
 * A no-op outside `handoff`, rather than a throw, because the view's "Start drawing"
 * button can be double-tapped on a phone and the second tap must not restart a turn
 * that is already running — that would hand back the seconds the drawer has used.
 */
export function beginTurn(state: PictionaryState): PictionaryState {
  if (state.phase !== "handoff") return state;
  return { ...state, phase: "drawing" };
}

/**
 * One second gone.
 *
 * Only `drawing` has a running clock, so every other phase returns unchanged — the
 * view can leave its interval running across a handoff without special-casing it.
 *
 * At zero the round ends itself as a miss and moves to `judging`, rather than sitting
 * at `drawing` with an expired clock waiting to be noticed. The round is recorded here
 * so that a session whose last clock runs out still reaches `summary` with a complete
 * list — see `endRound`.
 */
export function tick(state: PictionaryState): PictionaryState {
  if (state.phase !== "drawing") return state;

  const secondsLeft = state.secondsLeft - 1;
  if (secondsLeft > 0) return { ...state, secondsLeft };

  return { ...state, secondsLeft: 0, phase: "judging" };
}

/** How long one tick is, in milliseconds. The clock counts whole seconds. */
export function tickIntervalMs(): number {
  return 1000;
}

/**
 * The drawer stops early — someone in the room has shouted the right answer.
 *
 * Moves to `judging` with the clock frozen where it stands, because the seconds left
 * are what the speed bonus is paid on: stopping the clock *before* asking who got it is
 * what makes a fast guess worth more than a slow one.
 */
export function stopDrawing(state: PictionaryState): PictionaryState {
  if (state.phase !== "drawing") return state;
  return { ...state, phase: "judging" };
}

/**
 * What a round pays out, split between the guesser and the drawer.
 *
 * Both are paid because both did the work; the guesser takes the larger share since
 * they had to be right. Rounded so no one banks a fraction of a point, and the drawer
 * takes the remainder rather than its own rounding, so the two shares always add up to
 * `total` exactly — two independent `Math.round` calls would lose or invent a point.
 */
export function roundPoints(
  tier: PictionaryTier,
  secondsLeft: number,
): { total: number; guesser: number; drawer: number } {
  const total = PICTIONARY_BASE_POINTS[tier] + Math.max(0, secondsLeft) * PICTIONARY_SPEED_BONUS;
  const guesser = Math.round(total * PICTIONARY_GUESSER_SHARE);
  return { total, guesser, drawer: total - guesser };
}

/**
 * Close the current round and either deal the next one or finish the session.
 *
 * The one place a round is written into `rounds` and the turn passes on, so every way a
 * round can end routes through here: `awardRound`, `missRound` and `skipRound` each
 * decide the outcome and then call this. Keeping the bookkeeping in one function is why
 * a skipped round can't accidentally advance the drawer differently from a missed one.
 *
 * The next prompt is drawn now rather than at the start of the next turn, so that the
 * handoff screen can name the next drawer while the word is already settled and nothing
 * has to be computed behind a screen the guessers are looking at.
 */
function endRound(
  state: PictionaryState,
  round: PictionaryRound,
  players: readonly PictionaryPlayer[],
  random: Random,
): PictionaryState {
  const rounds = [...state.rounds, round];

  if (rounds.length >= state.totalRounds) {
    return { ...state, phase: "summary", players, rounds, current: undefined, secondsLeft: 0 };
  }

  const drawerIndex = (state.drawerIndex + 1) % state.players.length;
  const next = drawFrom(state.pool, state.tier, state.used, random);

  return {
    ...state,
    phase: "handoff",
    players,
    rounds,
    drawerIndex,
    current: next,
    used: [...state.used, next.word],
    secondsLeft: PICTIONARY_TURN_SECONDS[state.tier],
  };
}

/** `players` with one entry's score raised. Kept here so no caller mutates the array. */
function credit(
  players: readonly PictionaryPlayer[],
  name: string,
  points: number,
): readonly PictionaryPlayer[] {
  return players.map((player) =>
    player.name === name ? { ...player, score: player.score + points } : player,
  );
}

/** `players` with the drawer's turn counted. */
function countTurn(
  players: readonly PictionaryPlayer[],
  drawerIndex: number,
): readonly PictionaryPlayer[] {
  return players.map((player, index) =>
    index === drawerIndex ? { ...player, turnsTaken: player.turnsTaken + 1 } : player,
  );
}

/**
 * Credit a correct guess to `guesserName` and close the round.
 *
 * A no-op outside `judging`, and a no-op for a name that is not in the roster or is the
 * drawer themselves — the drawer cannot guess their own word, and a caller asking for
 * that has a bug rather than an intent. Returning the state unchanged rather than
 * throwing keeps a mis-wired button from taking down a session mid-round.
 */
export function awardRound(
  state: PictionaryState,
  guesserName: string,
  random: Random,
): PictionaryState {
  if (state.phase !== "judging" || !state.current) return state;

  const drawer = currentDrawer(state);
  if (!drawer || guesserName === drawer.name) return state;
  if (!state.players.some((player) => player.name === guesserName)) return state;

  const { guesser, drawer: drawerShare } = roundPoints(state.tier, state.secondsLeft);

  let players = credit(state.players, guesserName, guesser);
  players = credit(players, drawer.name, drawerShare);
  players = countTurn(players, state.drawerIndex);

  return endRound(
    state,
    {
      word: state.current.word,
      tier: state.current.tier,
      drawer: drawer.name,
      guesser: guesserName,
      outcome: "guessed",
      secondsLeft: state.secondsLeft,
    },
    players,
    random,
  );
}

/**
 * Nobody got it. Closes the round for zero, to whoever drew it.
 *
 * Callable from `judging` — which is where a run-out clock lands the session — and the
 * round still counts as a turn taken, because the drawer did draw.
 */
export function missRound(state: PictionaryState, random: Random): PictionaryState {
  if (state.phase !== "judging" || !state.current) return state;

  const drawer = currentDrawer(state);
  if (!drawer) return state;

  return endRound(
    state,
    {
      word: state.current.word,
      tier: state.current.tier,
      drawer: drawer.name,
      outcome: "missed",
      secondsLeft: 0,
    },
    countTurn(state.players, state.drawerIndex),
    random,
  );
}

/**
 * The drawer rejects the prompt before drawing it.
 *
 * Only from `handoff` — once the clock has run, the round is played out and ends as a
 * guess or a miss. A skip costs nobody points and does **not** count as a turn taken,
 * so the drawer still gets a real turn; it does consume the word, which is already in
 * `used` and so will not come back this session.
 */
export function skipRound(state: PictionaryState, random: Random): PictionaryState {
  if (state.phase !== "handoff" || !state.current) return state;

  const drawer = currentDrawer(state);
  if (!drawer) return state;

  return endRound(
    state,
    {
      word: state.current.word,
      tier: state.current.tier,
      drawer: drawer.name,
      outcome: "skipped",
      secondsLeft: 0,
    },
    state.players,
    random,
  );
}

/**
 * One player's score, by name.
 *
 * There is no `scoreGame` here, and deliberately no "final score" for a session either:
 * players are typed names, so a session's result is a table of people rather than one
 * number, and none of it is written to the shared board (see `PictionaryPlayer`). This
 * is the per-player read the summary screen uses; `standings` is the ordered form.
 *
 * Floored at 0, and 0 for a name nobody played under. Unlike the saved games, it does
 * NOT require a finished session: the summary is the only consumer and a mid-session
 * total is a legitimate thing to show, where a saved score had to refuse an abandoned
 * run to keep the board honest.
 */
export function scoreFor(state: PictionaryState, name: string): number {
  const player = state.players.find((entry) => entry.name === name);
  return Math.max(0, player?.score ?? 0);
}

/**
 * The session's standings, highest first.
 *
 * Ties break on fewer turns taken — a player who scored the same from fewer goes at the
 * pen did more with less. A stable order matters because the summary screen reads as a
 * result: two renders of the same finished session must not disagree about who won.
 */
export function standings(state: PictionaryState): readonly PictionaryPlayer[] {
  return [...state.players].sort(
    (a, b) => b.score - a.score || a.turnsTaken - b.turnsTaken || a.name.localeCompare(b.name),
  );
}

/** Which round is being played, 1-based, for a "Round 3 of 6" readout. */
export function roundNumber(state: PictionaryState): number {
  return Math.min(state.rounds.length + 1, state.totalRounds);
}
