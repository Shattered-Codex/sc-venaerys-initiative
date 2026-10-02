/**
 * What the core of the module asks of a game system. The generic adapter
 * works for any system: enemies show 0 instead of a roll.
 */
export default class SystemAdapter {
  /**
   * Keeps the system from tripping over event markers (combatants with no
   * actor and no token). The core handles them; a system that does not
   * overrides this, at `setup`, once its document classes are in place.
   */
  guardEventMarkers(_isMarker) {}

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
   * The natural d20 of an initiative roll, or null without one: the first d20
   * term with exactly one result kept (advantage keeps one of two).
   */
  naturalOf(roll) {
    const die = roll?.dice?.find((term) => term.faces === 20);
    const kept = (die?.results ?? []).filter((result) => result.active !== false && !result.discarded);
    return kept.length === 1 ? kept[0].result : null;
  }
}
