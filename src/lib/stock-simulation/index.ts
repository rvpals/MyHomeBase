// The front door. Everything outside this folder imports from here.

export type {
  OverlayPoint,
  RangeFailure,
  RangeSimulation,
  SimulationRange,
  SimulationResult,
} from "./types";
export {
  INTERVAL_BY_RANGE,
  MINIMUM_OBSERVATIONS,
  SIMULATION_RANGES,
  SIMULATION_RANGE_LABELS,
} from "./ranges";
export { runSimulationSchema, type RunSimulationInput } from "./schema";
export {
  normalizeSeries,
  OVERLAY_STEPS,
  runSimulation,
  simulateRange,
  trimToRecentDays,
} from "./stock-simulation";
