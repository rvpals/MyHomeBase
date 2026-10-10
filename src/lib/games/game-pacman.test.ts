import { describe, expect, it } from "vitest";
import {
  canEnter,
  collectBazooka,
  collides,
  countPellets,
  freshPellets,
  fireBazooka,
  frightenedTicksFor,
  ghostTarget,
  loseLife,
  mazeTileAt,
  nextLevel,
  phaseAt,
  queueDirection,
  renderRows,
  scoreGame,
  spawnBazooka,
  startGame,
  stepFrom,
  stepGhost,
  stepProjectile,
  tick,
  tickIntervalMs,
} from "./game-pacman";
import {
  BAZOOKA_GHOST_POINTS,
  BAZOOKA_MIN_SPAWN_DISTANCE,
  BAZOOKA_TTL_TICKS,
  GHOST_HOUSE_DOOR,
  GHOST_NAMES,
  GHOST_SCATTER_CORNERS,
  PACMAN_COLS,
  PACMAN_EXTRA_LIFE_AT,
  PACMAN_GHOST_POINTS,
  PACMAN_LIVES,
  PACMAN_MAZE,
  PACMAN_PELLET_POINTS,
  PACMAN_POWER_POINTS,
  PACMAN_ROWS,
  PACMAN_START,
  type Ghost,
  type PacmanState,
} from "./types";

/**
 * A fixed RNG. Pac-Man consumes randomness in exactly one place — a frightened
 * ghost's choice at a junction — so unlike the shuffled games here, a constant is
 * enough and there is no risk of it degenerating.
 */
const alwaysFirst = () => 0;

/** Puts Pac-Man somewhere specific without going through a hundred ticks. */
function place(state: PacmanState, row: number, col: number): PacmanState {
  return { ...state, pacman: { row, col } };
}

/** Moves the ghosts out of the way, so a movement test is not also a collision test. */
function banishGhosts(state: PacmanState): PacmanState {
  return {
    ...state,
    ghosts: state.ghosts.map((ghost) => ({ ...ghost, row: 1, col: 1, penTicks: 999 })),
  };
}

/** One ghost, built where a test needs it. */
function ghostAt(partial: Partial<Ghost> & Pick<Ghost, "name" | "row" | "col">): Ghost {
  return {
    direction: "left",
    mode: "chase",
    penTicks: 0,
    ...partial,
  };
}

describe("the maze", () => {
  // The maze is a hand-drawn picture, so these assert the things a hand edit breaks.
  // Everything else in the game reads its geometry from here.
  it("is rectangular", () => {
    expect(PACMAN_MAZE).toHaveLength(PACMAN_ROWS);
    for (const row of PACMAN_MAZE) {
      expect(row).toHaveLength(PACMAN_COLS);
    }
  });

  it("is enclosed on its top and bottom rows", () => {
    expect([...PACMAN_MAZE[0]].every((cell) => cell === "#")).toBe(true);
    expect([...PACMAN_MAZE[PACMAN_ROWS - 1]].every((cell) => cell === "#")).toBe(true);
  });

  it("opens both tunnel mouths on the same row", () => {
    // The wrap in `stepFrom` is only a passage if both ends are walkable; one wall
    // here would make the tunnel a dead end on one side and an exit on the other.
    const row = 14;
    expect(canEnter(row, 0, "pacman")).toBe(true);
    expect(canEnter(row, PACMAN_COLS - 1, "pacman")).toBe(true);
  });

  it("holds 244 pellets, four of them power pellets", () => {
    const pellets = freshPellets();
    expect(pellets.filter((tile) => tile === "pellet")).toHaveLength(240);
    expect(pellets.filter((tile) => tile === "power")).toHaveLength(4);
    expect(countPellets(pellets)).toBe(244);
  });

  it("starts Pac-Man and every ghost on a walkable tile", () => {
    expect(canEnter(PACMAN_START.row, PACMAN_START.col, "pacman")).toBe(true);
    for (const ghost of startGame().ghosts) {
      expect(canEnter(ghost.row, ghost.col, "ghost")).toBe(true);
    }
  });

  it("leaves every pellet reachable from the start", () => {
    // The failure this catches is a wall edit that seals off a pocket of the maze:
    // the board would then be unclearable and a run could never advance a level.
    const seen = new Set<string>();
    const queue = [PACMAN_START];
    seen.add(`${PACMAN_START.row},${PACMAN_START.col}`);

    while (queue.length > 0) {
      const at = queue.shift()!;
      for (const direction of ["up", "down", "left", "right"] as const) {
        const next = stepFrom(at, direction);
        if (!next || !canEnter(next.row, next.col, "pacman")) continue;
        const key = `${next.row},${next.col}`;
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push(next);
      }
    }

    const pellets = freshPellets();
    for (let row = 0; row < PACMAN_ROWS; row += 1) {
      for (let col = 0; col < PACMAN_COLS; col += 1) {
        const tile = pellets[row * PACMAN_COLS + col];
        if (tile === "pellet" || tile === "power") {
          expect(seen.has(`${row},${col}`)).toBe(true);
        }
      }
    }
  });
});

