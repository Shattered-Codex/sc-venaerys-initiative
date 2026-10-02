import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { KEYBINDINGS } from "../scripts/constants/module-constants.js";
import { CONFLICTS, activeConflicts } from "../scripts/helpers/module-conflicts.js";
import { phaseChanged } from "../scripts/helpers/phase-triggers.js";
import { registerKeybindings } from "../scripts/hooks/register-keybindings.js";
import IntegrationHooks from "../scripts/services/IntegrationHooks.js";
import ModuleConflictAdvisor from "../scripts/services/ModuleConflictAdvisor.js";
import { fakeCombat, fakeCombatant, installGame } from "./helpers/fake-combat.js";

const KEY = "sc-venaerys-initiative";

/** Round 2: Ana in Fast, a hidden dragon alone in Boss, a goblin in Enemies. The pointer is on the goblin. */
function encounter() {
  const ana = fakeCombatant({ id: "ana", initiative: 18, flags: { side: "players", phase: "fast", done: 2 } });
  const dragon = fakeCombatant({ id: "dragon", initiative: 0, hidden: true, visible: false, flags: { side: "enemies", phase: "boss" } });
  const goblin = fakeCombatant({ id: "goblin", initiative: 0, flags: { side: "enemies", phase: "enemies" } });
  const combat = fakeCombat({ round: 2, combatants: [ana, dragon, goblin] });
  combat.turn = combat.turns.indexOf(goblin);
  return combat;
}

/** The hook calls one update makes, with `previous` pointing at `fromId` in `fromRound`. */
function phaseHooks(combat, { fromId, fromRound = combat.round, isGM, changed = { turn: combat.turn }, options = { [KEY]: { reason: "advance" } } }) {
  const recorded = installGame({ isGM });
  combat.previous = { round: fromRound, turn: 0, combatantId: fromId };
  new IntegrationHooks({ adapter: null }).onUpdateCombat(combat, changed, options);
  return recorded.hooks;
}

describe("phaseChange", () => {
  it("tells whether the combat is in another phase or round, never in round 0", () => {
    assert.equal(phaseChanged({ before: { round: 2, phaseId: "fast" }, after: { round: 2, phaseId: "enemies" } }), true);
    assert.equal(phaseChanged({ before: { round: 2, phaseId: "slow" }, after: { round: 3, phaseId: "slow" } }), true);
    assert.equal(phaseChanged({ before: { round: 2, phaseId: "fast" }, after: { round: 2, phaseId: "fast" } }), false);
    assert.equal(phaseChanged({ before: { round: 1, phaseId: "fast" }, after: { round: 0, phaseId: null } }), false);
  });

  it("is called on the GM's client with the new and previous phase and the module's reason", () => {
    const combat = encounter();
    const hooks = phaseHooks(combat, { fromId: "dragon", isGM: true });
    assert.deepEqual(hooks, [[`${KEY}.phaseChange`, combat, { round: 2, phaseId: "enemies", previous: { round: 2, phaseId: "boss" }, reason: "advance" }]]);
  });

  it("never names to a player a phase in which they see no one", () => {
    const combat = encounter();
    const [[, , data]] = phaseHooks(combat, { fromId: "dragon", isGM: false });
    assert.deepEqual(data.previous, { round: 2, phaseId: null });
    assert.equal(data.phaseId, "enemies");
    combat.turn = combat.turns.indexOf(combat.combatants.get("dragon"));
    assert.deepEqual(phaseHooks(combat, { fromId: "dragon", isGM: false, fromRound: 2 }), []);
  });

  it("stays quiet inside the same phase, without a turn or round change, and in a combat without phases", () => {
    const combat = encounter();
    assert.deepEqual(phaseHooks(combat, { fromId: "goblin", isGM: true }), []);
    assert.deepEqual(phaseHooks(combat, { fromId: "ana", isGM: true, changed: { flags: {} } }), []);
    const plain = fakeCombat({ phased: false, round: 2, combatants: [fakeCombatant({ id: "x" })] });
    assert.deepEqual(phaseHooks(plain, { fromId: "x", fromRound: 1, isGM: true }), []);
  });

  it("carries a null reason for a write the module did not make", () => {
    const combat = encounter();
    const [[, , data]] = phaseHooks(combat, { fromId: "ana", isGM: true, options: {} });
    assert.equal(data.reason, null);
  });
});

describe("combatantDone", () => {
  const doneChange = (value) => ({ flags: { [KEY]: { done: value } } });

  it("is called when a done mark is set or cleared, with the round and the phase", () => {
    const combat = encounter();
    const goblin = combat.combatants.get("goblin");
    const recorded = installGame({ isGM: false });
    const hooks = new IntegrationHooks({ adapter: null });
    goblin.flags[KEY].done = 2;
    hooks.onUpdateCombatant(goblin, doneChange(2));
    goblin.flags[KEY].done = null;
    hooks.onUpdateCombatant(goblin, doneChange(null));
    assert.deepEqual(recorded.hooks.map(([name, doc, data]) => [name, doc.id, data]), [
      [`${KEY}.combatantDone`, "goblin", { done: true, round: 2, phaseId: "enemies" }],
      [`${KEY}.combatantDone`, "goblin", { done: false, round: 2, phaseId: "enemies" }],
    ]);
  });

  it("never reports a hidden combatant to a player, nor another change", () => {
    const combat = encounter();
    const recorded = installGame({ isGM: false });
    const hooks = new IntegrationHooks({ adapter: null });
    hooks.onUpdateCombatant(combat.combatants.get("dragon"), doneChange(2));
    hooks.onUpdateCombatant(combat.combatants.get("goblin"), { initiative: 3 });
    assert.deepEqual(recorded.hooks, []);
    installGame({ isGM: true });
    assert.equal(hooks.onUpdateCombatant(combat.combatants.get("dragon"), doneChange(2)), true);
  });
});

