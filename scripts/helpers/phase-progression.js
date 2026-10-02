import { BUILTIN_PHASE_IDS, HALVES, PHASE_TYPES, PLAYER_PHASE_TYPES, SIDES, SPLIT_MODES, START_NAMES_SHOWN } from "../constants/module-constants.js";
import { firstPlayerPhaseRank, phaseRank } from "./phase-plan.js";

/**
 * Pure progression rules: who blocks a phase, when it is complete, where the
 * pointer goes on advance, round change, back and re-anchoring, and when the
 * start of combat needs the GM's confirmation. Every function reads the flat
 * snapshot below and returns a decision; nothing here writes.
 *
 * @typedef {object} PhaseData
 * @property {string} id
 * @property {"fast"|"enemies"|"slow"|"creatures"} type
 * @property {string|null} nameKey
 * @property {string|null} name
 * @property {string} icon
 * @property {string} color
 *
 * @typedef {object} CombatantView
 * @property {string} id
 * @property {string} name
 * @property {string|null} img
 * @property {"players"|"enemies"|null} side      null until classified
 * @property {string|null} phase                  effective phase this round; null = pending
 * @property {string|null} nextPhase              change that takes effect next round
 * @property {boolean} pinned                     phase chosen by the GM
 * @property {number|null} done                   round in which it was marked done
 * @property {number|null} moved                  round in which it marked "moved"
 * @property {number|null} initiative
 * @property {number} displayInitiative           what an enemy shows instead of a roll
 * @property {"critical"|"fumble"|null} natural  extreme result of the roll that gave this initiative
 * @property {number|null} cr                     challenge rating, when the system has one
 * @property {string|null} [suggestedPhase]       phase the sheet suggests; filled only by the classifier service
 * @property {boolean} isDefeated
 * @property {boolean} hidden
 * @property {boolean} visible                    for the user the snapshot was taken for
 * @property {boolean} isOwner                    for the user the snapshot was taken for
 * @property {boolean} hasPlayerOwner
 * @property {boolean} hasToken
 * @property {number|null} disposition
 * @property {string|null} groupKey               identical creatures share it
 *
 * @typedef {object} CombatView
 * @property {string} id
 * @property {boolean} enabled
 * @property {boolean} started
 * @property {number} round
 * @property {number|null} turn
 * @property {PhaseData[]} plan
 * @property {number} dc
 * @property {{source: "manual"|"baseCr", base: number|null, referenceCr: number|null}} dcRule
 * @property {string|null} suspendedAdvance
 * @property {"off"|"players"|"all"} [split]      which phases split into movement and actions
 * @property {string|null} [actionsHalf]          key of the phase whose actions half is running
 * @property {CombatantView[]} combatants        in the order of combat.turns
 */

export const isDone = (combatant, round) => combatant.done === round;

/** A member that still holds its phase: not defeated and not done this round. */
export const blocks = (combatant, round) => !combatant.isDefeated && !isDone(combatant, round);

export const isPending = (combatant) => combatant.side === SIDES.players && combatant.phase === null;

/** Placed in a phase without ever rolling ("Advance anyway"); only the GM sees it. */
export const hasNoRoll = (combatant) =>
  combatant.side === SIDES.players && combatant.phase !== null && !Number.isFinite(combatant.initiative) && !combatant.pinned;

export function pendingOf(view) {
  return view.combatants.filter(isPending);
}

/** The phase of the combatant under the pointer; null before the start or when it points at a pending one. */
export function currentPhaseId(view) {
  if (!view.started || view.turn === null || view.turn === undefined) return null;
  const pointer = view.combatants[view.turn];
  if (!pointer || pointer.phase == null) return null;
  return view.plan.some((phase) => phase.id === pointer.phase) ? pointer.phase : null;
}

/** Indexes, in turn order, of the members of a phase. */
export function memberIndexes(view, phaseId) {
  const out = [];
  view.combatants.forEach((combatant, index) => {
    if (combatant.phase === phaseId) out.push(index);
  });
  return out;
}

export function lastBlockingIndex(view, phaseId, round = view.round) {
  const indexes = memberIndexes(view, phaseId).filter((i) => blocks(view.combatants[i], round));
  return indexes.length ? indexes.at(-1) : -1;
}

/** Where the pointer rests in a phase: its last blocking member, else its last member. */
export function restingIndex(view, phaseId) {
  const blocking = lastBlockingIndex(view, phaseId);
  if (blocking !== -1) return blocking;
  const members = memberIndexes(view, phaseId);
  return members.length ? members.at(-1) : -1;
}

export function isPhaseComplete(view, phaseId) {
  return lastBlockingIndex(view, phaseId) === -1;
}

/** A phase in a round, and the half of it when it splits. */
export function suspensionKey(round, phaseId, half = null) {
  return half ? `${round}:${phaseId}:${half}` : `${round}:${phaseId}`;
}

