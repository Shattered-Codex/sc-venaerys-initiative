import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Dnd5eAdapter from "../scripts/services/adapters/Dnd5eAdapter.js";
import CombatantClassifier from "../scripts/services/CombatantClassifier.js";
import DcSuggester from "../scripts/services/DcSuggester.js";
import PhasePlacementWriter from "../scripts/services/PhasePlacementWriter.js";
import { fakeCombat, fakeCombatant, installGame, manualFrames } from "./helpers/fake-combat.js";

const KEY = "sc-venaerys-initiative";
const npc = (id, cr, flags = { side: "enemies", phase: "enemies" }) =>
  fakeCombatant({ id, initiative: 12, flags, actor: { type: "npc", system: { details: { cr }, attributes: { init: { score: 12 } } } } });
const baseCr = (extra = {}) => ({ dc: { value: 10, source: "baseCr", base: 10, referenceCr: null, ...extra } });

function setup({ round = 0, flags = baseCr(), combatants = [], isActiveGM = true } = {}) {
  const combat = fakeCombat({ round, turn: round ? 0 : null, flags, combatants });
  installGame({ isActiveGM, combats: [combat] });
  const adapter = new Dnd5eAdapter();
  const writer = new PhasePlacementWriter({ adapter, advance: async () => {} });
  const classifier = new CombatantClassifier({ adapter, writer });
  const frames = manualFrames();
  const suggester = new DcSuggester({ adapter, classifier, base: () => 10, requestFrame: frames.requestFrame });
  return { combat, suggester, frames };
}

const dcOf = (combat) => combat.flags[KEY].dc;

describe("DcSuggester", () => {
  it("follows the combatants before the start", async () => {
    const ogre = npc("ogre", 2);
    const { combat, suggester, frames } = setup({ combatants: [ogre] });
    suggester.onCombatantChange(ogre);
    await frames.run();
    assert.deepEqual(dcOf(combat), { value: 12, source: "baseCr", base: 10, referenceCr: 2 });
  });

  it("writes nothing when the DC already matches", async () => {
    const ogre = npc("ogre", 2);
    const { combat, suggester, frames } = setup({ flags: baseCr({ value: 12, referenceCr: 2 }), combatants: [ogre] });
    suggester.onCombatantChange(ogre);
    await frames.run();
    assert.equal(combat.writes("update").length, 0);
  });

  it("freezes at the start, stops on a typed DC and leaves other GMs alone", async () => {
    for (const options of [{ round: 1 }, { flags: { dc: { value: 15, source: "manual" } } }, { isActiveGM: false }]) {
      const ogre = npc("ogre", 2);
      const { combat, suggester, frames } = setup({ ...options, combatants: [ogre] });
      suggester.onCombatantChange(ogre);
      await frames.run();
      assert.equal(combat.writes("update").length, 0, JSON.stringify(options));
    }
  });

  it("counts the combatants that entered before the phases were turned on", async () => {
    const ogre = npc("ogre", 5);
    const { combat, suggester, frames } = setup({ combatants: [ogre] });
    suggester.onUpdateCombat(combat, { flags: { [KEY]: { enabled: true } } });
    await frames.run();
    assert.equal(dcOf(combat).value, 15);
  });

  it("recalculates on command after the start and turns a typed DC back to Base + CR", async () => {
    const ogre = npc("ogre", 4);
    const ana = fakeCombatant({ id: "ana", initiative: 13, hasPlayerOwner: true, flags: { side: "players", phase: "fast" } });
    const { combat, suggester } = setup({ round: 2, flags: { dc: { value: 12, source: "manual" } }, combatants: [ogre, ana] });
    await suggester.recalculate(combat);
    assert.deepEqual(dcOf(combat), { value: 14, source: "baseCr", base: 10, referenceCr: 4 });
    // Ana's 13 no longer meets the DC; she is already acting, so the move waits for the next round.
    assert.equal(ana.flags[KEY].nextPhase ?? ana.flags[KEY].phase, "slow");
  });
});