describe("conflicting settings of other modules", () => {
  const settings = (values) => (moduleId, key) => values[`${moduleId}.${key}`];
  const all = () => true;

  it("finds midi-qol's auto reroll and attacks of opportunity, and the dock's hide until first turn", () => {
    const read = settings({
      "midi-qol.ConfigSettings": { optionalRules: { autoRerollInitiative: true }, recordAOO: "all" },
      "combat-tracker-dock.hideFirstRound": true,
    });
    assert.deepEqual(activeConflicts({ isActive: all, read }), ["midiAutoReroll", "midiRecordAoo", "dockHideFirstRound"]);
  });

  it("ignores inactive modules, settings that are off or missing, and midi's optional rules while they are toggled off", () => {
    const on = settings({ "midi-qol.ConfigSettings": { optionalRules: { autoRerollInitiative: true }, recordAOO: "npc" }, "combat-tracker-dock.hideFirstRound": true });
    assert.deepEqual(activeConflicts({ isActive: (id) => id === "combat-tracker-dock", read: on }), ["dockHideFirstRound"]);
    const off = settings({ "midi-qol.ConfigSettings": { optionalRules: { autoRerollInitiative: false }, recordAOO: "none" }, "combat-tracker-dock.hideFirstRound": false });
    assert.deepEqual(activeConflicts({ isActive: all, read: off }), []);
    assert.deepEqual(activeConflicts({ isActive: all, read: () => undefined }), []);
    const toggled = settings({ "midi-qol.ConfigSettings": { toggleOptionalRules: true, optionalRules: { autoRerollInitiative: true } } });
    assert.deepEqual(activeConflicts({ isActive: all, read: toggled }), []);
  });

  it("warns a GM once per conflict at the native start of a phased combat, and only then", () => {
    const start = (isGM, { phased = true, options = {}, from = 0 } = {}) => {
      const recorded = installGame({ isGM });
      game.modules = { get: (id) => ({ id, active: id === "combat-tracker-dock" }) };
      game.settings.get = (moduleId, key) => {
        if (moduleId === "combat-tracker-dock" && key === "hideFirstRound") return true;
        throw new Error("not registered");
      };
      const combat = fakeCombat({ round: 1, phased });
      combat.previous = { round: from, turn: 0 };
      return { result: ModuleConflictAdvisor.onUpdateCombat(combat, { round: 1 }, options), warnings: recorded.warnings };
    };
    assert.deepEqual(start(true), { result: ["dockHideFirstRound"], warnings: [`SC_VENAERYS_INITIATIVE.Conflicts.dockHideFirstRound`] });
    assert.deepEqual(start(false).warnings, []);
    assert.deepEqual(start(true, { phased: false }).warnings, []);
    assert.deepEqual(start(true, { from: 1 }).warnings, []);
    assert.deepEqual(start(true, { options: { [KEY]: { reason: "start" } } }).warnings, []);
  });
});

describe("keybindings", () => {
  it("registers the four actions with no default key, the phase moves restricted to GMs", () => {
    const registered = [];
    installGame();
    game.keybindings = { register: (namespace, id, data) => registered.push({ namespace, id, ...data }) };
    const ran = [];
    registerKeybindings({ markOwnDone: () => ran.push("mark") === 1, advancePhase: () => false });
    assert.deepEqual(registered.map((k) => [k.namespace, k.id, k.restricted]), [
      [KEY, "markOwnDone", false],
      [KEY, "advancePhase", true],
      [KEY, "previousPhase", true],
      [KEY, "showTracker", false],
    ]);
    assert.ok(registered.every((k) => Array.isArray(k.editable) && k.editable.length === 0));
    assert.equal(registered[0].name, "SC_VENAERYS_INITIATIVE.Keybindings.markOwnDone.Name");
    assert.equal(registered[0].onDown(), true);
    assert.equal(registered[1].onDown(), false);
    assert.equal(registered[2].onDown(), false);
    assert.deepEqual(ran, ["mark"]);
  });
});

describe("strings built at runtime", () => {
  it("has every conflict warning and keybinding name and hint in both languages", async () => {
    for (const lang of ["en", "pt-BR"]) {
      const root = JSON.parse(await readFile(new URL(`../lang/${lang}.json`, import.meta.url), "utf8")).SC_VENAERYS_INITIATIVE;
      for (const { id } of CONFLICTS) assert.equal(typeof root.Conflicts?.[id], "string", `${lang} Conflicts.${id}`);
      for (const { id } of KEYBINDINGS) {
        assert.equal(typeof root.Keybindings?.[id]?.Name, "string", `${lang} Keybindings.${id}.Name`);
        assert.equal(typeof root.Keybindings?.[id]?.Hint, "string", `${lang} Keybindings.${id}.Hint`);
      }
    }
  });
});
