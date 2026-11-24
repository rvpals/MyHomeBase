import {
  CHESS_LEVEL_SETUP,
  buildChessSave,
  chessCapturedPieces,
  chessFullMoves,
  chooseChessMove,
  deleteChessGame,
  describeChessResult,
  gameToPgn,
  isChessGameOver,
  isChessGameTimed,
  listChessGames,
  loadChessGame,
  moveToUci,
  parseFen,
  perft,
  playChessMove,
  saveChessGame,
  scoreChessGame,
  squareName,
  startChessGame,
  startPosition,
  toFen,
  undoChessMove,
  type ChessColor,
  type ChessGame,
  type ChessLevel,
} from "@/lib/games";
import { deps } from "@/lib/wiring";
import { messageOf } from "./error-message";

/**
 * Flags, parsed locally rather than with the shared `parseFlags`.
 *
 * That helper pairs **every** flag with the token after it, so `--new --user 1` records
 * `new: "--user"` and loses `user` altogether — fine for a command whose bare flags
 * come last, which is how the existing ones are documented, and not fine here, where
 * `--new`, `--reply`, `--undo` and `--list` all sit beside flags that take values.
 *
 * A token starting with `--` is therefore never taken as a value, and a flag with
 * nothing after it is `true`. Local rather than a fix to the shared helper: changing
 * that would quietly alter how fifty other commands read their arguments, which is not
 * this change's business.
 */
function readFlags(args: string[]): Record<string, string | true> {
  const flags: Record<string, string | true> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg?.startsWith("--")) continue;

    const key = arg.slice(2);
    const next = args[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return flags;
}

