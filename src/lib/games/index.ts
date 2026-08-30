// The Games module's front door. Everything outside src/lib/games imports from here.
export {
  ARROW_DIFFICULTIES,
  ARROW_DIFFICULTY_SETUP,
  BOARD_SIZE,
  DIRECTIONS,
  WINNING_TILE,
  arrowDifficultyOf,
  type Arrow,
  type ArrowBoard,
  type ArrowDifficulty,
  type ArrowPuzzle,
  type ArrowState,
  type Board,
  type CatalogueGame,
  type Cell,
  type Direction,
  type GameStatus,
  type MoveResult,
  type Score,
} from "./types";
export { GAME_CATALOGUE, findGame, isKnownGame, listPlayableGames } from "./catalogue";
export {
  moveSchema,
  recordScoreSchema,
  topScoresQuerySchema,
  type MoveInput,
  type RecordScoreInput,
  type ScoreWriteData,
  type TopScoresQuery,
} from "./schema";
export type { ScoreRepository } from "./ports";
export {
  formatScore,
  getGame,
  listAvailableGames,
  listGames,
  listRecentScores,
  listTopScores,
  recordScore,
  type GameSummary,
} from "./games";
export {
  applyMove,
  canMove,
  collapseLine,
  emptyBoard,
  emptyCells,
  hasWon,
  highestTile,
  isGameOver,
  spawnTile,
  startBoard,
  type Random,
} from "./game-2048";
export {
  MAX_ARROW_LENGTH,
  clearArrow,
  generatePuzzle,
  isBlocked,
  isOnBoard,
  isSolved,
  isStuck,
  pathAhead,
  scoreBoard,
  solutionClearsBoard,
  step,
  unblockedArrows,
} from "./game-arrows";