describe("canEnter", () => {
  it("refuses a wall to everyone", () => {
    expect(canEnter(0, 0, "pacman")).toBe(false);
    expect(canEnter(0, 0, "ghost")).toBe(false);
  });

  it("lets a ghost through the house door but never Pac-Man", () => {
    // The one asymmetric tile in the maze, and the rule that keeps a player from
    // hiding in the ghost house.
    const door = [...PACMAN_MAZE[12]].indexOf("-");
    expect(door).toBeGreaterThan(-1);
    expect(mazeTileAt(12, door)).toBe("door");
    expect(canEnter(12, door, "ghost")).toBe(true);
    expect(canEnter(12, door, "pacman")).toBe(false);
  });

  it("treats everything off the board as wall", () => {
    expect(canEnter(-1, 5, "ghost")).toBe(false);
    expect(canEnter(PACMAN_ROWS, 5, "ghost")).toBe(false);
  });
});

describe("stepFrom", () => {
  it("wraps around the side tunnels", () => {
    expect(stepFrom({ row: 14, col: 0 }, "left")).toEqual({ row: 14, col: PACMAN_COLS - 1 });
    expect(stepFrom({ row: 14, col: PACMAN_COLS - 1 }, "right")).toEqual({ row: 14, col: 0 });
  });

  it("does not wrap vertically", () => {
    // A vertical wrap would be inventing a passage the picture does not show.
    expect(stepFrom({ row: 0, col: 5 }, "up")).toBeUndefined();
    expect(stepFrom({ row: PACMAN_ROWS - 1, col: 5 }, "down")).toBeUndefined();
  });

  it("returns nothing for a non-direction", () => {
    expect(stepFrom({ row: 14, col: 5 }, "none")).toBeUndefined();
  });
});

describe("startGame", () => {
  it("deals a full board with three lives and nothing eaten", () => {
    const state = startGame();
    expect(state.score).toBe(0);
    expect(state.lives).toBe(PACMAN_LIVES);
    expect(state.level).toBe(1);
    expect(state.pelletsLeft).toBe(244);
    expect(state.outcome).toBeUndefined();
    expect(state.direction).toBe("none");
    expect(state.ghosts).toHaveLength(GHOST_NAMES.length);
  });

  it("starts Blinky outside the house and the other three penned", () => {
    const state = startGame();
    const penned = state.ghosts.filter((ghost) => ghost.penTicks > 0).map((g) => g.name);
    expect(penned).toEqual(["pinky", "inky", "clyde"]);
  });
});

describe("queueDirection", () => {
  it("records an illegal turn rather than dropping it", () => {
    // The turn buffer. A turn that cannot be taken yet is held, which is what lets a
    // player press Up slightly before the corridor and still make it.
    const state = place(startGame(), 23, 13);
    const queued = queueDirection(state, "up");
    expect(queued.queued).toBe("up");
  });

  it("is a no-op once the game is over", () => {
    const over: PacmanState = { ...startGame(), outcome: "caught" };
    expect(queueDirection(over, "left")).toBe(over);
  });

  it("returns the same object when nothing changes", () => {
    // Referential equality is what the view uses to decide a control did something.
    const state = queueDirection(startGame(), "left");
    expect(queueDirection(state, "left")).toBe(state);
    expect(queueDirection(state, "none")).toBe(state);
  });
});

