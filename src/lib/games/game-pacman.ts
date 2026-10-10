import {
  BAZOOKA_GHOST_POINTS,
  BAZOOKA_MIN_SPAWN_DISTANCE,
  BAZOOKA_SPAWN_TICKS,
  BAZOOKA_TTL_TICKS,
  GHOST_HOUSE_DOOR,
  GHOST_NAMES,
  GHOST_PEN_TICKS,
  GHOST_SCATTER_CORNERS,
  GHOST_STARTS,
  PACMAN_COLS,
  PACMAN_EXTRA_LIFE_AT,
  PACMAN_FRIGHTENED_TICKS,
  PACMAN_GHOST_POINTS,
  PACMAN_LIVES,
  PACMAN_MAZE,
  PACMAN_PELLET_POINTS,
  PACMAN_PHASES,
  PACMAN_POWER_POINTS,
  PACMAN_ROWS,
  PACMAN_START,
  PROJECTILE_SPEED,
  type Bazooka,
  type Ghost,
  type GhostMode,
  type GhostName,
  type PacmanDirection,
  type PacmanPoint,
  type PacmanState,
  type PacmanTile,
  type Projectile,
} from "./types";

/**
 * The rules of Pac-Man, as pure functions over an immutable `PacmanState`.
 *
 * Nothing here touches React, the DOM, a timer or `Math.random` directly. The clock
 * is `tick(state, random)` — a function the view calls on an interval, not a loop
 * this module owns — and the RNG arrives as an argument. That is the same trade
 * `game-tetris.ts` makes, and it is what lets a test drive a ghost across the maze
 * and assert where it went without waiting on a real clock or a real `Math.random`.
 *
 * Every exported function returns a NEW state and never mutates its argument, so the
 * view can hold one in `useState` and React sees each move as a change.
 *
 * **Movement is tile-by-tile, not pixel-by-pixel.** The arcade moves sprites in
 * fractions of a tile and resolves turns on tile boundaries; this moves a whole tile
 * per tick and interpolates nothing. That choice costs the sliding look and buys a
 * state that is exactly comparable between ticks — which is what makes the ghost
 * targeting, the collision rule and the turn buffer testable as plain data. The view
 * adds a CSS transition between positions, so what the player sees still glides.
 */

/** A source of randomness in [0, 1). `Math.random` in the app; a stub in tests. */
export type Random = () => number;

/** The four real directions, in the arcade's own tie-break order. See `stepGhost`. */
const MOVES: readonly { direction: PacmanDirection; dr: number; dc: number }[] = [
  { direction: "up", dr: -1, dc: 0 },
  { direction: "left", dr: 0, dc: -1 },
  { direction: "down", dr: 1, dc: 0 },
  { direction: "right", dr: 0, dc: 1 },
];

/** The flat-array index of a tile. Callers must range-check the row first. */
function indexOf(row: number, col: number): number {
  return row * PACMAN_COLS + col;
}

/** The direction that undoes `direction`, used to forbid a ghost reversing. */
function opposite(direction: PacmanDirection): PacmanDirection {
  switch (direction) {
    case "up":
      return "down";
    case "down":
      return "up";
    case "left":
      return "right";
    case "right":
      return "left";
    default:
      return "none";
  }
}

/**
 * The tile reached by moving one step, with the side tunnels wrapped.
 *
 * Wrapping is horizontal only: walking off the left edge arrives at the right. There
 * is no vertical wrap, because the maze's top and bottom rows are solid wall — adding
 * one would be inventing a passage the picture does not show.
 *
 * Returns `undefined` for a step off the top or bottom, which every caller treats as
 * a wall. That is also what keeps a ghost aiming at an out-of-bounds scatter corner
 * (see `GHOST_SCATTER_CORNERS`) from walking out of the maze to reach it.
 */
export function stepFrom(
  point: PacmanPoint,
  direction: PacmanDirection,
): PacmanPoint | undefined {
  const move = MOVES.find((entry) => entry.direction === direction);
  if (!move) return undefined;

  const row = point.row + move.dr;
  if (row < 0 || row >= PACMAN_ROWS) return undefined;

  let col = point.col + move.dc;
  if (col < 0) col = PACMAN_COLS - 1;
  if (col >= PACMAN_COLS) col = 0;

  return { row, col };
}

