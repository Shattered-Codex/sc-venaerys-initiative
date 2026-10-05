import { COMBATANT_FLAGS, I18N_ROOT, MODULE_ID, ROLL_SOURCES } from "../constants/module-constants.js";
import { canStillRoll } from "../helpers/phase-progression.js";
import CombatSnapshot from "./CombatSnapshot.js";
import FoundryCompat from "./FoundryCompat.js";

const NATURAL_PATH = `flags.${MODULE_ID}.${COMBATANT_FLAGS.natural}`;

/**
 * The one way the module rolls against the DC. With the system as the
 * source, the system's own initiative roll runs (every bonus of the sheet
 * applies). With a formula, or in a system without an initiative roll, the
 * module rolls the GM's formula (or the adapter's default) against the
 * actor's roll data, and writes the total as the initiative and its critical
 * or fumble in one update, like the core does, then posts the roll. An owner
 * rolls their own characters, a GM rolls anyone's. A pending roll is guarded
 * on this client until its system or formula write finishes.
 */
export default class InitiativeRoller {
  #rolling = new Set();

  constructor({ adapter, settings = () => ({ source: ROLL_SOURCES.system, formula: "" }) }) {
    this.adapter = adapter;
    this.settings = settings;
  }

  /** Characters of the players' side with no roll yet; `own` keeps the ones this user owns. */
  static waiting(combat, { own = false } = {}) {
    if (!CombatSnapshot.isPhased(combat)) return [];
    return CombatSnapshot.from(combat, null).combatants.filter((c) => canStillRoll(c) && (own ? c.isOwner : game.user.isGM || c.isOwner));
  }

  /** The formula rolled when the source is a formula: the GM's, else the system's default. */
  formula() {
    return this.settings().formula || this.adapter.defaultFormula();
  }

  usesFormula() {
    return this.settings().source === ROLL_SOURCES.formula || !this.adapter.hasSystemRoll;
  }

  /** Rolls the given characters that may still roll; answers whether anything was rolled. */
  async roll(combat, combatantIds) {
    const allowed = new Set(InitiativeRoller.waiting(combat).map((c) => c.id));
    const ids = combatantIds.filter((id) => allowed.has(id) && !this.#rolling.has(`${combat.id}:${id}`));
    if (!ids.length) return false;
    const keys = ids.map((id) => `${combat.id}:${id}`);
    for (const key of keys) this.#rolling.add(key);
    try {
      if (!this.usesFormula()) {
        await this.adapter.rollInitiative(combat, ids, { forOthers: game.user.isGM });
        return true;
      }
      return await this.#rollFormula(combat, ids, this.formula());
    } finally {
      for (const key of keys) this.#rolling.delete(key);
    }
  }

  rollOwn(combat) {
    return this.roll(combat, InitiativeRoller.waiting(combat, { own: true }).map((c) => c.id));
  }

  /** A GM's "Roll for them": every character still waiting. */
  rollAll(combat) {
    if (!game.user.isGM) return Promise.resolve(false);
    return this.roll(combat, InitiativeRoller.waiting(combat).map((c) => c.id));
  }

  async #rollFormula(combat, ids, formula) {
    const Roll = foundry.dice.Roll;
    if (!Roll.validate(formula)) {
      ui.notifications.error(game.i18n.format(`${I18N_ROOT}.Roll.InvalidFormula`, { formula }));
      return false;
    }
    const rolled = [];
    for (const id of ids) {
      const combatant = combat.combatants.get(id);
      const roll = await new Roll(formula, this.adapter.rollData(combatant)).evaluate();
      rolled.push({ combatant, roll, initiative: this.adapter.initiativeOf(roll), critical: this.adapter.criticalOf(roll) });
    }
    // One write for all of them, without turn events, as the core's own roll does.
    const updates = rolled.map(({ combatant, initiative, critical }) => ({
      _id: combatant.id,
      initiative,
      [NATURAL_PATH]: critical ? { value: critical, initiative } : null,
    }));
    await combat.updateEmbeddedDocuments("Combatant", updates, { turnEvents: false });
    for (const { combatant, roll } of rolled) {
      await roll.toMessage(
        {
          speaker: ChatMessage.implementation.getSpeaker({ actor: combatant.actor, token: combatant.token, alias: combatant.name }),
          flavor: game.i18n.format(`${I18N_ROOT}.Roll.Flavor`, { name: combatant.name }),
          flags: { core: { initiativeRoll: true }, [MODULE_ID]: { formulaRoll: true } },
        },
        combatant.hidden ? FoundryCompat.gmOnlyMessage() : {},
      );
    }
    return true;
  }
}
