import { COMBATANT_FLAGS, COMBAT_FLAGS, MODULE_ID } from "../constants/module-constants.js";
import { compareByPhase } from "../helpers/phase-order.js";
import CombatSnapshot from "./CombatSnapshot.js";
import ErrorGuard from "./ErrorGuard.js";

const ENABLED_PATH = `flags.${MODULE_ID}.${COMBAT_FLAGS.enabled}`;

/**
 * Puts `combat.turns` in phase order on every client by wrapping the core's
 * documented extension point, `Combat#_sortCombatants`. Installed at `init`,
 * after the system has set its Combat class and before world documents are
 * built. A combat without phases keeps the original order.
 */
export default class CombatSorter {
  static install() {
    const proto = CONFIG.Combat.documentClass.prototype;
    const original = proto._sortCombatants;
    // The core passes the comparator unbound: the combat is reached through the combatant.
    function phasedSort(a, b) {
      const plan = CombatSnapshot.planOf(a.parent);
      if (!plan) return original.call(this, a, b);
      const phaseOf = (c) => c.flags?.[MODULE_ID]?.[COMBATANT_FLAGS.phase] ?? null;
      return compareByPhase(plan, phaseOf(a), phaseOf(b), () => original.call(this, a, b));
    }
    proto._sortCombatants = ErrorGuard.wrap("sort", phasedSort, original);
  }

  /**
   * Combat flags never re-sort the turns, so turning phases on or off does it
   * here, synchronously: the native tracker render queued by the same update
   * then already sees the new order.
   */
  static onUpdateCombat(combat, changed) {
    if (foundry.utils.hasProperty(changed, ENABLED_PATH)) combat.setupTurns();
  }
}