/** The static maze tile at a position, read straight from the picture. */
export function mazeTileAt(row: number, col: number): PacmanTile {
  if (row < 0 || row >= PACMAN_ROWS || col < 0 || col >= PACMAN_COLS) return "wall";
  switch (PACMAN_MAZE[row][col]) {
    case "#":
      return "wall";
    case ".":
      return "pellet";
    case "o":
      return "power";
    case "-":
      return "door";
    default:
      return "empty";
  }
}

/**
 * Whether a tile can be entered, by whom.
 *
 * The ghost-house door is the only asymmetric tile in the maze: a ghost passes
 * through it and Pac-Man never can. Expressing that as one `who` argument rather than
 * two near-identical predicates keeps the rule in a single place — the alternative
 * drifts the moment one of them is updated.
 */
export function canEnter(row: number, col: number, who: "pacman" | "ghost"): boolean {
  const tile = mazeTileAt(row, col);
  if (tile === "wall") return false;
  if (tile === "door") return who === "ghost";
  return true;
}

/** The pellets layer for a fresh board: the maze's own pellets, walls copied in. */
export function freshPellets(): readonly PacmanTile[] {
  const out: PacmanTile[] = new Array(PACMAN_ROWS * PACMAN_COLS);
  for (let row = 0; row < PACMAN_ROWS; row += 1) {
    for (let col = 0; col < PACMAN_COLS; col += 1) {
      out[indexOf(row, col)] = mazeTileAt(row, col);
    }
  }
  return out;
}

/** How many pellets (plain and power) a fresh board holds. */
export function countPellets(pellets: readonly PacmanTile[]): number {
  return pellets.filter((tile) => tile === "pellet" || tile === "power").length;
}

/** The four ghosts at their start positions, penned on the arcade's stagger. */
function freshGhosts(): readonly Ghost[] {
  return GHOST_NAMES.map((name) => ({
    name,
    row: GHOST_STARTS[name].row,
    col: GHOST_STARTS[name].col,
    // Blinky starts outside the house already moving; the penned three have no
    // direction worth claiming until they are released.
    direction: name === "blinky" ? "left" : "up",
    mode: "scatter" as GhostMode,
    penTicks: GHOST_PEN_TICKS[name],
  }));
}

/**
 * A new game: a full board, three lives, nothing eaten.
 *
 * Takes no RNG, unlike every other `startGame` in this module — a Pac-Man board is
 * fully determined, with no shuffled deck, no random mine and no dealt tile. The
 * randomness in this game arrives later and only in one place: a frightened ghost's
 * choice at a junction.
 */
export function startGame(): PacmanState {
  const pellets = freshPellets();
  return {
    pellets,
    pacman: { ...PACMAN_START },
    // Still, not moving. The arcade starts Pac-Man facing left and gliding; starting
    // him stopped means the first thing that happens is the thing the player asked
    // for, which matters more here than the flourish does.
    direction: "none",
    queued: "none",
    ghosts: freshGhosts(),
    score: 0,
    lives: PACMAN_LIVES,
    level: 1,
    pelletsLeft: countPellets(pellets),
    frightenedTicks: 0,
    ghostsEatenThisPower: 0,
    phaseTicks: 0,
    moves: 0,
    extraLifeAwarded: false,
    outcome: undefined,
    dying: false,
    // No bazooka on the board at the start of a run, and the first one is a few
    // seconds away: dropping one at tick zero would make the opening about the
    // pickup rather than about learning where the ghosts are.
    bazooka: undefined,
    bazookaCooldown: BAZOOKA_SPAWN_TICKS,
    ammo: 0,
    projectile: undefined,
    shotGhost: undefined,
    collectedBazooka: false,
  };
}

/**
 * Records the player's intent. Always accepted, even when the turn is illegal.
 *
 * The request is *queued* rather than tested, which is the whole point — see
 * `PacmanState.queued`. A turn that cannot be taken now is held and applied on the
 * first tick it becomes legal, so pressing Up a moment early still turns the corner.
 */
export function queueDirection(state: PacmanState, direction: PacmanDirection): PacmanState {
  if (state.outcome || direction === "none") return state;
  if (state.queued === direction) return state;
  return { ...state, queued: direction };
}

/**
 * How long a power pellet lasts at a given level.
 *
 * Shortens as the boards go up and floors at a tenth of a second's worth rather than
 * at zero: a pellet that frightens nobody would make the four power pellets on a late
 * board worth 50 points and nothing else, which reads as a bug rather than as
 * difficulty.
 */