describe("tick: movement", () => {
  it("applies a queued turn on the first tick it is legal", () => {
    // Row 1 is the open corridor under the top wall, so left and right are both free.
    let state = banishGhosts(place(startGame(), 1, 2));
    state = queueDirection(state, "right");
    state = tick(state, alwaysFirst);
    expect(state.pacman).toEqual({ row: 1, col: 3 });
    expect(state.direction).toBe("right");
    // Consumed, so it does not re-apply on the next tick.
    expect(state.queued).toBe("none");
  });

  it("holds a turn that is not yet legal and keeps going straight", () => {
    let state = banishGhosts(place(startGame(), 1, 2));
    state = queueDirection(state, "right");
    state = tick(state, alwaysFirst);
    // Up is a wall from row 1; the request should survive the tick.
    state = queueDirection(state, "up");
    state = tick(state, alwaysFirst);
    expect(state.pacman).toEqual({ row: 1, col: 4 });
    expect(state.queued).toBe("up");
  });

  it("stops rather than walking into a wall", () => {
    let state = banishGhosts(place(startGame(), 1, 1));
    state = queueDirection(state, "left");
    state = tick(state, alwaysFirst);
    // Column 0 of row 1 is wall, so he stays put and is recorded as stopped.
    expect(state.pacman).toEqual({ row: 1, col: 1 });
    expect(state.direction).toBe("none");
  });

  it("does not count a blocked tick as a move", () => {
    let state = banishGhosts(place(startGame(), 1, 1));
    state = queueDirection(state, "left");
    const moves = state.moves;
    state = tick(state, alwaysFirst);
    expect(state.moves).toBe(moves);
  });
});

describe("tick: eating", () => {
  it("scores a pellet and takes it off the board", () => {
    let state = banishGhosts(place(startGame(), 1, 1));
    const before = state.pelletsLeft;
    state = queueDirection(state, "right");
    state = tick(state, alwaysFirst);
    expect(state.score).toBe(PACMAN_PELLET_POINTS);
    expect(state.pelletsLeft).toBe(before - 1);
  });

  it("does not score the same pellet twice", () => {
    let state = banishGhosts(place(startGame(), 1, 1));
    state = queueDirection(state, "right");
    state = tick(state, alwaysFirst);
    const score = state.score;
    // Turn back onto the tile just cleared.
    state = queueDirection(state, "left");
    state = tick(state, alwaysFirst);
    expect(state.score).toBe(score);
  });

  it("frightens every hunting ghost on a power pellet", () => {
    // Row 3 column 1 is a power pellet; approach it from the right.
    expect(mazeTileAt(3, 1)).toBe("power");
    let state = place(startGame(), 3, 2);
    state = { ...state, ghosts: state.ghosts.map((g) => ({ ...g, row: 1, col: 13, penTicks: 0 })) };
    state = queueDirection(state, "left");
    state = tick(state, alwaysFirst);

    expect(state.score).toBeGreaterThanOrEqual(PACMAN_POWER_POINTS);
    expect(state.frightenedTicks).toBeGreaterThan(0);
    expect(state.ghosts.every((ghost) => ghost.mode === "frightened")).toBe(true);
  });

  it("leaves an eaten ghost alone when a power pellet is taken", () => {
    // A pair of eyes on its way home is not catchable; re-frightening it would hand
    // the player a free second helping.
    let state = place(startGame(), 3, 2);
    state = {
      ...state,
      ghosts: state.ghosts.map((ghost, index) =>
        index === 0
          ? { ...ghost, row: 1, col: 13, penTicks: 0, mode: "eaten" as const }
          : { ...ghost, row: 1, col: 13, penTicks: 0 },
      ),
    };
    state = queueDirection(state, "left");
    state = tick(state, alwaysFirst);
    expect(state.ghosts[0].mode).toBe("eaten");
  });
});

