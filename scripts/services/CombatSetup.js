import { COMBAT_FLAGS, MODULE_ID, OPERATION_KEY, REASONS, SETTINGS } from "../constants/module-constants.js";
import { getSetting } from "../hooks/register-settings.js";
import CombatSnapshot from "./CombatSnapshot.js";

/**
 * The flags a combat starts with, written by the active GM when it is
 * created: phases on or off (world default), a validated copy of the phase
 * template and the default DC. They are written even with phases off, so the
 * GM can still turn them on before the start.
 */
export default class CombatSetup {
  static initialFlags({ enabled }) {
    return {
      [COMBAT_FLAGS.enabled]: enabled,
      [COMBAT_FLAGS.plan]: getSetting(SETTINGS.phaseTemplate),
      [COMBAT_FLAGS.dc]: { value: getSetting(SETTINGS.defaultDc), source: "manual" },
      [COMBAT_FLAGS.suspendedAdvance]: null,
    };
  }

  async onCreateCombat(combat) {
    if (!game.user.isActiveGM) return;
    if (COMBAT_FLAGS.enabled in CombatSnapshot.flagsOf(combat)) return;
    const flags = CombatSetup.initialFlags({ enabled: getSetting(SETTINGS.enabledByDefault) });
    await combat.update({ flags: { [MODULE_ID]: flags } }, { [OPERATION_KEY]: { reason: REASONS.setup } });
  }

  /**
   * GM command: phases on or off, only before the start. Never writes `turn`
   * with it; a combat that predates the module gets its plan and DC here.
   */
  async toggle(combat, { enabled }) {
    if (combat.started) return;
    const current = CombatSnapshot.flagsOf(combat);
    const flags = COMBAT_FLAGS.plan in current ? { [COMBAT_FLAGS.enabled]: !!enabled } : CombatSetup.initialFlags({ enabled: !!enabled });
    await combat.update({ flags: { [MODULE_ID]: flags } }, { [OPERATION_KEY]: { reason: REASONS.toggle } });
  }
}