export function frightenedTicksFor(level: number): number {
  return Math.max(10, PACMAN_FRIGHTENED_TICKS - (level - 1) * 6);
}

/**
 * Which phase — scatter or chase — the ghosts are in, `phaseTicks` into a life.
 *
 * Walks `PACMAN_PHASES` rather than indexing it, because the entries have different
 * lengths and the last is infinite. The loop is at most six iterations.
 */
export function phaseAt(phaseTicks: number): "scatter" | "chase" {
  let remaining = phaseTicks;
  for (const phase of PACMAN_PHASES) {
    if (remaining < phase.ticks) return phase.mode;
    remaining -= phase.ticks;
  }
  // Unreachable: the final phase is infinite. Returned rather than thrown so a
  // corrupted tick count degrades to the harder mode instead of crashing a run.
  return "chase";
}

/**
 * The tile a ghost is currently steering toward.
 *
 * **This function is the game.** Four ghosts that all chase Pac-Man directly would be
 * one ghost drawn four times, and the maze would be unplayable — they would arrive as
 * a pack from one direction. The arcade's four rules make them behave like a team
 * that is flanking you, which is an illusion produced entirely by the targets below.
 *
 *   - **Blinky** targets Pac-Man's tile. The pursuer; the pressure.
 *   - **Pinky** targets four tiles *ahead* of Pac-Man. The ambusher — she aims where
 *     you are going, which is why running in a straight line away from her fails.
 *   - **Inky** takes the vector from Blinky to two tiles ahead of Pac-Man and doubles
 *     it. The strangest rule in the game, and the one that makes him unpredictable:
 *     his target depends on where *Blinky* is, so he is dangerous exactly when Blinky
 *     has you cornered.
 *   - **Clyde** chases like Blinky until he is within eight tiles, then breaks for his
 *     corner. The coward — which in practice means he guards the bottom left.
 *
 * Scatter sends each to its own corner (see `GHOST_SCATTER_CORNERS`), and an eaten
 * ghost aims for the house door regardless of mode.
 *
 * The original's overflow bug in Pinky's and Inky's "ahead" calculation — where
 * facing up also shifted the target left — is deliberately NOT reproduced. It is a
 * famous artefact of 8-bit arithmetic rather than a design decision, and a player
 * here would only experience it as the ghosts occasionally aiming at nothing.
 */
export function ghostTarget(
  ghost: Ghost,
  state: PacmanState,
  phase: "scatter" | "chase",
): PacmanPoint {
  if (ghost.mode === "eaten") return GHOST_HOUSE_DOOR;
  if (ghost.mode === "frightened") return GHOST_SCATTER_CORNERS[ghost.name];
  if (phase === "scatter") return GHOST_SCATTER_CORNERS[ghost.name];

  const pac = state.pacman;

  switch (ghost.name) {
    case "blinky":
      return { ...pac };

    case "pinky":
      return ahead(pac, state.direction, 4);

    case "inky": {
      const blinky = state.ghosts.find((entry) => entry.name === "blinky");
      const pivot = ahead(pac, state.direction, 2);
      if (!blinky) return pivot;
      return {
        row: pivot.row * 2 - blinky.row,
        col: pivot.col * 2 - blinky.col,
      };
    }

    case "clyde": {
      // Straight-line distance, not the maze distance — the arcade compares squared
      // euclidean distance and so does this. A path-aware measure would make Clyde
      // cleverer than the game he comes from.
      const far = squaredDistance(ghost, pac) > 64;
      return far ? { ...pac } : GHOST_SCATTER_CORNERS.clyde;
    }
  }
}

/** The tile `count` steps ahead of a point in a direction, clamped to nothing. */
function ahead(point: PacmanPoint, direction: PacmanDirection, count: number): PacmanPoint {
  const move = MOVES.find((entry) => entry.direction === direction);
  if (!move) return { ...point };
  return { row: point.row + move.dr * count, col: point.col + move.dc * count };
}

/** Squared euclidean distance. Squared because only the comparison matters. */
function squaredDistance(a: { row: number; col: number }, b: PacmanPoint): number {
  const dr = a.row - b.row;
  const dc = a.col - b.col;
  return dr * dr + dc * dc;
}