describe("tick: ghosts and collisions", () => {
  it("ends a life when a hunting ghost reaches Pac-Man", () => {
    let state = place(startGame(), 1, 2);
    state = {
      ...state,
      // Sitting right on him, hunting.
      ghosts: [ghostAt({ name: "blinky", row: 1, col: 2, mode: "chase" })],
    };
    state = tick(state, alwaysFirst);
    expect(state.lives).toBe(PACMAN_LIVES - 1);
    expect(state.dying).toBe(true);
  });

  it("eats a frightened ghost and pays the ladder", () => {
    let state = place(startGame(), 1, 2);
    state = {
      ...state,
      frightenedTicks: 20,
      ghosts: [ghostAt({ name: "blinky", row: 1, col: 2, mode: "frightened" })],
    };
    const before = state.score;
    state = tick(state, alwaysFirst);

    expect(state.ghosts[0].mode).toBe("eaten");
    expect(state.lives).toBe(PACMAN_LIVES);
    // The pellet he also ate is worth 10 on top of the ghost's 200.
    expect(state.score - before).toBeGreaterThanOrEqual(PACMAN_GHOST_POINTS[0]);
  });

  it("doubles the ghost payout within one power pellet", () => {
    // 200 then 400, which is the whole reason to chase rather than merely survive.
    let state = place(startGame(), 1, 2);
    state = {
      ...state,
      frightenedTicks: 40,
      ghostsEatenThisPower: 1,
      ghosts: [ghostAt({ name: "blinky", row: 1, col: 2, mode: "frightened" })],
    };
    const before = state.score;
    state = tick(state, alwaysFirst);
    expect(state.score - before).toBeGreaterThanOrEqual(PACMAN_GHOST_POINTS[1]);
    expect(state.ghostsEatenThisPower).toBe(2);
  });

  it("catches a head-on pass rather than letting the two swap tiles", () => {
    // The failure tile-stepped movement invites: without the swap test, a head-on
    // meeting on adjacent tiles trades places and both walk away unharmed.
    const before = { row: 1, col: 3 };
    const after = { row: 1, col: 2 };
    const pacBefore = { row: 1, col: 2 };
    const pacAfter = { row: 1, col: 3 };
    expect(collides(before, after, pacBefore, pacAfter)).toBe(true);
  });

  it("does not report a collision between unrelated tiles", () => {
    expect(
      collides({ row: 5, col: 5 }, { row: 5, col: 6 }, { row: 1, col: 1 }, { row: 1, col: 2 }),
    ).toBe(false);
  });

  it("releases a penned ghost only after its stagger runs out", () => {
    const state = startGame();
    const clyde = state.ghosts.find((ghost) => ghost.name === "clyde")!;
    const stepped = stepGhost(clyde, state, alwaysFirst);
    // Still counting down, so it has not moved.
    expect(stepped.penTicks).toBe(clyde.penTicks - 1);
    expect(stepped.row).toBe(clyde.row);
    expect(stepped.col).toBe(clyde.col);
  });
});

describe("ghostTarget", () => {
  const state = place(startGame(), 14, 13);

  it("sends each ghost to its own corner while scattering", () => {
    for (const name of GHOST_NAMES) {
      const ghost = ghostAt({ name, row: 10, col: 10, mode: "scatter" });
      expect(ghostTarget(ghost, state, "scatter")).toEqual(GHOST_SCATTER_CORNERS[name]);
    }
  });

  it("points Blinky straight at Pac-Man", () => {
    const ghost = ghostAt({ name: "blinky", row: 10, col: 10 });
    expect(ghostTarget(ghost, state, "chase")).toEqual(state.pacman);
  });

  it("points Pinky four tiles ahead of Pac-Man", () => {
    const facing: PacmanState = { ...state, direction: "left" };
    const ghost = ghostAt({ name: "pinky", row: 10, col: 10 });
    expect(ghostTarget(ghost, facing, "chase")).toEqual({ row: 14, col: 9 });
  });

  it("builds Inky's target from Blinky's position", () => {
    // The vector from Blinky to two ahead of Pac-Man, doubled. Facing left from
    // (14,13) puts the pivot at (14,11); with Blinky at (14,15) that reflects to
    // (14,7) — so Inky is dangerous exactly when Blinky has you cornered.
    const facing: PacmanState = {
      ...state,
      direction: "left",
      ghosts: [ghostAt({ name: "blinky", row: 14, col: 15 })],
    };
    const inky = ghostAt({ name: "inky", row: 10, col: 10 });
    expect(ghostTarget(inky, facing, "chase")).toEqual({ row: 14, col: 7 });
  });

  it("makes Clyde chase from afar and flee when close", () => {
    const far = ghostAt({ name: "clyde", row: 2, col: 2 });
    expect(ghostTarget(far, state, "chase")).toEqual(state.pacman);

    const near = ghostAt({ name: "clyde", row: 14, col: 14 });
    expect(ghostTarget(near, state, "chase")).toEqual(GHOST_SCATTER_CORNERS.clyde);
  });

  it("sends an eaten ghost home whatever the phase", () => {
    const eyes = ghostAt({ name: "pinky", row: 5, col: 5, mode: "eaten" });
    expect(ghostTarget(eyes, state, "chase")).toEqual(GHOST_HOUSE_DOOR);
    expect(ghostTarget(eyes, state, "scatter")).toEqual(GHOST_HOUSE_DOOR);
  });
});

