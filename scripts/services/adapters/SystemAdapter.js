/**
 * What the core of the module asks of a game system. The generic adapter
 * works for any system: enemies show 0 instead of a roll.
 */
export default class SystemAdapter {
  /** The initiative value of a combatant that does not roll (enemies). */
  displayInitiative(_combatant) {
    return 0;
  }
}
