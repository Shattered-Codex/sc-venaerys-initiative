import { I18N_ROOT } from "../constants/module-constants.js";
import ErrorGuard from "./ErrorGuard.js";
import GmCommandRelay from "./GmCommandRelay.js";

/**
 * The single way a GM changes a phased combat: advance, complete, back,
 * assign, DC, phases on or off. The active GM runs the command; any other GM
 * sends it to the active GM. A command may carry a `precheck` that runs on
 * the requesting client and refuses with a warning before anything is sent.
 */
export default class GmCommands {
  #handlers = new Map();

  constructor() {
    this.relay = new GmCommandRelay((action, combatId, payload) => this.run(action, combatId, payload));
  }

  register(action, handler, { precheck = null } = {}) {
    this.#handlers.set(action, { handler, precheck });
  }

  async execute(action, combat, payload = {}) {
    if (!game.user.isGM || !combat) return undefined;
    const refusal = this.#handlers.get(action)?.precheck?.(combat, payload);
    if (refusal) {
      ui.notifications.warn(game.i18n.localize(`${I18N_ROOT}.Notifications.${refusal}`));
      return undefined;
    }
    if (game.user.isActiveGM) return this.run(action, combat.id, payload);
    this.relay.send({ action, combatId: combat.id, payload });
    return undefined;
  }

  run(action, combatId, payload) {
    const entry = this.#handlers.get(action);
    const combat = game.combats.get(combatId);
    if (!entry || !combat) return undefined;
    return ErrorGuard.wrap(`command:${action}`, entry.handler)(combat, payload);
  }
}