describe("stepGhost", () => {
  it("never reverses when another exit is available", () => {
    // Without this a ghost oscillates between two tiles whenever its target is
    // behind it, and the maze fills with twitching.
    const state = place(startGame(), 1, 1);
    const ghost = ghostAt({ name: "blinky", row: 1, col: 13, direction: "left" });
    const stepped = stepGhost(ghost, state, alwaysFirst);
    expect(stepped.direction).not.toBe("right");
  });

  it("moves onto a walkable tile", () => {
    const state = place(startGame(), 1, 1);
    const ghost = ghostAt({ name: "blinky", row: 1, col: 13, direction: "left" });
    const stepped = stepGhost(ghost, state, alwaysFirst);
    expect(canEnter(stepped.row, stepped.col, "ghost")).toBe(true);
  });

  it("closes on its target when chasing", () => {
    const state = place(startGame(), 1, 1);
    const ghost = ghostAt({ name: "blinky", row: 1, col: 13, direction: "left" });
    const stepped = stepGhost(ghost, state, alwaysFirst);
    // Blinky targets Pac-Man, who is away to the left along the same corridor.
    expect(stepped.col).toBeLessThan(ghost.col);
  });
});

describe("phases", () => {
  it("opens a life on scatter and turns to chase", () => {
    // The alternation is what makes the game playable: four ghosts in permanent
    // chase corner Pac-Man almost immediately.
    expect(phaseAt(0)).toBe("scatter");
    expect(phaseAt(24)).toBe("scatter");
    expect(phaseAt(25)).toBe("chase");
  });

  it("settles into permanent chase", () => {
    expect(phaseAt(100_000)).toBe("chase");
  });
});

describe("difficulty", () => {
  it("shortens the power pellet as the levels climb", () => {
    expect(frightenedTicksFor(2)).toBeLessThan(frightenedTicksFor(1));
  });

  it("never lets a power pellet frighten nobody", () => {
    // A pellet worth 50 points and nothing else would read as a bug, not difficulty.
    expect(frightenedTicksFor(50)).toBeGreaterThan(0);
  });

  it("speeds the clock up but floors it", () => {
    expect(tickIntervalMs(5)).toBeLessThan(tickIntervalMs(1));
    expect(tickIntervalMs(100)).toBeGreaterThanOrEqual(90);
  });
});

