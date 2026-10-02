import { I18N_ROOT, OPERATION_KEY } from "../constants/module-constants.js";
import { activeConflicts } from "../helpers/module-conflicts.js";
import CombatSnapshot from "./CombatSnapshot.js";

/**
 * When a phased combat starts, every GM is warned about each setting of
 * another module that works against the phases, so it can be turned off
 * before the first round runs. Nothing is changed in the other module.
 */
export default class ModuleConflictAdvisor {
  /** The native start (round 0 to 1) of a phased combat, on a GM client. */
  static onUpdateCombat(combat, changed, options) {
    if (!game.user.isGM || !("round" in changed) || options?.[OPERATION_KEY]) return [];
    if (combat.round !== 1 || combat.previous?.round !== 0 || !CombatSnapshot.isPhased(combat)) return [];
    return ModuleConflictAdvisor.warn();
  }

  static warn() {
    const conflicts = activeConflicts({
      isActive: (id) => Boolean(game.modules.get(id)?.active),
      read: ModuleConflictAdvisor.read,
    });
    for (const id of conflicts) ui.notifications.warn(game.i18n.localize(`${I18N_ROOT}.Conflicts.${id}`), { permanent: true });
    return conflicts;
  }

  /** Another module's setting, or undefined when it is not registered. */
  static read(moduleId, key) {
    try {
      return game.settings.get(moduleId, key);
    } catch {
      return undefined;
    }
  }
}