/** Whether a phase splits into a movement half and an actions half in this combat; event phases never do. */
export function isSplitPhase(view, phaseId) {
  const phase = view.plan.find((p) => p.id === phaseId);
  if (!phase || phase.type === PHASE_TYPES.event) return false;
  if (view.split === SPLIT_MODES.all) return true;
  return view.split === SPLIT_MODES.players && PLAYER_PHASE_TYPES.includes(phase.type);
}

/**
 * The running half of the current phase, or null when it does not split. A
 * split phase starts in its movement half; the actions half runs while
 * `actionsHalf` holds this round's key of the phase, so a stale key from
 * another phase or round never carries over.
 */
export function currentHalf(view) {
  const current = currentPhaseId(view);
  if (current === null || !isSplitPhase(view, current)) return null;
  return view.actionsHalf === suspensionKey(view.round, current) ? HALVES.act : HALVES.move;
}

/** The key of where the combat is: round, phase and, in a split phase, the half. */
export function currentKey(view) {
  const current = currentPhaseId(view);
  return current === null ? null : suspensionKey(view.round, current, currentHalf(view));
}

/** Marked "moved" this round; a member marked done has moved too. */
export const hasMoved = (combatant, round) => combatant.moved === round || isDone(combatant, round);

/** The movement half of a phase is over when every living member has moved. */
export function isMovementComplete(view, phaseId) {
  return !memberIndexes(view, phaseId).some((i) => !view.combatants[i].isDefeated && !hasMoved(view.combatants[i], view.round));
}

/** After "Previous phase" the automatic advance waits for the next mark in that phase (or half). */
export function isAdvanceSuspended(view) {
  const key = currentKey(view);
  return key !== null && view.suspendedAdvance === key;
}

/** The first phase of a round with someone to block it, from `fromRank` on. */
export function firstBlockingPhase(view, round, fromRank = 0) {
  for (let rank = fromRank; rank < view.plan.length; rank++) {
    const phaseId = view.plan[rank].id;
    const index = lastBlockingIndex(view, phaseId, round);
    if (index !== -1) return { phaseId, rank, turn: index };
  }
  return null;
}

/** Where round `round` begins: the last blocking member of its first phase with someone to block. */
export function roundStartTarget(view, round) {
  const first = firstBlockingPhase(view, round);
  return first ? { turn: first.turn, phaseId: first.phaseId } : null;
}

/** Automatic advance is due: the current phase (or its movement half) is complete and not suspended. */
export function shouldAutoAdvance(view) {
  const current = currentPhaseId(view);
  if (current === null || isAdvanceSuspended(view)) return false;
  if (currentHalf(view) === HALVES.move && isMovementComplete(view, current)) return true;
  return isPhaseComplete(view, current);
}

/**
 * Where "advance" goes from the current phase:
 * - `{half: "act", phaseId}`: from the movement half of a split phase to its
 *   actions half, the pointer staying where it is (unless everyone is done);
 * - `{turn, phaseId}`: the next phase with someone to block, this round;
 * - `{round, turn, phaseId}`: the round turns over;
 * - `{waitRolls: true}`: round 1 with pending players, and the advance would
 *   reach the position of the first players' phase (even if empty);
 * - `{none: true}`: no phase has anyone to block (or no current phase).
 */
export function advanceTarget(view) {
  const current = currentPhaseId(view);
  if (current === null) return { none: true };
  if (currentHalf(view) === HALVES.move && !isPhaseComplete(view, current)) return { half: HALVES.act, phaseId: current };
  const currentRank = phaseRank(view.plan, current);
  const lockRank = view.round === 1 && pendingOf(view).length ? firstPlayerPhaseRank(view.plan) : Infinity;
  const locked = currentRank < lockRank;
  for (let rank = currentRank + 1; rank < view.plan.length; rank++) {
    if (locked && rank >= lockRank) return { waitRolls: true };
    const phaseId = view.plan[rank].id;
    const turn = lastBlockingIndex(view, phaseId);
    if (turn !== -1) return { turn, phaseId };
  }
  if (locked && Number.isFinite(lockRank)) return { waitRolls: true };
  const next = roundStartTarget(view, view.round + 1);
  return next ? { round: view.round + 1, ...next } : { none: true };
}

/** The last member that can still act in a phase; defeated members are skipped. */
function lastActiveIndex(view, phaseId) {
  const indexes = memberIndexes(view, phaseId).filter((i) => !view.combatants[i].isDefeated);
  return indexes.length ? indexes.at(-1) : -1;
}

/**
 * Where "previous phase" goes:
 * - `{half: "move", phaseId, suspend}` from the actions half of a split
 *   phase back to its movement half;
 * - `{turn, phaseId, suspend}` in the same round, keeping its done marks;
 * - `{round, turn, phaseId, suspend, clear}` into the previous round, where
 *   `clear` lists the marks to wipe: that phase's marks of the previous round
 *   and every mark of the round being undone;
 * - `{refuse: "noEarlierPhase"}` in round 1 with nothing before: the combat
 *   never goes back to round 0;
 * - `{none: true}` with no current phase.
 * Going back into an earlier phase that splits lands in its actions half
 * (`half: "act"`): "Previous phase" goes back half a phase.
 */