/**
 * One ghost, advanced one tile.
 *
 * The movement rule every ghost shares, and it is deliberately simple: a ghost may
 * not reverse, so at each tile it picks whichever of the remaining exits leaves it
 * closest to its target. All the apparent intelligence comes from `ghostTarget`; this
 * is only the greedy step that serves it.
 *
 * Two details carry real weight:
 *
 *   - **No reversing.** Without it a ghost oscillates between two tiles whenever its
 *     target sits behind it, and the maze fills with twitching. The exception is a
 *     dead end, where reversing is the only legal move and refusing it would freeze
 *     the ghost permanently.
 *   - **The tie-break order** is up, left, down, right — the arcade's own, and the
 *     reason its ghosts favour the top-left when two routes are equally good. An
 *     arbitrary order here would produce subtly different, less familiar pathing.
 *
 * A frightened ghost ignores the target entirely and picks at random, which is what
 * makes a power pellet a genuine reprieve rather than a slower chase.
 */
export function stepGhost(ghost: Ghost, state: PacmanState, random: Random): Ghost {
  // Still penned: count down and stay put. Released ghosts step out through the door,
  // which `canEnter` allows them and never allows Pac-Man.
  if (ghost.penTicks > 0) {
    return { ...ghost, penTicks: ghost.penTicks - 1 };
  }

  const phase = phaseAt(state.phaseTicks);
  const target = ghostTarget(ghost, state, phase);
  const back = opposite(ghost.direction);

  const options = MOVES.map((move) => {
    const next = stepFrom(ghost, move.direction);
    if (!next) return undefined;
    if (!canEnter(next.row, next.col, "ghost")) return undefined;
    return { direction: move.direction, next };
  }).filter((option): option is { direction: PacmanDirection; next: PacmanPoint } => !!option);

  // A dead end: reversing is the only move, so it is allowed. Filtering first and
  // falling back keeps the no-reversing rule the default rather than a special case.
  const forward = options.filter((option) => option.direction !== back);
  const usable = forward.length > 0 ? forward : options;
  if (usable.length === 0) return ghost;

  const chosen =
    ghost.mode === "frightened"
      ? usable[Math.min(usable.length - 1, Math.floor(random() * usable.length))]
      : usable.reduce((best, option) =>
          squaredDistance(option.next, target) < squaredDistance(best.next, target)
            ? option
            : best,
        );

  return { ...ghost, row: chosen.next.row, col: chosen.next.col, direction: chosen.direction };
}

/**
 * Whether a ghost and Pac-Man are touching.
 *
 * Same tile, or a swap — the two passing *through* each other in opposite directions
 * between ticks. The swap test is what tile-stepped movement makes necessary: without
 * it, a head-on meeting on adjacent tiles trades places and both walk away, which is
 * the single most obvious way a grid Pac-Man feels wrong.
 */
export function collides(
  ghostBefore: { row: number; col: number },
  ghostAfter: { row: number; col: number },
  pacBefore: PacmanPoint,
  pacAfter: PacmanPoint,
): boolean {
  const sameTile = ghostAfter.row === pacAfter.row && ghostAfter.col === pacAfter.col;
  const swapped =
    ghostAfter.row === pacBefore.row &&
    ghostAfter.col === pacBefore.col &&
    pacAfter.row === ghostBefore.row &&
    pacAfter.col === ghostBefore.col;
  return sameTile || swapped;
}

/**
 * The state after losing one life: everybody back to their start, board untouched.
 *
 * The pellets deliberately survive — a life costs you position, not progress, which
 * is the arcade's rule and the reason a board is winnable at all. The phase schedule
 * restarts, so each life opens on the same scatter reprieve.
 */
export function loseLife(state: PacmanState): PacmanState {
  const lives = state.lives - 1;
  if (lives <= 0) {
    return { ...state, lives: 0, outcome: "caught", dying: true };
  }

  return {
    ...state,
    lives,
    pacman: { ...PACMAN_START },
    direction: "none",
    queued: "none",
    ghosts: freshGhosts(),
    frightenedTicks: 0,
    ghostsEatenThisPower: 0,
    phaseTicks: 0,
    dying: true,
    // The weapon dies with the life. Carrying a loaded bazooka through a death would
    // make *when* you collect it free, and the timing is the whole decision.
    bazooka: undefined,
    bazookaCooldown: BAZOOKA_SPAWN_TICKS,
    ammo: 0,
    projectile: undefined,
    shotGhost: undefined,
    collectedBazooka: false,
  };
}