/** A flag's text, or undefined when it was absent or passed bare. */
function text(flags: Record<string, string | true>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * Chess from the terminal: the same use-cases the board calls, with no browser.
 *
 *   npm run cli -- chess --new --user 1 --name "Sunday game" --level advanced --color w
 *   npm run cli -- chess --list --user 1
 *   npm run cli -- chess --show --user 1 --name "Sunday game"
 *   npm run cli -- chess --user 1 --name "Sunday game" --move e2e4 --reply
 *   npm run cli -- chess --user 1 --name "Sunday game" --undo
 *   npm run cli -- chess --user 1 --name "Sunday game" --pgn
 *   npm run cli -- chess --user 1 --name "Sunday game" --delete
 *
 * And two that touch no storage at all:
 *
 *   npm run cli -- chess --fen "<FEN>" --best --level advanced
 *   npm run cli -- chess --perft 4
 *
 * **A command is one move, not a session.** Each run loads the named game, does one
 * thing and saves it back, so there is no interactive loop to leave hanging and the
 * game is the same row the web board reads. `--reply` lets the computer answer in the
 * same run, which is what makes playing from here practical.
 *
 * `--perft` is the move generator's own proof — the published count of legal positions
 * at a depth — and it is here rather than only in the tests so a rule change can be
 * re-proved against a real board without running the suite.
 */
export async function chessCommand(args: string[]): Promise<void> {
  const flags = readFlags(args);

  try {
    if ("perft" in flags) {
      runPerft(text(flags, "perft"), text(flags, "fen"));
      return;
    }

    if ("best" in flags) {
      printBestMove(text(flags, "fen"), levelFrom(text(flags, "level")));
      return;
    }

    const userId = Number(text(flags, "user"));
    if (!Number.isInteger(userId) || userId < 1) {
      console.error("Which player? Pass --user <id>. `npm run cli -- list-users` shows them.");
      process.exitCode = 1;
      return;
    }

    if ("list" in flags) {
      printSaves(userId);
      return;
    }

    if ("new" in flags) {
      startGame(userId, flags);
      return;
    }

    // Everything below works on one named game.
    const name = text(flags, "name");
    const found = findSave(userId, name);
    if (!found) {
      console.error(`No saved game called "${name ?? ""}". Try --list.`);
      process.exitCode = 1;
      return;
    }

    if ("delete" in flags) {
      deleteChessGame(deps.chessSavesRepo, { userId, id: found.id });
      console.log(`Deleted "${found.name}".`);
      return;
    }

    const loaded = loadChessGame(deps.chessSavesRepo, { userId, id: found.id });
    let game = loaded.game;

    /*
      A timed game may be read here but not played, for the reason `--new` refuses to
      start one: a command that exits between moves cannot charge a clock, so every move
      made from here would be free. Reading is allowed because `--pgn` and the board
      print are harmless and useful.
    */
    const playing = "move" in flags || "reply" in flags || "undo" in flags;
    if (isChessGameTimed(game) && playing) {
      console.error(
        `"${found.name}" is a timed game, so it can only be played on the board. ` +
          "You can still print it here with --pgn.",
      );
      process.exitCode = 1;
      return;
    }

    if ("pgn" in flags) {
      console.log(gameToPgn(game, { date: pgnDate() }));
      return;
    }

    if ("undo" in flags) {
      game = undoChessMove(game);
      console.log("Took back the last move.");
    }

    const move = text(flags, "move");
    if (move) {
      const played = playChessMove(game, move);
      if (!played.ok) {
        console.error(played.reason);
        process.exitCode = 1;
        return;
      }
      game = played.game;
      console.log(`You played ${played.san}.`);
    }

    if ("reply" in flags && !isChessGameOver(game)) {
      const answer = chooseChessMove(game.position, game.level);
      if (!answer) {
        console.error("The computer has no move to make.");
      } else {
        const played = playChessMove(game, moveToUci(answer));
        if (played.ok) {
          game = played.game;
          console.log(`The computer played ${played.san}.`);
        }
      }
    }

    printGame(game);

    // A finished game cannot be stored — there is nothing to come back to — so it is
    // reported and the row is removed, exactly as the board does when a game ends.
    if (isChessGameOver(game)) {
      deleteChessGame(deps.chessSavesRepo, { userId, id: found.id });
      console.log(`\n${describeChessResult(game)}`);
      console.log(`Score: ${scoreChessGame(game)} pts. The saved game has been removed.`);
      return;
    }

    // Keyed on the name, which is the save's only key — see `saveChessGameSchema`.
    saveChessGame(deps.chessSavesRepo, {
      userId,
      name: found.name,
      save: buildChessSave(game),
    });
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}

function startGame(userId: number, flags: Record<string, string | true>): void {
  const name = text(flags, "name");
  if (!name) {
    console.error('Give the game a name: --name "Sunday game".');
    process.exitCode = 1;
    return;
  }

  /*
    Timed games are deliberately not playable from here, and saying so beats quietly
    starting an untimed one under a name the player chose for a blitz game.

    A run of this command is one move: it loads, plays and exits. There is nothing to
    hold a clock between runs but wall time, which would charge a player for the hours
    their terminal was closed. A clock needs something watching it, and that is the
    board.
  */
  if ("time" in flags) {
    console.error(
      "Timed games are played on the board, not from here — a command runs once and " +
        "exits, so nothing would be watching the clock between moves.",
    );
    process.exitCode = 1;
    return;
  }

  const humanColor: ChessColor = text(flags, "color") === "b" ? "b" : "w";
  const level = levelFrom(text(flags, "level"));
  let game = startChessGame({ humanColor, level, fen: text(flags, "fen") });

  // Playing Black means the computer opens, so it does so here rather than leaving the
  // first run of `--move` to discover it is not your turn.
  if (!isChessGameOver(game) && game.position.turn !== humanColor) {
    const move = chooseChessMove(game.position, level);
    if (move) {
      const played = playChessMove(game, moveToUci(move));
      if (played.ok) {
        game = played.game;
        console.log(`The computer opened with ${played.san}.`);
      }
    }
  }

  saveChessGame(deps.chessSavesRepo, { userId, name, save: buildChessSave(game) });
  console.log(
    `New game "${name.trim()}" — ${CHESS_LEVEL_SETUP[level].label}, you are ${humanColor === "w" ? "White" : "Black"}.`,
  );
  printGame(game);
}

function printSaves(userId: number): void {
  const saves = listChessGames(deps.chessSavesRepo, { userId });
  if (saves.length === 0) {
    console.log("No saved games.");
    return;
  }
  for (const save of saves) {
    const detail = save.readable
      ? `${CHESS_LEVEL_SETUP[save.level].label}, ${save.humanColor === "w" ? "White" : "Black"}, ${Math.ceil(save.moveCount / 2)} moves`
      : "can't be read by this version";
    console.log(`${save.savedAt}  #${save.id}  ${save.name}  (${detail})`);
  }
}

/** One of the player's saves, by name, or by id when `--name` is a number. */
function findSave(
  userId: number,
  name: string | undefined,
): { id: number; name: string } | undefined {
  if (!name) return undefined;
  const saves = listChessGames(deps.chessSavesRepo, { userId });

  const byId = Number(name);
  if (Number.isInteger(byId) && byId > 0) {
    const match = saves.find((save) => save.id === byId);
    if (match) return { id: match.id, name: match.name };
  }

  const match = saves.find((save) => save.name.toLowerCase() === name.trim().toLowerCase());
  return match ? { id: match.id, name: match.name } : undefined;
}

function runPerft(depthText: string | undefined, fen: string | undefined): void {
  const depth = Number(depthText);
  if (!Number.isInteger(depth) || depth < 1 || depth > 6) {
    console.error("--perft takes a depth from 1 to 6.");
    process.exitCode = 1;
    return;
  }

  const position = fen ? parseFen(fen) : startPosition();
  if (!position) {
    console.error("That FEN could not be read.");
    process.exitCode = 1;
    return;
  }

  const started = Date.now();
  const nodes = perft(position, depth);
  console.log(`perft(${depth}) = ${nodes.toLocaleString()}  (${Date.now() - started} ms)`);
}

function printBestMove(fen: string | undefined, level: ChessLevel): void {
  const position = fen ? parseFen(fen) : startPosition();
  if (!position) {
    console.error("That FEN could not be read.");
    process.exitCode = 1;
    return;
  }

  const move = chooseChessMove(position, level);
  if (!move) {
    console.log("No legal move from that position.");
    return;
  }
  console.log(`${moveToUci(move)}  (${squareName(move.from)} to ${squareName(move.to)})`);
}

function levelFrom(value: string | undefined): ChessLevel {
  if (value === "beginner" || value === "intermediate" || value === "advanced") return value;
  return "intermediate";
}

/**
 * The board, drawn for a terminal.
 *
 * White's pieces are upper case and Black's lower, which is FEN's own convention — the
 * Unicode chess glyphs line up badly in a monospace terminal and are missing from
 * plenty of console fonts, which is the same reason the web board draws SVG instead of
 * using them.
 */
function printGame(game: ChessGame): void {
  console.log("");
  for (let row = 0; row < 8; row += 1) {
    const cells: string[] = [];
    for (let file = 0; file < 8; file += 1) {
      const piece = game.position.board[row * 8 + file];
      if (!piece) {
        cells.push(".");
        continue;
      }
      cells.push(piece.color === "w" ? piece.type.toUpperCase() : piece.type);
    }
    console.log(`${8 - row}  ${cells.join(" ")}`);
  }
  console.log("   a b c d e f g h");
  console.log("");

  console.log(`FEN: ${toFen(game.position)}`);
  console.log(
    `Move ${Math.max(1, chessFullMoves(game))} — ${game.position.turn === "w" ? "White" : "Black"} to move` +
      `${game.status === "check" ? " (check)" : ""}`,
  );

  const yours = chessCapturedPieces(game, game.humanColor === "w" ? "b" : "w").join(" ");
  const theirs = chessCapturedPieces(game, game.humanColor).join(" ");
  if (yours || theirs) console.log(`Taken — you: ${yours || "—"}   computer: ${theirs || "—"}`);

  const recent = game.moves.slice(-6).map((move) => move.san);
  if (recent.length > 0) console.log(`Last moves: ${recent.join(" ")}`);
}

/** Today in PGN's `YYYY.MM.DD`. The clock lives here, never in `lib`. */
function pgnDate(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`;
}
