/**
 * Settings of other modules that work against a phased combat. Each check
 * reads through `read(moduleId, key)`, which answers undefined when the module
 * or the setting is missing: these modules are detected, never required.
 *
 * - midi-qol "auto reroll initiative" rerolls everyone and writes `turn: 0`
 *   every round, moving the pointer and repeating turn events.
 * - midi-qol "record attacks of opportunity" spends the reaction of every
 *   member of the phase that is not under the pointer.
 * - Combat Tracker Dock "hide until first turn" keeps the enemies of a phase
 *   that are not under the pointer hidden from players in round 1.
 */

const midiConfig = (read) => read("midi-qol", "ConfigSettings") ?? {};

export const CONFLICTS = Object.freeze([
  {
    id: "midiAutoReroll",
    module: "midi-qol",
    // midi ignores its optional rules while `toggleOptionalRules` is on.
    test: (read) => !midiConfig(read).toggleOptionalRules && midiConfig(read).optionalRules?.autoRerollInitiative === true,
  },
  {
    id: "midiRecordAoo",
    module: "midi-qol",
    test: (read) => {
      const value = midiConfig(read).recordAOO;
      return typeof value === "string" && value !== "" && value !== "none";
    },
  },
  {
    id: "dockHideFirstRound",
    module: "combat-tracker-dock",
    test: (read) => read("combat-tracker-dock", "hideFirstRound") === true,
  },
].map(Object.freeze));

/** Ids of the conflicts in effect: the module is active and its setting is on. */
export function activeConflicts({ isActive, read }) {
  return CONFLICTS.filter((conflict) => isActive(conflict.module) && conflict.test(read)).map((conflict) => conflict.id);
}
