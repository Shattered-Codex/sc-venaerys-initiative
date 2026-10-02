import { CRITICALS } from "../../constants/module-constants.js";

/**
 * What the core of the module asks of a game system. The generic adapter
 * works for any system that rolls initiative through the core: enemies show 0
 * instead of a roll, the roll against the DC is the system's own (or the GM's
 * formula), and a natural 20 or 1 on a d20 is a critical or a fumble.
 */
export default class SystemAdapter {
  /** Whether the system has an initiative roll of its own; without one, the GM's formula is always used. */
  get hasSystemRoll() {
    return true;
  }

  /** Whether the module's support for this system is still experimental (the GM is told once). */
  get experimental() {
    return false;
  }

  /** Setting defaults that differ in this system, by setting key. */
  settingDefaults() {
    return {};
  }

  /** The formula used when the GM chose a formula and left it empty: the system's initiative formula. */
  defaultFormula() {
    return String(CONFIG.Combat?.initiative?.formula || game.system?.initiative || "1d20");
  }

  /** A name for a DC value when the system reads it as a level (Call of Cthulhu difficulties), or null. */
  dcName(_dc) {
    return null;
  }

  /** An i18n key the GM should see when the system's roll cannot work with the DC as configured, or null. */
  systemRollProblem() {
    return null;
  }

  /**
   * Keeps the system from tripping over event markers (combatants with no
   * actor and no token), at `setup`, once the document classes are in place:
   * a marker never rolls, even when "Roll All" runs after its initiative was
   * reset.
   */
  guardEventMarkers(isMarker) {
    const proto = CONFIG.Combat?.documentClass?.prototype;
    const original = proto?.rollInitiative;
    if (typeof original !== "function") return;
    proto.rollInitiative = function markerSafeRollInitiative(ids, ...rest) {
      const list = (typeof ids === "string" ? [ids] : Array.from(ids ?? [])).filter((id) => !isMarker(this.combatants.get(id)));
      return original.call(this, list, ...rest);
    };
  }

  /** Rolls initiative for these combatants the way the system does; `forOthers` when a GM rolls for players. */
  rollInitiative(combat, combatantIds, _options = {}) {
    return combat.rollInitiative(combatantIds);
  }

  /** The data a formula's `@` references read for this combatant. */
  rollData(combatant) {
    return combatant?.actor?.getRollData?.() ?? {};
  }

  /** The value written as the combatant's initiative for an evaluated formula roll. */
  initiativeOf(roll) {
    return roll.total;
  }

  /** The initiative value of a combatant that does not roll (enemies). */
  displayInitiative(_combatant) {
    return 0;
  }

  /** The names of an actor's items (features, gear, spells), for the sheet's phase suggestion. */
  itemNames(actor) {
    return Array.from(actor?.items ?? [], (item) => item?.name).filter((name) => typeof name === "string");
  }

  /** The challenge rating of an actor, or null when the system has none. */
  challengeRating(_actor) {
    return null;
  }

  /**
   * A roll's critical or fumble, or null: the first d20 term with exactly one
   * result kept (advantage keeps one of two) showing 20 or 1.
   */
  criticalOf(roll) {
    const die = roll?.dice?.find((term) => term.faces === 20);
    const kept = (die?.results ?? []).filter((result) => result.active !== false && !result.discarded);
    if (kept.length !== 1) return null;
    if (kept[0].result === 20) return CRITICALS.critical;
    return kept[0].result === 1 ? CRITICALS.fumble : null;
  }
}