/**
 * The state after clearing a board: a fresh maze, one level up, score and lives kept.
 *
 * There is no end: the levels keep coming and only get faster, as the arcade does.
 * A run therefore always ends by being caught, which is why `PacmanOutcome` has the
 * single value it has.
 */
export function nextLevel(state: PacmanState): PacmanState {
  const pellets = freshPellets();
  return {
    ...state,
    pellets,
    pelletsLeft: countPellets(pellets),
    pacman: { ...PACMAN_START },
    direction: "none",
    queued: "none",
    ghosts: freshGhosts(),
    level: state.level + 1,
    frightenedTicks: 0,
    ghostsEatenThisPower: 0,
    phaseTicks: 0,
    dying: false,
    bazooka: undefined,
    bazookaCooldown: BAZOOKA_SPAWN_TICKS,
    ammo: 0,
    projectile: undefined,
    shotGhost: undefined,
    collectedBazooka: false,
  };
}

/**
 * One tick: Pac-Man moves, he eats, the ghosts move, and collisions resolve.
 *
 * The order matters and is the arcade's. Collisions are tested **twice** — once after
 * Pac-Man moves and again after the ghosts do — because a ghost walking onto him and
 * him walking onto a ghost are both catches, and testing only at the end of the tick
 * misses the first. That is also why `collides` takes both before and after
 * positions: between two ticks the pair can pass straight through each other.
 */