export function backTarget(view) {
  const current = currentPhaseId(view);
  if (current === null) return { none: true };
  const round = view.round;
  if (currentHalf(view) === HALVES.act) return { half: HALVES.move, phaseId: current, suspend: suspensionKey(round, current, HALVES.move) };
  const landing = (targetRound, phaseId) => {
    if (!isSplitPhase(view, phaseId)) return { suspend: suspensionKey(targetRound, phaseId) };
    return { half: HALVES.act, suspend: suspensionKey(targetRound, phaseId, HALVES.act) };
  };
  for (let rank = phaseRank(view.plan, current) - 1; rank >= 0; rank--) {
    const phaseId = view.plan[rank].id;
    const turn = lastActiveIndex(view, phaseId);
    if (turn !== -1) return { turn, phaseId, ...landing(round, phaseId) };
  }
  if (round <= 1) return { refuse: "noEarlierPhase" };
  for (let rank = view.plan.length - 1; rank >= 0; rank--) {
    const phaseId = view.plan[rank].id;
    const turn = lastActiveIndex(view, phaseId);
    if (turn === -1) continue;
    const clear = view.combatants
      .map((c) => {
        const data = {};
        if (c.done === round || (c.phase === phaseId && c.done === round - 1)) data.done = null;
        if (c.moved === round || (c.phase === phaseId && c.moved === round - 1)) data.moved = null;
        return Object.keys(data).length ? { id: c.id, ...data } : null;
      })
      .filter(Boolean);
    return { round: round - 1, turn, phaseId, ...landing(round - 1, phaseId), clear };
  }
  return { refuse: "noEarlierPhase" };
}

/**
 * Where the pointer belongs after a change the module did not make (a raw
 * `turn` write, a combatant added, moved or deleted under it):
 * - on a member of a phase: that phase's resting member;
 * - on a pending combatant or nothing: the last known phase if it still has
 *   members, else the next phase with someone to block after it, else the
 *   first of the round. The round never changes.
 * Returns `{turn, phaseId}`, `null` when the pointer is already there, or
 * `{none: true}` when no phase has members.
 */
export function anchorTarget(view, lastKnownPhaseId = null) {
  if (!view.started) return null;
  const current = currentPhaseId(view);
  if (current !== null) {
    const turn = restingIndex(view, current);
    return turn === view.turn ? null : { turn, phaseId: current };
  }
  const known = view.plan.some((phase) => phase.id === lastKnownPhaseId) ? lastKnownPhaseId : null;
  if (known && memberIndexes(view, known).length) return { turn: restingIndex(view, known), phaseId: known };
  if (known) {
    const after = firstBlockingPhase(view, view.round, phaseRank(view.plan, known) + 1);
    if (after) return { turn: after.turn, phaseId: after.phaseId };
  }
  const first = roundStartTarget(view, view.round);
  return first ?? { none: true };
}

/**
 * The start needs the GM's confirmation when someone has not rolled and the
 * combat would begin at, or after, the position of the first players' phase,
 * even an empty one.
 */
export function startNeedsConfirmation(view) {
  if (!pendingOf(view).length) return false;
  const first = firstBlockingPhase(view, 1);
  const rank = first ? first.rank : view.plan.length;
  return rank >= firstPlayerPhaseRank(view.plan);
}

/**
 * What the start confirmation shows: who has not rolled (five names, then a
 * count), whether Fast would be skipped, and which button Enter presses.
 */
export function startConfirmation(view) {
  const pending = pendingOf(view);
  const fastHasMembers = memberIndexes(view, BUILTIN_PHASE_IDS.fast).some((i) => !view.combatants[i].isDefeated);
  return {
    count: pending.length,
    names: pending.slice(0, START_NAMES_SHOWN).map((c) => c.name),
    more: Math.max(pending.length - START_NAMES_SHOWN, 0),
    fastEmpty: !fastHasMembers,
    defaultAction: fastHasMembers ? "start" : "wait",
  };
}

/**
 * Who may mark or unmark a combatant done. Nobody before the start nor on a
 * pending combatant, the GM included. The GM may mark anyone in any phase
 * (unmark a finished phase, skip a future one); an owner only their own, in
 * the current phase.
 */
export function canToggleDone(view, combatant, { isGM }) {
  if (!view.started || !combatant || combatant.phase === null) return false;
  if (isGM) return true;
  return combatant.isOwner && combatant.phase === currentPhaseId(view);
}

/** Who goes to Slow when the combat starts or advances past the roll lock: whoever is still pending. */
export function pendingToSlow(view) {
  return pendingOf(view).map((c) => ({ id: c.id, target: BUILTIN_PHASE_IDS.slow }));
}
