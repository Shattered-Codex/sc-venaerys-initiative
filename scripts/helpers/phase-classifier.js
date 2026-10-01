import { BUILTIN_PHASE_IDS, DISPOSITION, SIDES } from "../constants/module-constants.js";

/**
 * Pure classification: which side a combatant is on, and which phase the
 * automatic rules put it in. Results are "changes" for the placement rules:
 * `{id, target?, side?, initiative?}`, where `target` is the automatic phase
 * (`null` = pending) and an absent `target` leaves the phase alone.
 */

/** Player-owned or Friendly tokens roll against the DC; everyone else is an enemy. */
export function sideFor({ hasPlayerOwner, disposition, hasToken }) {
  if (hasPlayerOwner) return SIDES.players;
  if (hasToken && disposition === DISPOSITION.FRIENDLY) return SIDES.players;
  return SIDES.enemies;
}

/** Meeting the DC is a pass; the total is compared as it is, tie-break decimals included. */
export function phaseForRoll(total, dc) {
  return total >= dc ? BUILTIN_PHASE_IDS.fast : BUILTIN_PHASE_IDS.slow;
}

const hasRolled = (combatant) => Number.isFinite(combatant.initiative);

/** The phase a combatant is heading to this round or the next. */
export function intendedPhase(combatant) {
  return combatant.nextPhase ?? combatant.phase;
}

/**
 * The automatic phase of a combatant on the given side, or undefined when the
 * rules have no say: the GM pinned it, or a player has no roll (pending
 * players stay pending; players placed in Slow without a roll stay there).
 */
function automaticTarget(combatant, side, dc) {
  if (combatant.pinned) return undefined;
  if (side === SIDES.enemies) return BUILTIN_PHASE_IDS.enemies;
  if (hasRolled(combatant)) return phaseForRoll(combatant.initiative, dc);
  return combatant.side ? undefined : null;
}

/** What a combatant needs when it enters a phased combat, or null when nothing differs. */
export function classifyCombatant(combatant, dc) {
  const side = combatant.side ?? sideFor(combatant);
  const change = { id: combatant.id };
  if (side !== combatant.side) change.side = side;
  if (side === SIDES.enemies && !hasRolled(combatant)) change.initiative = combatant.displayInitiative;
  const target = automaticTarget(combatant, side, dc);
  if (target !== undefined && target !== intendedPhase(combatant)) change.target = target;
  return Object.keys(change).length > 1 ? change : null;
}

/** Classifies every combatant; only the ones that change come back, so a second pass is empty. */
export function classifyAll(view) {
  return view.combatants.map((combatant) => classifyCombatant(combatant, view.dc)).filter(Boolean);
}

/** A combatant's initiative was set or rolled again. */
export function classifyRoll(combatant, dc) {
  if (combatant.side !== SIDES.players || combatant.pinned || !hasRolled(combatant)) return null;
  const target = phaseForRoll(combatant.initiative, dc);
  return target === intendedPhase(combatant) ? null : { id: combatant.id, target };
}

/**
 * A combatant's initiative was cleared (one by one or by "Reset initiative"):
 * enemies get their display value back, unpinned players go back to pending.
 */
export function classifyCleared(combatant) {
  if (hasRolled(combatant)) return null;
  if (combatant.side === SIDES.enemies) return { id: combatant.id, initiative: combatant.displayInitiative };
  if (combatant.side !== SIDES.players || combatant.pinned) return null;
  if (combatant.phase === null && combatant.nextPhase === null) return null;
  return { id: combatant.id, target: null };
}

/** A new DC: rolled, unpinned players whose result changes. */
export function classifyForDc(view, dc) {
  return view.combatants.map((combatant) => classifyRoll(combatant, dc)).filter(Boolean);
}

/**
 * "Automatic" in the phase select: the phase the rules give once the pin is
 * gone. A player without a roll is pending before the start and acts in Slow
 * after it, like anyone placed there by "Advance anyway".
 */
export function automaticPhaseOf(combatant, dc, started) {
  const side = combatant.side ?? sideFor(combatant);
  if (side === SIDES.enemies) return BUILTIN_PHASE_IDS.enemies;
  if (hasRolled(combatant)) return phaseForRoll(combatant.initiative, dc);
  return started ? BUILTIN_PHASE_IDS.slow : null;
}