describe("lives and levels", () => {
  it("keeps the board but resets everyone on losing a life", () => {
    // A life costs you position, not progress — which is what makes a board winnable.
    const played: PacmanState = { ...startGame(), pelletsLeft: 100, score: 500 };
    const next = loseLife(played);
    expect(next.lives).toBe(PACMAN_LIVES - 1);
    expect(next.pelletsLeft).toBe(100);
    expect(next.score).toBe(500);
    expect(next.pacman).toEqual(PACMAN_START);
    expect(next.outcome).toBeUndefined();
  });

  it("ends the run when the last life goes", () => {
    const last: PacmanState = { ...startGame(), lives: 1 };
    const next = loseLife(last);
    expect(next.lives).toBe(0);
    expect(next.outcome).toBe("caught");
  });

  it("deals a fresh board on clearing one, keeping score and lives", () => {
    const cleared: PacmanState = { ...startGame(), pelletsLeft: 0, score: 3000, lives: 2 };
    const next = nextLevel(cleared);
    expect(next.level).toBe(2);
    expect(next.pelletsLeft).toBe(244);
    expect(next.score).toBe(3000);
    expect(next.lives).toBe(2);
  });

  it("advances the level when the last pellet goes", () => {
    // Driven through `tick` rather than `nextLevel` directly, so the wiring is tested
    // and not merely the helper.
    let state = banishGhosts(place(startGame(), 1, 1));
    state = { ...state, pelletsLeft: 1 };
    state = queueDirection(state, "right");
    state = tick(state, alwaysFirst);
    expect(state.level).toBe(2);
    expect(state.pelletsLeft).toBe(244);
  });

  it("awards one extra life, and only one", () => {
    // The flag matters: a `score >= 10000` test is true on every later tick and would
    // hand out a life per pellet for the rest of the run.
    let state = banishGhosts(place(startGame(), 1, 1));
    state = { ...state, score: PACMAN_EXTRA_LIFE_AT - PACMAN_PELLET_POINTS };
    state = queueDirection(state, "right");
    state = tick(state, alwaysFirst);
    expect(state.lives).toBe(PACMAN_LIVES + 1);
    expect(state.extraLifeAwarded).toBe(true);

    // Several more pellets; the life is not awarded again.
    for (let step = 0; step < 3; step += 1) {
      state = queueDirection(state, "right");
      state = tick(state, alwaysFirst);
    }
    expect(state.lives).toBe(PACMAN_LIVES + 1);
  });

  it("is a no-op once the run is over", () => {
    const over: PacmanState = { ...startGame(), outcome: "caught" };
    expect(tick(over, alwaysFirst)).toBe(over);
  });
});

describe("scoreGame", () => {
  it("posts the score as played", () => {
    expect(scoreGame({ ...startGame(), score: 4210 })).toBe(4210);
  });

  it("records 0 for a run that scored nothing", () => {
    // A real result and recordable, as Blackjack treats a broke run.
    expect(scoreGame({ ...startGame(), score: 0, outcome: "caught" })).toBe(0);
  });
});

describe("renderRows", () => {
  it("returns the maze as rows the view can draw", () => {
    const rows = renderRows(startGame());
    expect(rows).toHaveLength(PACMAN_ROWS);
    expect(rows[0]).toHaveLength(PACMAN_COLS);
    expect(rows[0][0]).toBe("wall");
  });
});

