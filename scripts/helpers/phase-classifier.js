import { BUILTIN_PHASE_IDS, CRITICALS, DISPOSITION, NATURAL_RULES, SIDES } from "../constants/module-constants.js";

/**
 * Pure classification: which side a combatant is on, and which phase the
 * automatic rules put it in. Results are "changes" for the placement rules:
 * `{id, target?, side?, initiative?}`, where `target` is the automatic phase
 * (`null` = pending) and an absent `target` leaves the phase alone.
 * `naturals` holds the GM's rules for a critical and a fumble
 * (`{natural20, natural1}`); a combatant's `natural` is `"critical"`,
 * `"fumble"` or null for the roll that gave its current initiative. An enemy's `suggestedPhase`,
 * when the caller filled it from the sheet, replaces Enemies as its automatic
 * phase. Event markers keep the phase the GM gave them and never roll.
 */

/** No natural rules: only the total counts. */
export const NO_NATURALS = Object.freeze({ natural20: NATURAL_RULES.none, natural1: NATURAL_RULES.none });

/** Player-owned or Friendly tokens roll against the DC; everyone else is an enemy. */
export function sideFor({ hasPlayerOwner, disposition, hasToken }) {
  if (hasPlayerOwner) return SIDES.players;
  if (hasToken && disposition === DISPOSITION.FRIENDLY) return SIDES.players;
  return SIDES.enemies;
}

/**
 * Meeting the DC is a pass; the total is compared as it is, tie-break
 * decimals included. A critical or a fumble changes that when the GM's rules
 * say so: outright, or by one degree (a critical passes within 9 under the
 * DC; a fumble fails unless 10 over it).
 */
export function phaseForRoll(total, dc, natural = null, naturals = NO_NATURALS) {
  const pass = (passed) => (passed ? BUILTIN_PHASE_IDS.fast : BUILTIN_PHASE_IDS.slow);
  if (natural === CRITICALS.critical) {
    if (naturals.natural20 === NATURAL_RULES.autoSuccess) return pass(true);
    if (naturals.natural20 === NATURAL_RULES.oneDegree) return pass(total >= dc - 9);
  }
  if (natural === CRITICALS.fumble) {
    if (naturals.natural1 === NATURAL_RULES.autoFail) return pass(false);
    if (naturals.natural1 === NATURAL_RULES.oneDegree) return pass(total >= dc + 10);
  }
  return pass(total >= dc);
}

const rollPhase = (combatant, dc, naturals) => phaseForRoll(combatant.initiative, dc, combatant.natural ?? null, naturals);

const hasRolled = (combatant) => Number.isFinite(combatant.initiative);

/** Enemies and event markers keep a display initiative instead of a roll. */
const doesNotRoll = (side) => side === SIDES.enemies || side === SIDES.event;

/** The phase a combatant is heading to this round or the next. */
export function intendedPhase(combatant) {
  return combatant.nextPhase ?? combatant.phase;
}

/**
 * The automatic phase of a combatant on the given side, or undefined when the
 * rules have no say: the GM pinned it, or a player has no roll (pending
 * players stay pending; players placed in Slow without a roll stay there).
 */
const enemyPhase = (combatant) => combatant.suggestedPhase ?? BUILTIN_PHASE_IDS.enemies;

function automaticTarget(combatant, side, dc, naturals) {
  if (combatant.pinned || side === SIDES.event) return undefined;
  if (side === SIDES.enemies) return enemyPhase(combatant);
  if (hasRolled(combatant)) return rollPhase(combatant, dc, naturals);
  return combatant.side ? undefined : null;
}

/** What a combatant needs when it enters a phased combat, or null when nothing differs. */
export function classifyCombatant(combatant, dc, naturals = NO_NATURALS) {
  const side = combatant.side ?? sideFor(combatant);
  const change = { id: combatant.id };
  if (side !== combatant.side) change.side = side;
  if (doesNotRoll(side) && !hasRolled(combatant)) change.initiative = combatant.displayInitiative;
  const target = automaticTarget(combatant, side, dc, naturals);
  if (target !== undefined && target !== intendedPhase(combatant)) change.target = target;
  return Object.keys(change).length > 1 ? change : null;
}

/** Classifies every combatant; only the ones that change come back, so a second pass is empty. */
export function classifyAll(view, naturals = NO_NATURALS) {
  return view.combatants.map((combatant) => classifyCombatant(combatant, view.dc, naturals)).filter(Boolean);
}

/** A combatant's initiative was set or rolled again, or its natural d20 arrived. */
export function classifyRoll(combatant, dc, naturals = NO_NATURALS) {
  if (combatant.side !== SIDES.players || combatant.pinned || !hasRolled(combatant)) return null;
  const target = rollPhase(combatant, dc, naturals);
  return target === intendedPhase(combatant) ? null : { id: combatant.id, target };
}

/**
 * A combatant's initiative was cleared (one by one or by "Reset initiative"):
 * enemies get their display value back, unpinned players go back to pending.
 */
export function classifyCleared(combatant) {
  if (hasRolled(combatant)) return null;
  if (doesNotRoll(combatant.side)) return { id: combatant.id, initiative: combatant.displayInitiative };
  if (combatant.side !== SIDES.players || combatant.pinned) return null;
  if (combatant.phase === null && combatant.nextPhase === null) return null;
  return { id: combatant.id, target: null };
}

/** A new DC: rolled, unpinned players whose result changes. */
export function classifyForDc(view, dc, naturals = NO_NATURALS) {
  return view.combatants.map((combatant) => classifyRoll(combatant, dc, naturals)).filter(Boolean);
}

/**
 * "Automatic" in the phase select: the phase the rules give once the pin is
 * gone. A player without a roll is pending before the start and acts in Slow
 * after it, like anyone placed there by "Advance anyway".
 */
export function automaticPhaseOf(combatant, dc, started, naturals = NO_NATURALS) {
  const side = combatant.side ?? sideFor(combatant);
  if (side === SIDES.event) return combatant.phase;
  if (side === SIDES.enemies) return enemyPhase(combatant);
  if (hasRolled(combatant)) return rollPhase(combatant, dc, naturals);
  return started ? BUILTIN_PHASE_IDS.slow : null;
}
