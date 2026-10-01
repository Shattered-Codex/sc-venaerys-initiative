import { phaseRank } from "./phase-plan.js";

/**
 * Turn order of a phased combat: combatants sort by the rank of their phase
 * in the plan (pending and unknown phases last); inside a phase the original
 * comparator decides, so the system keeps its own order (highest total first,
 * identical creatures together).
 */

const rankCache = new WeakMap();

/** Rank lookup for a plan, built once per plan array. */
function ranksOf(plan) {
  let ranks = rankCache.get(plan);
  if (!ranks) {
    ranks = new Map(plan.map((phase, index) => [phase.id, index]));
    rankCache.set(plan, ranks);
  }
  return ranks;
}

/** Same result as `phaseRank`, without scanning the plan on every comparison. */
export function cachedPhaseRank(plan, phaseId) {
  if (phaseId == null) return plan.length;
  return ranksOf(plan).get(phaseId) ?? phaseRank(plan, phaseId);
}

/**
 * Compares two combatants by phase; `tieBreak` is the original comparator,
 * called only when both share the same rank.
 */
export function compareByPhase(plan, phaseA, phaseB, tieBreak) {
  return cachedPhaseRank(plan, phaseA) - cachedPhaseRank(plan, phaseB) || tieBreak();
}
