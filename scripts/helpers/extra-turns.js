import { BUILTIN_PHASE_IDS, CRITICALS, EXTRA_TURN_ROUNDS, SIDES } from "../constants/module-constants.js";
import { placementFor } from "./phase-placement.js";

/**
 * Extra turns of a critical. With the GM's option on, a player whose roll is
 * a critical acts in both players' phases: in the first round only, or in
 * every round (`EXTRA_TURN_ROUNDS`). The second turn is a combatant of its
 * own, `extraTurnOf` naming the original, pinned to the other players' phase:
 * the combat keeps a native turn for it, with its own done mark, and nothing
 * runs a hidden order. With the first round only, it is gone when round 2 starts.
 * It follows its original: hidden with it, defeated with it, and moved to the
 * other phase by the same rule as a GM's change (next round once done or passed,
 * or while it holds the pointer: it ends its turn where it is).
 */

const OTHER_PLAYER_PHASE = Object.freeze({
  [BUILTIN_PHASE_IDS.fast]: BUILTIN_PHASE_IDS.slow,
  [BUILTIN_PHASE_IDS.slow]: BUILTIN_PHASE_IDS.fast,
});

export const isExtraTurn = (combatant) => typeof combatant.extraTurnOf === "string" && combatant.extraTurnOf.length > 0;

/** Whether criticals have their extra turn in `round` (the roll before the start counts as round 1). */
export const extraTurnsIn = (rounds, round) => rounds === EXTRA_TURN_ROUNDS.everyRound || (rounds === EXTRA_TURN_ROUNDS.firstRound && round <= 1);

/** The phase a combatant's extra turn takes, or null when it earns none (or is an extra turn itself). */
export function extraTurnPhase(combatant) {
  if (isExtraTurn(combatant) || combatant.side !== SIDES.players || combatant.natural !== CRITICALS.critical) return null;
  return OTHER_PLAYER_PHASE[combatant.nextPhase ?? combatant.phase] ?? null;
}

/**
 * The phase fields that move an extra turn to `target`. Under the pointer it
 * never changes phase mid-turn: the combat would jump to its new phase and
 * leave the current one unfinished, so it moves next round.
 */
function extraTurnPlacement(view, extra, target, pointerId) {
  const placement = placementFor(view, extra, target);
  if (!view.started || extra.id !== pointerId || !("phase" in placement) || placement.phase === extra.phase) return placement;
  return extra.nextPhase === target ? {} : { nextPhase: target };
}

/**
 * The extra turns to remove, less the one the pointer rests on while someone
 * else could take the turn: the core would hand its turn to another combatant,
 * so it waits for the next move. With nobody left who could act (the last
 * combatant, an orphan once its original is gone), it goes now, or it would
 * hold the combat forever.
 */
function removable(view, ids, pointerId) {
  if (!ids.includes(pointerId)) return ids;
  const leaving = new Set(ids);
  const successor = view.combatants.some((c) => !leaving.has(c.id) && !c.isDefeated);
  return successor ? ids.filter((id) => id !== pointerId) : ids;
}

/**
 * What makes every critical player have exactly one extra turn, in the other
 * players' phase and with the same initiative, and nobody else have one:
 * `create` ({originId, phase, initiative}), `update` ({id, phase?, nextPhase?,
 * initiative?, hidden?, defeated?}) and `remove` (ids, see `removable`). In a
 * round without them (`extraTurnsIn`), or once the combat leaves phases, every
 * extra turn goes.
 */
export function extraTurnChanges(view, { rounds }) {
  const extras = view.combatants.filter(isExtraTurn);
  const pointerId = view.turn === null ? null : view.combatants[view.turn]?.id ?? null;
  if (!view.enabled || !extraTurnsIn(rounds, view.round)) return { create: [], update: [], remove: removable(view, extras.map((c) => c.id), pointerId) };

  const origins = new Map(view.combatants.filter((c) => !isExtraTurn(c)).map((c) => [c.id, c]));
  const served = new Set();
  const update = [];
  const remove = [];
  for (const extra of extras) {
    const origin = origins.get(extra.extraTurnOf);
    const phase = origin ? extraTurnPhase(origin) : null;
    if (!phase || served.has(origin.id)) {
      remove.push(extra.id);
      continue;
    }
    served.add(origin.id);
    const change = { id: extra.id, ...extraTurnPlacement(view, extra, phase, pointerId) };
    if (extra.initiative !== origin.initiative) change.initiative = origin.initiative;
    if (extra.hidden !== origin.hidden) change.hidden = origin.hidden;
    // A defeat through the actor's status is shared already; one on the original's own document is not.
    if (extra.isDefeated !== origin.isDefeated) change.defeated = origin.isDefeated;
    if (Object.keys(change).length > 1) update.push(change);
  }
  const create = [...origins.values()]
    .filter((c) => !served.has(c.id) && extraTurnPhase(c))
    .map((c) => ({ originId: c.id, phase: extraTurnPhase(c), initiative: c.initiative }));
  return { create, update, remove: removable(view, remove, pointerId) };
}

/**
 * The view the start of the next round is chosen from: when extra turns are
 * gone by then, none of them may be where the pointer lands.
 */
export function withoutExtraTurns(view, rounds) {
  if (extraTurnsIn(rounds, view.round + 1)) return view;
  return { ...view, combatants: view.combatants.map((c) => (isExtraTurn(c) ? { ...c, isDefeated: true } : c)) };
}
