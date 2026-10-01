import { I18N_ROOT } from "../constants/module-constants.js";
import { pointerAfterMove } from "../helpers/phase-placement.js";
import { currentPhaseId } from "../helpers/phase-progression.js";
import { decide } from "../helpers/turn-intercept.js";
import CombatSnapshot from "./CombatSnapshot.js";

/**
 * Native turn navigation in a phased combat becomes the phase command it
 * stands for, wherever it comes from (tracker, dock, keybindings, macros):
 * a player's "end turn" marks their combatants done, the GM's next/previous
 * turn advances or goes back a phase, and next turn in round 0 starts the
 * combat through `startCombat`. Runs in the pre-hook, on the client that
 * asked, so the native update is cancelled before it is sent.
 */
export default class TurnInterceptor {
  constructor({ adapter, commands, doneMarkers }) {
    this.adapter = adapter;
    this.commands = commands;
    this.doneMarkers = doneMarkers;
  }

  /** Intercept core navigation before it emits combatTurn/combatRound. */
  install() {
    const proto = CONFIG.Combat.documentClass.prototype;
    for (const [method, forward] of [["nextTurn", true], ["nextRound", true], ["previousTurn", false], ["previousRound", false]]) {
      const original = proto[method];
      if (typeof original !== "function") continue;
      const interceptor = this;
      proto[method] = async function phasedNavigation(...args) {
        if (!CombatSnapshot.isPhased(this) || (!forward && this.round === 0)) return original.apply(this, args);
        if (this.round === 0) return this.startCombat();
        if (game.user.isGM) await interceptor.commands.execute(forward ? "advance" : "back", this, forward ? { force: true } : {});
        else if (forward) await interceptor.doneMarkers.markOwn(this);
        else ui.notifications.warn(game.i18n.localize(`${I18N_ROOT}.Notifications.OnlyGmBack`));
        return this;
      };
    }
  }

  onPreUpdateCombat(combat, changes, options) {
    const decision = decide({
      changes,
      options,
      isGM: game.user.isGM,
      enabled: CombatSnapshot.isPhased(combat),
      round: combat.round,
    });
    if (decision === "pass") return undefined;
    // The pre-hook must answer synchronously; the command runs right after.
    const later = (fn) => setTimeout(fn, 0);
    switch (decision) {
      case "start":
        later(() => combat.startCombat());
        break;
      case "markDone":
        later(() => this.doneMarkers.markOwn(combat));
        break;
      case "refuseBack":
        ui.notifications.warn(game.i18n.localize(`${I18N_ROOT}.Notifications.OnlyGmBack`));
        break;
      case "advance":
        later(() => this.commands.execute("advance", combat, { force: true }));
        break;
      case "back":
        later(() => this.commands.execute("back", combat));
        break;
    }
    return false;
  }

  /**
   * Deleting the combatant under the pointer would slide the next phase's
   * first member into its index. When others stay in the current phase, the
   * deletion carries the index of the one the pointer should rest on.
   */
  onPreDeleteCombatant(combatant, options) {
    const combat = combatant.parent;
    if (!combat?.started || combat.combatant?.id !== combatant.id || !CombatSnapshot.isPhased(combat)) return;
    const view = CombatSnapshot.from(combat, this.adapter);
    if (currentPhaseId(view) === null) return;
    const move = pointerAfterMove(view, null);
    if (move.advanceFirst) return;
    options.combatTurn = move.combatTurn;
    options.turnEvents = false;
  }
}