describe("the bazooka", () => {
  /** A state with a pickup sitting under Pac-Man, ready to collect. */
  function withPickupUnderfoot(state: PacmanState): PacmanState {
    return {
      ...state,
      bazooka: { row: state.pacman.row, col: state.pacman.col, ttl: BAZOOKA_TTL_TICKS },
    };
  }

  describe("spawning", () => {
    it("never spawns inside a wall", () => {
      const state = startGame();
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const spawned = spawnBazooka(state, Math.random);
        if (!spawned) continue;
        expect(canEnter(spawned.row, spawned.col, "pacman")).toBe(true);
      }
    });

    it("never spawns on top of Pac-Man", () => {
      // A pickup that materialises underfoot rewards standing still rather than
      // going to get it, which is the whole decision the feature is made of.
      const state = startGame();
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const spawned = spawnBazooka(state, Math.random);
        if (!spawned) continue;
        const dr = spawned.row - state.pacman.row;
        const dc = spawned.col - state.pacman.col;
        expect(Math.hypot(dr, dc)).toBeGreaterThanOrEqual(BAZOOKA_MIN_SPAWN_DISTANCE);
      }
    });

    it("gives up rather than looping when no tile qualifies", () => {
      // The RNG is pinned to a single corner tile, which is a wall — so every draw
      // is rejected. The bounded retry is what stops this hanging the tick.
      expect(spawnBazooka(startGame(), () => 0)).toBeUndefined();
    });

    it("puts one on the board when the cooldown runs out", () => {
      let state: PacmanState = { ...startGame(), bazookaCooldown: 1 };
      state = tick(state, Math.random);
      state = tick(state, Math.random);
      expect(state.bazooka).toBeDefined();
    });

    it("expires an uncollected pickup", () => {
      // Without a TTL an uncollected bazooka waits all level and is eventually
      // picked up for free, so the timing stops being a choice.
      let state: PacmanState = {
        ...startGame(),
        bazooka: { row: 1, col: 1, ttl: 1 },
      };
      state = tick(state, Math.random);
      expect(state.bazooka).toBeUndefined();
      expect(state.ammo).toBe(0);
    });
  });

  describe("collecting", () => {
    it("arms Pac-Man and takes the pickup off the board", () => {
      const state = collectBazooka(withPickupUnderfoot(startGame()));
      expect(state.ammo).toBe(1);
      expect(state.bazooka).toBeUndefined();
      expect(state.collectedBazooka).toBe(true);
    });

    it("does nothing when the pickup is elsewhere", () => {
      const state: PacmanState = {
        ...startGame(),
        bazooka: { row: 1, col: 1, ttl: BAZOOKA_TTL_TICKS },
      };
      expect(collectBazooka(state)).toBe(state);
    });

    it("does not stack a second shot", () => {
      // The cap is the rule that keeps this a decision about *when* to fire rather
      // than a stockpile to build up.
      let state = collectBazooka(withPickupUnderfoot(startGame()));
      state = collectBazooka(withPickupUnderfoot(state));
      expect(state.ammo).toBe(1);
    });

    it("scores the pellet it was sitting on as well", () => {
      // A bazooka may spawn over a pellet, and walking that tile should do both.
      let state: PacmanState = { ...banishGhosts(place(startGame(), 1, 1)) };
      state = { ...state, bazooka: { row: 1, col: 2, ttl: BAZOOKA_TTL_TICKS } };
      state = queueDirection(state, "right");
      state = tick(state, Math.random);
      expect(state.ammo).toBe(1);
      expect(state.score).toBe(PACMAN_PELLET_POINTS);
    });
  });

  describe("firing", () => {
    it("spends the shot and puts a shell on Pac-Man's own tile", () => {
      // On his tile rather than ahead of it, so a ghost standing on top of him is
      // still a legal target — the one situation the shot is most wanted.
      const armed: PacmanState = { ...startGame(), ammo: 1 };
      const fired = fireBazooka(armed, "right");
      expect(fired.ammo).toBe(0);
      expect(fired.projectile).toEqual({ ...armed.pacman, direction: "right" });
    });

    it("refuses with no ammunition", () => {
      const empty: PacmanState = { ...startGame(), ammo: 0 };
      expect(fireBazooka(empty, "right")).toBe(empty);
    });

    it("refuses while a shell is already in flight", () => {
      const busy: PacmanState = {
        ...startGame(),
        ammo: 1,
        projectile: { row: 1, col: 1, direction: "right" },
      };
      expect(fireBazooka(busy, "right")).toBe(busy);
    });

    it("refuses when facing nowhere", () => {
      const armed: PacmanState = { ...startGame(), ammo: 1 };
      expect(fireBazooka(armed, "none")).toBe(armed);
    });

    it("is a no-op once the run is over", () => {
      const over: PacmanState = { ...startGame(), ammo: 1, outcome: "caught" };
      expect(fireBazooka(over, "right")).toBe(over);
    });
  });

  describe("the shell in flight", () => {
    it("destroys a ghost in its path", () => {
      let state: PacmanState = { ...startGame(), ammo: 1, pacman: { row: 1, col: 2 } };
      state = { ...state, ghosts: [ghostAt({ name: "blinky", row: 1, col: 5 })] };
      state = fireBazooka(state, "right");
      expect(stepProjectile(state).hit).toBe("blinky");
    });

    it("does not skip a ghost it passes over", () => {
      // The shell moves several tiles per tick; resolving the whole jump at once
      // would fly straight through anything standing in between, and the faster it
      // got the more it would miss.
      let state: PacmanState = { ...startGame(), ammo: 1, pacman: { row: 1, col: 1 } };
      state = { ...state, ghosts: [ghostAt({ name: "pinky", row: 1, col: 2 })] };
      state = fireBazooka(state, "right");
      expect(stepProjectile(state).hit).toBe("pinky");
    });

    it("stops at a wall", () => {
      let state: PacmanState = {
        ...startGame(),
        ammo: 1,
        pacman: { row: 1, col: 1 },
        ghosts: [],
      };
      state = fireBazooka(state, "left");
      const flight = stepProjectile(state);
      expect(flight.projectile).toBeUndefined();
      expect(flight.hit).toBeUndefined();
    });

    it("does not wrap the tunnel", () => {
      // A shell looping the maze and striking something behind the player is
      // unreadable as cause and effect.
      let state: PacmanState = {
        ...startGame(),
        ammo: 1,
        pacman: { row: 14, col: 0 },
        ghosts: [ghostAt({ name: "clyde", row: 14, col: PACMAN_COLS - 1 })],
      };
      state = fireBazooka(state, "left");
      expect(stepProjectile(state).hit).toBeUndefined();
    });

    it("passes over a ghost that is already eyes", () => {
      let state: PacmanState = { ...startGame(), ammo: 1, pacman: { row: 1, col: 1 } };
      state = { ...state, ghosts: [ghostAt({ name: "inky", row: 1, col: 3, mode: "eaten" })] };
      state = fireBazooka(state, "right");
      expect(stepProjectile(state).hit).toBeUndefined();
    });

    it("hits only the first ghost in a line", () => {
      let state: PacmanState = { ...startGame(), ammo: 1, pacman: { row: 1, col: 1 } };
      state = {
        ...state,
        ghosts: [
          ghostAt({ name: "blinky", row: 1, col: 4 }),
          ghostAt({ name: "pinky", row: 1, col: 3 }),
        ],
      };
      state = fireBazooka(state, "right");
      // Pinky is nearer, so the shell stops on her and Blinky survives.
      expect(stepProjectile(state).hit).toBe("pinky");
    });
  });

  describe("the hit, through a whole tick", () => {
    /** A ghost two tiles to the right, with a shell already fired at it. */
    function aimedAtGhost(): PacmanState {
      let state: PacmanState = { ...startGame(), ammo: 1, pacman: { row: 1, col: 2 } };
      state = { ...state, ghosts: [ghostAt({ name: "clyde", row: 1, col: 4 })] };
      return fireBazooka(state, "right");
    }

    it("sends the ghost home as eyes and reports the hit", () => {
      const state = tick(aimedAtGhost(), Math.random);
      expect(state.ghosts[0].mode).toBe("eaten");
      expect(state.shotGhost).toBe("clyde");
      expect(state.projectile).toBeUndefined();
    });

    it("pays the flat rate without advancing the power-pellet ladder", () => {
      // A shot must not inflate the next chomped ghost's payout — the big rewards
      // stay with the riskier play of running one down on foot.
      const before = aimedAtGhost();
      const after = tick(before, Math.random);
      expect(after.score - before.score).toBeGreaterThanOrEqual(BAZOOKA_GHOST_POINTS);
      expect(after.ghostsEatenThisPower).toBe(0);
    });

    it("costs no life, unlike walking into the same ghost", () => {
      const state = tick(aimedAtGhost(), Math.random);
      expect(state.lives).toBe(PACMAN_LIVES);
      expect(state.outcome).toBeUndefined();
    });

    it("clears the hit flag on the following tick", () => {
      // `shotGhost` lives for exactly one tick, like `dying` — the view reads it to
      // fire a cue, and a flag that persisted would re-fire on every later tick.
      let state = tick(aimedAtGhost(), Math.random);
      expect(state.shotGhost).toBe("clyde");
      state = tick(state, Math.random);
      expect(state.shotGhost).toBeUndefined();
    });
  });

  describe("resets", () => {
    it("disarms on losing a life", () => {
      // Carrying a loaded bazooka through a death would make *when* you collect it
      // free, and the timing is the whole decision.
      const armed: PacmanState = {
        ...startGame(),
        ammo: 1,
        bazooka: { row: 1, col: 1, ttl: 10 },
        projectile: { row: 5, col: 5, direction: "up" },
      };
      const next = loseLife(armed);
      expect(next.ammo).toBe(0);
      expect(next.bazooka).toBeUndefined();
      expect(next.projectile).toBeUndefined();
    });

    it("disarms on clearing a board", () => {
      const armed: PacmanState = {
        ...startGame(),
        ammo: 1,
        bazooka: { row: 1, col: 1, ttl: 10 },
      };
      const next = nextLevel(armed);
      expect(next.ammo).toBe(0);
      expect(next.bazooka).toBeUndefined();
    });
  });
});
