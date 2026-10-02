import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import Dnd5eAdapter from "../scripts/services/adapters/Dnd5eAdapter.js";
import CombatSetup from "../scripts/services/CombatSetup.js";
import CombatantClassifier from "../scripts/services/CombatantClassifier.js";
import PhasePlacementWriter from "../scripts/services/PhasePlacementWriter.js";
import { fakeCombat, fakeCombatant, installGame, manualFrames } from "./helpers/fake-combat.js";

const KEY = "sc-venaerys-initiative";
const flagsOf = (c) => c.flags[KEY];

function setup(combat, game = {}) {
  installGame({ combats: [combat], ...game });
  const adapter = new Dnd5eAdapter();
  const writer = new PhasePlacementWriter({ adapter, advance: async () => {} });
  const frames = manualFrames();
  return { classifier: new CombatantClassifier({ adapter, writer, requestFrame: frames.requestFrame }), frames };
}

describe("CombatantClassifier", () => {
  it("puts an entering enemy in Enemies with its display initiative, in the same write", async () => {
    const goblin = fakeCombatant({ id: "g", initScore: 12 });
    const combat = fakeCombat({ round: 0, turn: null, combatants: [goblin] });
    const { classifier, frames } = setup(combat);
    classifier.onCreateCombatant(goblin);
    await frames.run();
    const [write] = combat.writes("embedded");
    assert.equal(write.updates.length, 1);
    assert.equal(write.updates[0].initiative, 12);
    assert.equal(write.updates[0][`flags.${KEY}.phase`], "enemies");
    assert.equal(write.updates[0][`flags.${KEY}.side`], "enemies");
  });

  it("leaves a player without a roll pending and classifies a player with one", async () => {
    const ana = fakeCombatant({ id: "ana", hasPlayerOwner: true });
    const bruno = fakeCombatant({ id: "bruno", hasPlayerOwner: true, initiative: 18 });
    const combat = fakeCombat({ round: 0, turn: null, combatants: [ana, bruno] });
    const { classifier, frames } = setup(combat);
    classifier.onCreateCombatant(ana);
    classifier.onCreateCombatant(bruno);
    await frames.run();
    assert.equal(frames.size, 0);
    assert.deepEqual([flagsOf(ana).side, flagsOf(ana).phase ?? null], ["players", null]);
    assert.deepEqual([flagsOf(bruno).side, flagsOf(bruno).phase], ["players", "fast"]);
  });

  it("does nothing on a client that is not the active GM", async () => {
    const goblin = fakeCombatant({ id: "g" });
    const combat = fakeCombat({ round: 0, turn: null, combatants: [goblin] });
    const { classifier, frames } = setup(combat, { isGM: true, isActiveGM: false });
    classifier.onCreateCombatant(goblin);
    await frames.run();
    assert.equal(combat.writes("embedded").length, 0);
  });

  it("re-reads everyone after Reset initiative: enemies get their value back, unpinned players go pending", async () => {
    const goblin = fakeCombatant({ id: "g", initScore: 11, flags: { side: "enemies", phase: "enemies" } });
    const ana = fakeCombatant({ id: "ana", flags: { side: "players", phase: "fast" } });
    const pinned = fakeCombatant({ id: "pin", flags: { side: "players", phase: "boss", pinned: true } });
    const combat = fakeCombat({ round: 0, turn: null, combatants: [goblin, ana, pinned] });
    const { classifier, frames } = setup(combat);
    classifier.onUpdateCombat(combat, { combatants: [] }, { diff: false, turnEvents: false });
    await frames.run();
    assert.equal(goblin.initiative, 11);
    assert.equal(flagsOf(ana).phase, null);
    assert.equal(flagsOf(pinned).phase, "boss");
  });

  it("ignores its own writes", async () => {
    const ana = fakeCombatant({ id: "ana", initiative: 3, flags: { side: "players", phase: "fast" } });
    const combat = fakeCombat({ round: 0, turn: null, combatants: [ana] });
    const { classifier, frames } = setup(combat);
    classifier.onUpdateCombatant(ana, { initiative: 3 }, { [KEY]: { reason: "placement" } });
    assert.equal(frames.size, 0);
    classifier.onUpdateCombatant(ana, { initiative: 3 }, {});
    await frames.run();
    assert.equal(flagsOf(ana).phase, "slow");
  });

  it("reclassifies when the natural of a roll arrives, with the GM's rules", async () => {
    const ana = fakeCombatant({ id: "ana", initiative: 17, flags: { side: "players", phase: "slow" } });
    const combat = fakeCombat({ round: 0, turn: null, flags: { dc: { value: 18, source: "manual" } }, combatants: [ana] });
    installGame({ combats: [combat] });
    const adapter = new Dnd5eAdapter();
    const writer = new PhasePlacementWriter({ adapter, advance: async () => {} });
    const frames = manualFrames();
    const rules = { natural20: "autoSuccess", natural1: "autoFail" };
    const classifier = new CombatantClassifier({ adapter, writer, naturals: () => rules, requestFrame: frames.requestFrame });
    flagsOf(ana).natural = { value: 20, initiative: 17 };
    const changes = { flags: { [KEY]: { natural: { value: 20, initiative: 17 } } } };
    classifier.onUpdateCombatant(ana, changes, { [KEY]: { reason: "placement" } });
    assert.equal(frames.size, 0, "only the natural write itself counts");
    classifier.onUpdateCombatant(ana, changes, { [KEY]: { reason: "natural" } });
    await frames.run();
    assert.equal(flagsOf(ana).phase, "fast");
  });

  it("sends an entering enemy to the phase its sheet suggests, only with the setting on", async () => {
    for (const [on, expected] of [[true, "boss"], [false, "enemies"]]) {
      const boss = fakeCombatant({ id: "b", initScore: 14, actor: { items: [{ name: "Boss" }], system: { attributes: { init: { score: 14 } } } } });
      const combat = fakeCombat({ round: 0, turn: null, combatants: [boss] });
      installGame({ combats: [combat] });
      game.i18n.localize = (key) => key.split(".").pop();
      const adapter = new Dnd5eAdapter();
      const writer = new PhasePlacementWriter({ adapter, advance: async () => {} });
      const frames = manualFrames();
      const classifier = new CombatantClassifier({ adapter, writer, suggestFromSheet: () => on, requestFrame: frames.requestFrame });
      classifier.onCreateCombatant(boss);
      await frames.run();
      assert.equal(flagsOf(boss).phase, expected, `setting ${on}`);
      assert.notEqual(flagsOf(boss).pinned, true);
    }
  });

  it("goes back to the suggested phase on Automatic", async () => {
    const boss = fakeCombatant({ id: "b", initiative: 14, flags: { side: "enemies", phase: "miniBoss", pinned: true }, actor: { items: [{ name: "Boss" }], system: { attributes: { init: { score: 14 } } } } });
    const combat = fakeCombat({ round: 0, turn: null, combatants: [boss] });
    installGame({ combats: [combat] });
    game.i18n.localize = (key) => key.split(".").pop();
    const adapter = new Dnd5eAdapter();
    const writer = new PhasePlacementWriter({ adapter, advance: async () => {} });
    const classifier = new CombatantClassifier({ adapter, writer, suggestFromSheet: () => true });
    await classifier.assign(combat, { combatantId: "b", phaseId: null });
    assert.deepEqual([flagsOf(boss).phase, flagsOf(boss).pinned], ["boss", false]);
  });

  it("keeps a typed DC inside the DC range", async () => {
    const combat = fakeCombat({ round: 0, turn: null, combatants: [] });
    const { classifier } = setup(combat);
    await classifier.setDc(combat, { value: 99 });
    assert.deepEqual(combat.flags[KEY].dc, { value: 40, source: "manual" });
  });

  it("reclassifies rolled, unpinned players on a new DC", async () => {
    const ana = fakeCombatant({ id: "ana", initiative: 16, flags: { side: "players", phase: "fast" } });
    const pinned = fakeCombatant({ id: "pin", initiative: 16, flags: { side: "players", phase: "fast", pinned: true } });
    const combat = fakeCombat({ round: 0, turn: null, combatants: [ana, pinned] });
    const { classifier } = setup(combat);
    await classifier.setDc(combat, { value: 17 });
    assert.deepEqual(combat.flags[KEY].dc, { value: 17, source: "manual" });
    assert.equal(combat.writes("update")[0].options[KEY].reason, "dc");
    assert.equal(flagsOf(ana).phase, "slow");
    assert.equal(flagsOf(pinned).phase, "fast");
  });

  it("pins on assignment and unpins with Automatic", async () => {
    const captain = fakeCombatant({ id: "cap", initiative: 10, flags: { side: "enemies", phase: "enemies" } });
    const combat = fakeCombat({ round: 0, turn: null, combatants: [captain] });
    const { classifier } = setup(combat);
    await classifier.assign(combat, { combatantId: "cap", phaseId: "boss" });
    assert.deepEqual([flagsOf(captain).phase, flagsOf(captain).pinned], ["boss", true]);
    await classifier.assign(combat, { combatantId: "cap", phaseId: "nope" });
    assert.equal(flagsOf(captain).phase, "boss");
    await classifier.assign(combat, { combatantId: "cap", phaseId: null });
    assert.deepEqual([flagsOf(captain).phase, flagsOf(captain).pinned], ["enemies", false]);
  });
});

