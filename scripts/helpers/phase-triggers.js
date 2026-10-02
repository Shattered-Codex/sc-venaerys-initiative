import { REASONS } from "../constants/module-constants.js";

/**
 * When a phase starts: the module moved the combat forward (advance, round
 * change, the second write of the start) or the native start took it to round
 * 1, and the phase under the pointer is a different one, or the round
 * changed. Going back a phase, re-anchoring and writes by other modules start
 * nothing.
 */

const STARTING = new Set([REASONS.advance, REASONS.round, REASONS.start]);

/** The phase that just started, or null. `before`/`after` are `{round, phaseId}`. */
export function startedPhase({ reason, nativeStart = false, before, after }) {
  if (!nativeStart && !STARTING.has(reason)) return null;
  if (!after?.phaseId) return null;
  if (before?.phaseId === after.phaseId && before?.round === after.round) return null;
  return after.phaseId;
}

/** Whether the combat is in another phase or round than before, by any write. */
export function phaseChanged({ before, after }) {
  if (!Number.isInteger(after?.round) || after.round < 1) return false;
  return before?.round !== after.round || (before?.phaseId ?? null) !== (after.phaseId ?? null);
}

/** The key that keeps a phase's actions to one run per round. */
export function startKey(combatId, round, phaseId) {
  return `${combatId}:${round}:${phaseId}`;
}
