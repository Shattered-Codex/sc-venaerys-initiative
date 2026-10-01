import { OPERATION_KEY } from "../constants/module-constants.js";

/**
 * What to do with a Combat update requested on this client, before it is
 * sent. Only the core's own turn navigation is cancelled (`nextTurn`,
 * `previousTurn`, `nextRound`, `previousRound`, whatever called them): it is
 * the one carrying a numeric `direction` and touching nothing but `turn` and
 * `round`. Everything else passes and, if it moved the pointer, is
 * re-anchored afterwards by the active GM.
 *
 * Decisions: "pass", "start" (navigation out of round 0 becomes
 * `startCombat()`), "markDone" (a player's "end turn"), "refuseBack" (a
 * player going back), "advance" and "back" (the GM's navigation).
 */

const NAVIGATION_KEYS = new Set(["turn", "round"]);

export function isNativeNavigation(changes, options) {
  if (options?.[OPERATION_KEY]) return false;
  if (typeof options?.direction !== "number") return false;
  const keys = Object.keys(changes ?? {}).filter((key) => key !== "_id");
  return keys.length > 0 && keys.every((key) => NAVIGATION_KEYS.has(key));
}

export function decide({ changes, options, isGM, enabled, round }) {
  if (!enabled || !isNativeNavigation(changes, options)) return "pass";
  const forward = options.direction > 0;
  if (round === 0) return forward ? "start" : "pass";
  if (!isGM) return forward ? "markDone" : "refuseBack";
  return forward ? "advance" : "back";
}