describe("CombatSetup", () => {
  let recorded;
  beforeEach(() => {
    recorded = null;
  });

  it("writes the initial flags once, on the active GM, even with phases off", async () => {
    const combat = fakeCombat({ phased: false, round: 0, turn: null });
    recorded = installGame({ combats: [combat], settings: { enabledByDefault: false, defaultDc: 12 } });
    const setupService = new CombatSetup();
    await setupService.onCreateCombat(combat);
    const [write] = combat.writes("update");
    assert.equal(write.options[KEY].reason, "setup");
    assert.equal(combat.flags[KEY].enabled, false);
    assert.equal(combat.flags[KEY].plan.length, 7);
    assert.deepEqual(combat.flags[KEY].dc, { value: 12, source: "manual" });
    await setupService.onCreateCombat(combat);
    assert.equal(combat.writes("update").length, 1);
    assert.equal(recorded.warnings.length, 0);
  });

  it("skips clients that are not the active GM", async () => {
    const combat = fakeCombat({ phased: false, round: 0, turn: null });
    installGame({ combats: [combat], isActiveGM: false });
    await new CombatSetup().onCreateCombat(combat);
    assert.equal(combat.writes("update").length, 0);
  });

  it("toggles only before the start and never writes turn with it", async () => {
    const combat = fakeCombat({ round: 0, turn: null, flags: { enabled: false } });
    installGame({ combats: [combat] });
    await new CombatSetup().toggle(combat, { enabled: true });
    const [write] = combat.writes("update");
    assert.equal("turn" in write.data, false);
    assert.equal(combat.flags[KEY].enabled, true);
    combat.round = 1;
    await new CombatSetup().toggle(combat, { enabled: false });
    assert.equal(combat.writes("update").length, 1);
  });

  it("classifies everyone once phases turn on, including combatants created before the flags", async () => {
    const goblin = fakeCombatant({ id: "g", initScore: 9 });
    const ana = fakeCombatant({ id: "ana", hasPlayerOwner: true, initiative: 19 });
    const combat = fakeCombat({ round: 0, turn: null, combatants: [goblin, ana] });
    const { classifier } = setup(combat);
    await classifier.onUpdateCombat(combat, { flags: { [KEY]: { enabled: true } } }, { [KEY]: { reason: "setup" } });
    assert.equal(flagsOf(goblin).phase, "enemies");
    assert.equal(flagsOf(ana).phase, "fast");
  });
});