export function tick(state: PacmanState, random: Random): PacmanState {
  if (state.outcome) return state;

  // `dying`, `shotGhost` and `collectedBazooka` each live for exactly one tick.
  // Clearing them here rather than in the view keeps their lifetime a rule rather
  // than a timing coincidence.
  let next: PacmanState = {
    ...state,
    dying: false,
    shotGhost: undefined,
    collectedBazooka: false,
    phaseTicks: state.phaseTicks + 1,
  };

  /* --- Pac-Man moves ---------------------------------------------------------- */

  const pacBefore = next.pacman;

  // The queued turn wins whenever it is legal; otherwise he carries on. This is the
  // whole of the turn buffer described on `PacmanState.queued`.
  const queuedStep = stepFrom(pacBefore, next.queued);
  const canTurn = !!queuedStep && canEnter(queuedStep.row, queuedStep.col, "pacman");

  const direction = canTurn ? next.queued : next.direction;
  const step = canTurn ? queuedStep : stepFrom(pacBefore, direction);
  const canGo = !!step && canEnter(step.row, step.col, "pacman");

  const pacAfter = canGo && step ? step : pacBefore;

  next = {
    ...next,
    pacman: pacAfter,
    // Facing is kept even when blocked, so a Pac-Man pressed into a wall still points
    // the way the player is holding rather than snapping back.
    direction: canGo ? direction : "none",
    // A consumed turn is cleared; an impossible one is held for the next tick.
    queued: canTurn ? "none" : next.queued,
    moves: canGo ? next.moves + 1 : next.moves,
  };

  /* --- He eats ---------------------------------------------------------------- */

  const at = indexOf(pacAfter.row, pacAfter.col);
  const tile = next.pellets[at];

  if (tile === "pellet" || tile === "power") {
    const pellets = [...next.pellets];
    pellets[at] = "empty";

    const power = tile === "power";
    next = {
      ...next,
      pellets,
      pelletsLeft: next.pelletsLeft - 1,
      score: next.score + (power ? PACMAN_POWER_POINTS : PACMAN_PELLET_POINTS),
      frightenedTicks: power ? frightenedTicksFor(next.level) : next.frightenedTicks,
      ghostsEatenThisPower: power ? 0 : next.ghostsEatenThisPower,
      // Every ghost still hunting turns and flees. An eaten one — a pair of eyes on
      // its way home — is deliberately untouched: it is not catchable and reviving it
      // as frightened would hand the player a free second helping.
      ghosts: power
        ? next.ghosts.map((ghost) =>
            ghost.mode === "eaten"
              ? ghost
              : { ...ghost, mode: "frightened" as GhostMode, direction: opposite(ghost.direction) },
          )
        : next.ghosts,
    };
  }

  /* --- He picks up the bazooka ------------------------------------------------ */

  // After the pellet, because both resolve on the tile he just entered and a bazooka
  // may sit on a pellet — walking that tile should score the pellet *and* arm him.
  next = collectBazooka(next);

  /* --- The frightened clock runs down ----------------------------------------- */

  if (next.frightenedTicks > 0) {
    const remaining = next.frightenedTicks - 1;
    next = {
      ...next,
      frightenedTicks: remaining,
      ghosts:
        remaining === 0
          ? next.ghosts.map((ghost) =>
              ghost.mode === "frightened" ? { ...ghost, mode: "scatter" as GhostMode } : ghost,
            )
          : next.ghosts,
    };
  }

  // The mode every non-frightened, non-eaten ghost should be in this tick. Applied
  // before they move so a phase change takes effect on the same tick it happens.
  const phase = phaseAt(next.phaseTicks);
  next = {
    ...next,
    ghosts: next.ghosts.map((ghost) =>
      ghost.mode === "frightened" || ghost.mode === "eaten" ? ghost : { ...ghost, mode: phase },
    ),
  };

  /* --- Collisions, first pass: he walked into them ---------------------------- */

  const firstPass = resolveCollisions(next, next.ghosts, pacBefore, pacAfter);
  if (firstPass.caught) return loseLife(firstPass.state);
  next = firstPass.state;

  /* --- The ghosts move -------------------------------------------------------- */

  const before = next.ghosts;
  const moved = before.map((ghost) => stepGhost(ghost, next, random));

  // An eaten ghost that has reached the door is reborn there, hunting again.
  const revived = moved.map((ghost) =>
    ghost.mode === "eaten" &&
    ghost.row === GHOST_HOUSE_DOOR.row &&
    ghost.col === GHOST_HOUSE_DOOR.col
      ? { ...ghost, mode: phase }
      : ghost,
  );

  next = { ...next, ghosts: revived };

  /* --- Collisions, second pass: they walked into him -------------------------- */

  const secondPass = resolveCollisions(next, before, pacAfter, pacAfter);
  if (secondPass.caught) return loseLife(secondPass.state);
  next = secondPass.state;

  /* --- The shell flies -------------------------------------------------------- */

  // After the ghosts have moved, so a shell resolves against where they actually are
  // at the end of the tick rather than where they were at the start. Firing into the
  // tile a ghost is about to vacate should miss, which is what this ordering gives.
  if (next.projectile) {
    const flight = stepProjectile(next);
    next = { ...next, projectile: flight.projectile };

    if (flight.hit) {
      const name = flight.hit;
      next = {
        ...next,
        // The existing `eaten` mode, deliberately: the eyes drift home and the ghost
        // revives on the normal schedule, so the bazooka reuses machinery that is
        // already correct instead of inventing a second respawn path.
        ghosts: next.ghosts.map((ghost) =>
          ghost.name === name ? { ...ghost, mode: "eaten" as GhostMode } : ghost,
        ),
        // Flat, and NOT via `ghostsEatenThisPower` — a shot must not advance the
        // power-pellet ladder. See `BAZOOKA_GHOST_POINTS`.
        score: next.score + BAZOOKA_GHOST_POINTS,
        shotGhost: name,
      };
    }
  }

  /* --- The bazooka spawner ----------------------------------------------------- */

  if (next.bazooka) {
    // Ages the pickup on the board, and removes it when nobody came for it.
    const ttl = next.bazooka.ttl - 1;
    next =
      ttl <= 0
        ? { ...next, bazooka: undefined, bazookaCooldown: BAZOOKA_SPAWN_TICKS }
        : { ...next, bazooka: { ...next.bazooka, ttl } };
  } else if (next.bazookaCooldown > 0) {
    next = { ...next, bazookaCooldown: next.bazookaCooldown - 1 };
  } else {
    // `spawnBazooka` can decline (no suitable tile this tick). The cooldown stays at
    // zero so it simply tries again next tick rather than waiting another full cycle.
    const spawned = spawnBazooka(next, random);
    if (spawned) next = { ...next, bazooka: spawned };
  }

  /* --- Awards and the board ---------------------------------------------------- */

  if (!next.extraLifeAwarded && next.score >= PACMAN_EXTRA_LIFE_AT) {
    next = { ...next, lives: next.lives + 1, extraLifeAwarded: true };
  }

  if (next.pelletsLeft <= 0) return nextLevel(next);

  return next;
}

/**
 * Settles every ghost against Pac-Man, eating the frightened and reporting a catch.
 *
 * Shared by both collision passes in `tick` rather than written twice — the two
 * differ only in which positions they compare, which is what the arguments carry.
 * Returns a flag rather than calling `loseLife` itself so the caller keeps control of
 * the order: a catch must stop the tick, not merely be recorded in it.
 */
