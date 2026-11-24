/**
 * Home screen systems — the front door.
 *
 * The grouping the landing page clusters modules by. No repository and no
 * schema: a system is a code registry, not a stored record, so there is nothing
 * to read or validate at a boundary.
 */

export {
  HOME_SYSTEMS,
  type HomeSystem,
  type HomeSystemCard,
  type HomeSystemId,
} from "./types";

export { groupModulesBySystem } from "./home-systems";
