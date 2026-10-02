import { COMBATANT_FLAGS, HOOKS, MODULE_ID, OPERATION_KEY } from "../constants/module-constants.js";
import { currentPhaseId } from "../helpers/phase-progression.js";
import { phaseChanged } from "../helpers/phase-triggers.js";
import { visibleCombat } from "../helpers/phase-visibility.js";
import CombatSnapshot from "./CombatSnapshot.js";

const DONE_PATH = `flags.${MODULE_ID}.${COMBATANT_FLAGS.done}`;

/**
 * The module's hooks for other modules and macros, called on every client
 * after the core applied the update:
 *
 * - `phaseChange(combat, {round, phaseId, previous: {round, phaseId}, reason})`
 *   when the combat is in another phase or round, by any write. `reason` is
 *   the module's own (`advance`, `round`, `start`, `back`, `anchor`) or null.
 * - `combatantDone(combatant, {done, round, phaseId})` when a done mark is set
 *   or cleared.
 *
 * A player's client never names a phase in which it sees no one (it reads as
 * null) and never reports a combatant the tracker hides from it.
 */
export default class IntegrationHooks {
  constructor({ adapter }) {
    this.adapter = adapter;
  }

  onUpdateCombat(combat, changed, options) {
    if (!("turn" in changed || "round" in changed) || !CombatSnapshot.isPhased(combat)) return false;
    const view = CombatSnapshot.from(combat, this.adapter);
    const seen = IntegrationHooks.seenPhases(view, game.user.isGM);
    const named = (phaseId) => (phaseId !== null && seen.has(phaseId) ? phaseId : null);
    const before = { round: combat.previous?.round ?? null, phaseId: named(CombatSnapshot.previousPhaseOf(combat)) };
    const after = { round: view.round, phaseId: named(currentPhaseId(view)) };
    if (!phaseChanged({ before, after })) return false;
    Hooks.callAll(HOOKS.phaseChange, combat, { ...after, previous: before, reason: options?.[OPERATION_KEY]?.reason ?? null });
    return true;
  }

  onUpdateCombatant(combatant, changes) {
    if (!foundry.utils.hasProperty(changes ?? {}, DONE_PATH)) return false;
    const combat = combatant.parent;
    if (!CombatSnapshot.isPhased(combat) || !(game.user.isGM || combatant.visible)) return false;
    const flags = CombatSnapshot.flagsOf(combatant);
    Hooks.callAll(HOOKS.combatantDone, combatant, {
      done: flags[COMBATANT_FLAGS.done] === combat.round,
      round: combat.round,
      phaseId: flags[COMBATANT_FLAGS.phase] ?? null,
    });
    return true;
  }

  /** Ids of the phases this user sees someone in; the GM sees them all. */
  static seenPhases(view, isGM) {
    if (isGM) return new Set(view.plan.map((phase) => phase.id));
    const phases = visibleCombat(view, { isGM, showDcToPlayers: false }).phases;
    return new Set(phases.filter((p) => p.members?.length).map((p) => p.phase.id));
  }
}