function resolveCollisions(
  state: PacmanState,
  ghostsBefore: readonly Ghost[],
  pacBefore: PacmanPoint,
  pacAfter: PacmanPoint,
): { state: PacmanState; caught: boolean } {
  let score = state.score;
  let eatenCount = state.ghostsEatenThisPower;
  let caught = false;

  const ghosts = state.ghosts.map((ghost, index) => {
    const was = ghostsBefore[index] ?? ghost;
    if (ghost.mode === "eaten") return ghost;
    if (!collides(was, ghost, pacBefore, pacAfter)) return ghost;

    if (ghost.mode === "frightened") {
      // The ladder is indexed by how many have already gone this pellet, and clamped
      // so a fifth somehow eaten would pay the top rate rather than read off the end.
      score += PACMAN_GHOST_POINTS[Math.min(eatenCount, PACMAN_GHOST_POINTS.length - 1)];
      eatenCount += 1;
      return { ...ghost, mode: "eaten" as GhostMode };
    }

    caught = true;
    return ghost;
  });

  return { state: { ...state, ghosts, score, ghostsEatenThisPower: eatenCount }, caught };
}

/* ---------------------------------------------------------------------------------
   The bazooka.

   A pickup, one shot, one dead ghost. Every rule here is a pure function over the
   state like everything above it, so the whole feature is testable without a clock
   or a browser — which matters more here than elsewhere, because a projectile that
   resolves several tiles per tick is exactly the sort of thing that silently skips
   over a target.
--------------------------------------------------------------------------------- */

/**
 * A tile a bazooka may spawn on: open floor, far enough from Pac-Man.
 *
 * Pellets are fine to spawn on — the pickup sits over one and the pellet is still
 * eaten when he walks the tile — but the ghost house is not, since a pickup inside it
 * would be unreachable and the spawner would burn its cooldown on nothing.
 */
function canSpawnBazookaAt(row: number, col: number, pacman: PacmanPoint): boolean {
  if (!canEnter(row, col, "pacman")) return false;

  // Straight-line distance, deliberately approximate: the point is only that a pickup
  // never materialises on top of the player, which would reward standing still rather
  // than going to get it.
  const dr = row - pacman.row;
  const dc = col - pacman.col;
  return dr * dr + dc * dc >= BAZOOKA_MIN_SPAWN_DISTANCE * BAZOOKA_MIN_SPAWN_DISTANCE;
}

/**
 * Picks a tile for a new bazooka, or `undefined` if no suitable one was found.
 *
 * Rejection sampling with a bounded number of attempts rather than building the list
 * of every legal tile and choosing from it. The maze has ~300 open tiles and most
 * qualify, so a handful of draws almost always succeeds — and the bound is what stops
 * this looping forever in the degenerate case where Pac-Man is somehow far from
 * nothing. Returning `undefined` simply means "not this tick"; the cooldown is
 * untouched and the spawner tries again on the next one.
 */
export function spawnBazooka(state: PacmanState, random: Random): Bazooka | undefined {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const row = Math.floor(random() * PACMAN_ROWS);
    const col = Math.floor(random() * PACMAN_COLS);
    if (!canSpawnBazookaAt(row, col, state.pacman)) continue;
    return { row, col, ttl: BAZOOKA_TTL_TICKS };
  }
  return undefined;
}

/**
 * Hands Pac-Man the bazooka he is standing on, if there is one.
 *
 * **Ammunition does not stack.** Collecting while already loaded still takes the
 * pickup off the board but leaves the count at one, which keeps the weapon a decision
 * about *when* to use it rather than a stockpile to accumulate. The cap lives here,
 * in one place, so raising it later is a constant rather than a hunt through the
 * call sites.
 */
export function collectBazooka(state: PacmanState): PacmanState {
  const pickup = state.bazooka;
  if (!pickup) return state;
  if (pickup.row !== state.pacman.row || pickup.col !== state.pacman.col) return state;

  return {
    ...state,
    bazooka: undefined,
    bazookaCooldown: BAZOOKA_SPAWN_TICKS,
    ammo: Math.min(1, state.ammo + 1),
    collectedBazooka: true,
  };
}

