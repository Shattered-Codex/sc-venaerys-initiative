import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ActorPhaseDialog from "../scripts/applications/ActorPhaseDialog.js";
import { defaultPlan } from "../scripts/constants/default-phases.js";
import { chosenPhase } from "../scripts/helpers/sheet-suggestion.js";
import CombatantClassifier from "../scripts/services/CombatantClassifier.js";
import PhasePlacementWriter from "../scripts/services/PhasePlacementWriter.js";
import Dnd5eAdapter from "../scripts/services/adapters/Dnd5eAdapter.js";
import { fakeCombat, fakeCombatant, installGame, manualFrames } from "./helpers/fake-combat.js";

const KEY = "sc-venaerys-initiative";

describe("the phase chosen on a creature's sheet", () => {
  it("counts only while the combat's plan has it as a creature phase", () => {
    assert.equal(chosenPhase("boss", defaultPlan()), "boss");
    assert.equal(chosenPhase("deleted", defaultPlan()), null);
    assert.equal(chosenPhase("fast", defaultPlan()), null);
    assert.equal(chosenPhase("lair", defaultPlan()), null);
    assert.equal(chosenPhase(null, defaultPlan()), null);
  });

  function enter({ chosen, items = [], suggestFromSheet = true }) {
    const actor = { type: "npc", items: items.map((name) => ({ name })), flags: chosen === undefined ? {} : { [KEY]: { defaultPhase: chosen } }, system: { attributes: { init: { score: 12 } } } };
    const goblin = fakeCombatant({ id: "g", actor });
    const combat = fakeCombat({ round: 0, turn: null, combatants: [goblin] });
    installGame({ combats: [combat] });
    // Phase names as a client shows them, for the item suggestion.
    globalThis.game.i18n.localize = (key) => (key.startsWith("SC_VENAERYS_INITIATIVE.Phase.") ? key.split(".").pop().replace(/([a-z])([A-Z])/g, "$1 $2") : key);
    const adapter = new Dnd5eAdapter();
    const writer = new PhasePlacementWriter({ adapter, advance: async () => {} });
    const frames = manualFrames();
    const classifier = new CombatantClassifier({ adapter, writer, suggestFromSheet: () => suggestFromSheet, requestFrame: frames.requestFrame });
    classifier.onCreateCombatant(goblin);
    return frames.run().then(() => goblin.flags[KEY]);
  }

  it("puts an entering creature in the phase chosen on its sheet, unpinned, ahead of its items", async () => {
    const flags = await enter({ chosen: "epicBoss", items: ["Boss"] });
    assert.equal(flags.phase, "epicBoss");
    assert.notEqual(flags.pinned, true);
  });

  it("applies the choice even with the item suggestion off", async () => {
    assert.equal((await enter({ chosen: "miniBoss", suggestFromSheet: false })).phase, "miniBoss");
  });

  it("sends the creature back to Enemies when its phase no longer exists", async () => {
    assert.equal((await enter({ chosen: "deleted", suggestFromSheet: false })).phase, "enemies");
    assert.equal((await enter({ chosen: "deleted", items: ["Boss"] })).phase, "boss");
  });
});

describe("ActorPhaseDialog", () => {
  const actor = (extra = {}) => ({ name: "Dragon", hasPlayerOwner: false, flags: {}, updates: [], async update(data) { this.updates.push(data); }, ...extra });

  it("is offered to the GM on creatures only, in the sheet's menu", () => {
    installGame({ isGM: true });
    const controls = [];
    ActorPhaseDialog.addHeaderControl({ document: actor() }, controls);
    assert.equal(controls.length, 1);
    assert.equal(typeof controls[0].onClick, "function");
    ActorPhaseDialog.addHeaderControl({ document: actor({ hasPlayerOwner: true }) }, controls);
    installGame({ isGM: false });
    ActorPhaseDialog.addHeaderControl({ document: actor() }, controls);
    assert.equal(controls.length, 1);
  });

  it("lists Enemies first, then every creature phase, with the saved one checked (Enemies when it is gone)", () => {
    installGame({ isGM: true });
    const values = (a) => ActorPhaseDialog.choices(a).map((c) => [c.value, c.checked]);
    assert.deepEqual(values(actor()), [["", true], ["epicBoss", false], ["boss", false], ["miniBoss", false]]);
    assert.deepEqual(values(actor({ flags: { [KEY]: { defaultPhase: "boss" } } }))[2], ["boss", true]);
    assert.deepEqual(values(actor({ flags: { [KEY]: { defaultPhase: "deleted" } } }))[0], ["", true]);
  });

  it("saves the choice on the actor, and Enemies as no flag at all", async () => {
    installGame({ isGM: true });
    const answers = ["boss", ""];
    globalThis.foundry.applications.api.DialogV2 = { prompt: async () => answers.shift() };
    const dragon = actor();
    await ActorPhaseDialog.open(dragon);
    await ActorPhaseDialog.open(dragon);
    assert.deepEqual(dragon.updates, [{ [`flags.${KEY}.defaultPhase`]: "boss" }, { [`flags.${KEY}.defaultPhase`]: null }]);
  });
});
