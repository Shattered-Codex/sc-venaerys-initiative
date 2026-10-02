import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultPlan } from "../scripts/constants/default-phases.js";
import { COMBATANT_FLAGS, COMBAT_FLAGS, HOOKS, KEYBINDINGS, SETTINGS } from "../scripts/constants/module-constants.js";
import CombatSnapshot from "../scripts/services/CombatSnapshot.js";
import { fakeCombat, fakeCombatant } from "./helpers/fake-combat.js";

/**
 * Worlds keep what the module stored: these names may gain siblings, never
 * be renamed or dropped without a migration. Public names (hooks,
 * keybindings) are held to the same rule because macros and other modules
 * use them.
 */
const STORED = {
  settings: ["enabledByDefault", "phaseTemplate", "defaultDc", "showDcToPlayers", "autoAdvance", "openOnStart", "theme", "dcSource", "dcBase", "natural20", "natural1", "suggestFromSheet", "rollPrompt", "rollSource", "rollFormula"],
  combatFlags: ["enabled", "plan", "dc", "suspendedAdvance"],
  combatantFlags: ["side", "phase", "nextPhase", "pinned", "done", "moved", "natural"],
  hooks: ["sc-venaerys-initiative.phaseChange", "sc-venaerys-initiative.combatantDone"],
  keybindings: ["markOwnDone", "advancePhase", "previousPhase", "showTracker"],
};

const stored = (table) => Object.entries(table).filter(([key, value]) => key === value).map(([key]) => key);

describe("stored data stays readable", () => {
  it("keeps every setting, flag, hook and keybinding name", () => {
    for (const name of STORED.settings) assert.ok(stored(SETTINGS).includes(name), name);
    for (const name of STORED.combatFlags) assert.ok(stored(COMBAT_FLAGS).includes(name), name);
    for (const name of STORED.combatantFlags) assert.ok(stored(COMBATANT_FLAGS).includes(name), name);
    for (const name of STORED.hooks) assert.ok(Object.values(HOOKS).includes(name), name);
    for (const name of STORED.keybindings) assert.ok(KEYBINDINGS.some((k) => k.id === name), name);
  });

  it("runs a combat whose phases carry fields this version does not know, or lack the optional ones", () => {
    const plan = defaultPlan().map((phase) => ({ ...phase, futureField: { keep: true } }));
    delete plan[0].onEnter;
    const combat = fakeCombat({ round: 2, flags: { plan }, combatants: [fakeCombatant({ id: "a", flags: { side: "players", phase: "fast", futureFlag: 1 } })] });
    assert.equal(CombatSnapshot.isPhased(combat), true);
    assert.equal(CombatSnapshot.from(combat, null).combatants[0].phase, "fast");
  });
});
