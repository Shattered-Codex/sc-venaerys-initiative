import { phaseRank } from "./phase-plan.js";
import { blocks, currentPhaseId, isDone, memberIndexes } from "./phase-progression.js";

/**
 * Pure placement rules: what to write when someone's phase changes.
 *
 * "Never takes a turn, never gives one": a combatant already done this round
 * keeps acting where it was and moves next round; one not done moves now if
 * the new phase is current or ahead, and next round if it already passed;
 * one with no phase (pending, just entered) takes the new phase at once.
 */

/** The phase fields to write for one combatant heading to `target` (`null` = pending). */
export function placementFor(view, combatant, target) {
  if (target === combatant.phase) return combatant.nextPhase === null ? {} : { nextPhase: null };
  const immediate = { phase: target, nextPhase: null };
  if (!view.started || combatant.phase === null || target === null) return immediate;
  if (isDone(combatant, view.round)) return { nextPhase: target };
  const current = currentPhaseId(view);
  if (current === null) return immediate;
  return phaseRank(view.plan, target) >= phaseRank(view.plan, current) ? immediate : { nextPhase: target };
}

function isPointer(view, combatant) {
  return view.started && view.turn !== null && view.combatants[view.turn]?.id === combatant.id;
}

/**
 * Turns classification or GM changes (`{id, target?, side?, initiative?}`)
 * into document data. `pinned` is written with every phase change: automatic
 * placement unpins (`false`), a GM assignment pins (`true`). A change that
 * moves the combatant under the pointer comes back apart, as `pointer`: it
 * needs its own operation so the pointer can stay in the current phase.
 */
export function planPlacement(view, changes, { pinned = false } = {}) {
  const byId = new Map(view.combatants.map((c) => [c.id, c]));
  const updates = [];
  let pointer = null;
  for (const change of changes) {
    const combatant = byId.get(change.id);
    if (!combatant) continue;
    const data = {};
    if ("side" in change) data.side = change.side;
    if ("initiative" in change) data.initiative = change.initiative;
    if ("target" in change) {
      Object.assign(data, placementFor(view, combatant, change.target));
      if (combatant.pinned !== pinned) data.pinned = pinned;
    }
    if (!Object.keys(data).length) continue;
    // A pending pointer belongs to no phase, so moving it empties none.
    const movesPointer = combatant.phase !== null && "phase" in data && data.phase !== combatant.phase && isPointer(view, combatant);
    if (movesPointer) pointer = { id: combatant.id, data };
    else updates.push({ id: combatant.id, data });
  }
  return { updates, pointer };
}

/**
 * Where the pointer goes when the combatant under it leaves the current
 * phase: the resting member among those who stay, at its index in the new
 * order. `{advanceFirst: true}` when nobody stays: the combat must move on
 * before the combatant moves.
 */
export function pointerAfterMove(view, newPhaseId) {
  const pointerIndex = view.turn;
  const current = currentPhaseId(view);
  const staying = memberIndexes(view, current).filter((i) => i !== pointerIndex);
  if (!staying.length) return { advanceFirst: true };
  const blocking = staying.filter((i) => blocks(view.combatants[i], view.round));
  const target = (blocking.length ? blocking : staying).at(-1);
  const leavesBefore = pointerIndex < target ? 1 : 0;
  const entersBefore = phaseRank(view.plan, newPhaseId) < phaseRank(view.plan, current) ? 1 : 0;
  return { combatTurn: target - leavesBefore + entersBefore };
}

/**
 * The round-change batch: every deferred phase takes effect. When the pointer
 * itself moves, it is parked on the last index (with turn events off) so the
 * round change does not repeat events for someone who already had them.
 */
export function rolloverPlan(view) {
  const updates = view.combatants
    .filter((c) => c.nextPhase !== null && c.nextPhase !== undefined)
    .map((c) => ({ id: c.id, data: { phase: c.nextPhase, nextPhase: null } }));
  const pointer = view.turn === null ? null : view.combatants[view.turn];
  const pointerMoves = !!pointer && updates.some((u) => u.id === pointer.id);
  return { updates, combatTurn: pointerMoves ? view.combatants.length - 1 : null };
}