/**
 * Fires along Pac-Man's current facing, spending the shot.
 *
 * Refused — by returning the same object — when there is no ammunition, when a shell
 * is already in flight, or when he is not facing anywhere. Referential equality is
 * how the view knows the control did nothing, exactly as the Tetris rules signal a
 * refused move.
 *
 * The shell starts on Pac-Man's own tile rather than one ahead, so a ghost standing
 * directly on top of him is still a legal target. Starting it ahead would make the
 * one shot miss in precisely the situation it is most wanted.
 */
export function fireBazooka(state: PacmanState, facing: PacmanDirection): PacmanState {
  if (state.outcome) return state;
  if (state.ammo <= 0 || state.projectile) return state;
  if (facing === "none") return state;

  return {
    ...state,
    ammo: state.ammo - 1,
    projectile: { row: state.pacman.row, col: state.pacman.col, direction: facing },
  };
}

/**
 * Advances the shell, resolving it **tile by tile** along its path.
 *
 * The stepping is the whole point of this function. A shell moves
 * `PROJECTILE_SPEED` tiles per tick, and a naive implementation that jumped the full
 * distance and then tested for a hit would fly straight through any ghost standing in
 * between — the faster the shell, the more it would miss. Walking the intervening
 * tiles means speed never costs accuracy.
 *
 * Returns the ghost hit (if any) and where the shell ended up, leaving the caller to
 * apply the consequences — the same split `resolveCollisions` uses, so the scoring
 * and the mode change stay in one place rather than being duplicated here.
 *
 * A shell does **not** wrap the tunnel: it stops at the maze edge. One that looped
 * around and struck something behind the player would be unreadable as cause and
 * effect.
 */
export function stepProjectile(
  state: PacmanState,
): { projectile: Projectile | undefined; hit: GhostName | undefined } {
  const shell = state.projectile;
  if (!shell) return { projectile: undefined, hit: undefined };

  const move = MOVES.find((entry) => entry.direction === shell.direction);
  if (!move) return { projectile: undefined, hit: undefined };

  let { row, col } = shell;

  for (let step = 0; step < PROJECTILE_SPEED; step += 1) {
    const nextRow = row + move.dr;
    const nextCol = col + move.dc;

    // The edge and the walls both stop it. No tunnel wrap, deliberately — see above.
    if (nextCol < 0 || nextCol >= PACMAN_COLS) return { projectile: undefined, hit: undefined };
    if (nextRow < 0 || nextRow >= PACMAN_ROWS) return { projectile: undefined, hit: undefined };
    // A shell flies over the ghost-house door rather than through the wall beside it,
    // so it is tested as a ghost would be.
    if (!canEnter(nextRow, nextCol, "ghost")) {
      return { projectile: undefined, hit: undefined };
    }

    row = nextRow;
    col = nextCol;

    // First hit only. A shell that pierced the whole line would make a corridor full
    // of ghosts a single free sweep, which is a bigger reward than one pickup should
    // buy. An already-eaten ghost is a pair of eyes and is not a target.
    const struck = state.ghosts.find(
      (ghost) => ghost.mode !== "eaten" && ghost.row === row && ghost.col === col,
    );
    if (struck) return { projectile: undefined, hit: struck.name };
  }

  return { projectile: { ...shell, row, col }, hit: undefined };
}

/**
 * How long one tick lasts at a given level, in milliseconds.
 *
 * The difficulty curve, and the only place it lives — the view reads this and obeys
 * it, exactly as the Tetris view obeys `dropIntervalMs`. Floors at 90ms: faster than
 * that and the maze stops being navigable with a keyboard rather than becoming harder.
 */
export function tickIntervalMs(level: number): number {
  return Math.max(90, 200 - (level - 1) * 12);
}

/**
 * The score a finished run posts to the board.
 *
 * The score as played, with no bonus and no penalty — unlike Sudoku and Minesweeper,
 * which convert a time, this game already scores in points and converting it again
 * would only obscure what the player watched accumulate.
 *
 * A run that is caught immediately records 0, which is a real result and recordable:
 * the same rule Blackjack applies to a broke run and Mahjong to a hand a bot won.
 */
export function scoreGame(state: PacmanState): number {
  return Math.max(0, state.score);
}

/** The maze as rows of tiles, for a view that draws row by row. */
export function renderRows(state: PacmanState): readonly (readonly PacmanTile[])[] {
  const out: PacmanTile[][] = [];
  for (let row = 0; row < PACMAN_ROWS; row += 1) {
    out.push([...state.pellets.slice(row * PACMAN_COLS, (row + 1) * PACMAN_COLS)]);
  }
  return out;
}
