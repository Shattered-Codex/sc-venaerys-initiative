import assert from "node:assert/strict";
import { describe, it } from "node:test";
import CombatPhaseProjector from "../scripts/services/CombatPhaseProjector.js";
import InitiativeRoller from "../scripts/services/InitiativeRoller.js";
import RollPrompter from "../scripts/services/RollPrompter.js";
import { combatView, enemy, player } from "./helpers/combat-view.js";
import { fakeCombat, fakeCombatant, installGame, manualFrames } from "./helpers/fake-combat.js";

/** Ana (owned by this player) and Bruno have not rolled; Caio has; a goblin never rolls. */
function encounter() {
  const ana = fakeCombatant({ id: "ana", isOwner: true, hasPlayerOwner: true, flags: { side: "players", phase: null } });
  const bruno = fakeCombatant({ id: "bruno", hasPlayerOwner: true, flags: { side: "players", phase: null } });
  const caio = fakeCombatant({ id: "caio", initiative: 17, isOwner: true, hasPlayerOwner: true, flags: { side: "players", phase: "fast" } });
  const goblin = fakeCombatant({ id: "goblin", initiative: 12, flags: { side: "enemies", phase: "enemies" } });
  const fresh = fakeCombatant({ id: "fresh", isOwner: true, hasPlayerOwner: true });
  return fakeCombat({ round: 0, combatants: [caio, goblin, ana, bruno, fresh] });
}

function rollerWith() {
  const rolled = [];
  const roller = new InitiativeRoller({ adapter: { hasSystemRoll: true, defaultFormula: () => "1d20", rollInitiative: async (_combat, ids) => rolled.push(ids) } });
  return { roller, rolled };
}

describe("InitiativeRoller", () => {
  it("rolls a player's own characters still without a roll, a new one included, and nobody else's", async () => {
    installGame({ isGM: false });
    const { roller, rolled } = rollerWith();
    const combat = encounter();
    assert.equal(await roller.rollOwn(combat), true);
    assert.deepEqual(rolled, [["ana", "fresh"]]);
    assert.equal(await roller.roll(combat, ["bruno", "caio", "goblin"]), false);
    assert.equal(await roller.rollAll(combat), false);
    assert.equal(rolled.length, 1);
  });

  it("lets a GM roll for anyone still waiting, but never rerolls or rolls enemies", async () => {
    installGame({ isGM: true });
    const { roller, rolled } = rollerWith();
    const combat = encounter();
    assert.equal(await roller.rollAll(combat), true);
    assert.deepEqual(rolled, [["ana", "bruno", "fresh"]]);
    assert.equal(await roller.roll(combat, ["caio", "goblin"]), false);
  });

  it("does not start a second roll for the same combatant while the first is pending", async () => {
    installGame({ isGM: false });
    let finish;
    const pending = new Promise((resolve) => { finish = resolve; });
    const calls = [];
    const roller = new InitiativeRoller({ adapter: {
      hasSystemRoll: true,
      rollInitiative: async (_combat, ids) => { calls.push(ids); await pending; },
    } });
    const combat = encounter();
    const first = roller.roll(combat, ["ana"]);
    assert.equal(await roller.roll(combat, ["ana"]), false);
    finish();
    assert.equal(await first, true);
    assert.deepEqual(calls, [["ana"]]);
  });

  it("can roll a character placed in Slow without a roll after the GM advances anyway", async () => {
    installGame({ isGM: false });
    const { roller, rolled } = rollerWith();
    const combat = encounter();
    combat.combatants.get("ana").flags["sc-venaerys-initiative"].phase = "slow";
    assert.equal(await roller.roll(combat, ["ana"]), true);
    assert.deepEqual(rolled, [["ana"]]);
  });

  it("does nothing in a combat without phases", async () => {
    installGame({ isGM: true });
    const { roller, rolled } = rollerWith();
    const combat = fakeCombat({ phased: false, combatants: [fakeCombatant({ id: "x", hasPlayerOwner: true })] });
    assert.equal(await roller.rollAll(combat), false);
    assert.deepEqual(rolled, []);
  });
});

describe("RollPrompter", () => {
  function setup({ isGM = false, enabled = true, answer = "roll" } = {}) {
    const recorded = installGame({ isGM });
    const combat = encounter();
    globalThis.game.combat = combat;
    globalThis.game.combats.get = (id) => (id === combat.id ? combat : undefined);
    const { roller, rolled } = rollerWith();
    const frames = manualFrames();
    const prompter = new RollPrompter({ roller, enabled: () => enabled, requestFrame: frames.requestFrame });
    const asked = [];
    prompter.ask = async (names) => {
      asked.push(names);
      return answer;
    };
    return { recorded, combat, prompter, rolled, asked, frames };
  }

  it("asks a player once per character and rolls what they agree to", async () => {
    const { combat, prompter, rolled, asked, frames } = setup();
    prompter.onCreateCombatant(combat.combatants.get("fresh"));
    prompter.onCreateCombatant(combat.combatants.get("ana"));
    await frames.run();
    assert.deepEqual(asked, [["ana", "fresh"]]);
    assert.deepEqual(rolled, [["ana", "fresh"]]);
    prompter.queue(combat);
    await frames.run();
    assert.equal(asked.length, 1);
  });

  it("leaves the roll for later when the player says so, and asks again only for new characters", async () => {
    const { combat, prompter, rolled, asked, frames } = setup({ answer: "later" });
    prompter.queue(combat);
    await frames.run();
    assert.deepEqual(rolled, []);
    combat.turns.push(Object.assign(fakeCombatant({ id: "late", isOwner: true, hasPlayerOwner: true }), { parent: combat }));
    prompter.onCreateCombatant(combat.combatants.get("late"));
    await frames.run();
    assert.deepEqual(asked, [["ana", "fresh"], ["late"]]);
  });

  it("never asks a GM, nor a player who turned it off, and asks when the GM turns phases on", async () => {
    for (const options of [{ isGM: true }, { enabled: false }]) {
      const { combat, prompter, asked, frames } = setup(options);
      prompter.queue(combat);
      await frames.run();
      assert.deepEqual(asked, [], JSON.stringify(options));
    }
    const { combat, prompter, asked, frames } = setup();
    prompter.onUpdateCombat(combat, { flags: { "sc-venaerys-initiative": { dc: { value: 12 } } } });
    await frames.run();
    assert.deepEqual(asked, []);
    prompter.onUpdateCombat(combat, { flags: { "sc-venaerys-initiative": { enabled: true } } });
    await frames.run();
    assert.equal(asked.length, 1);
  });
});

describe("the DC and the roll in the tracker", () => {
  const options = { localize: (key) => key, format: (key, data) => `${key}${JSON.stringify(data)}`, decimals: 2 };
  const settings = { showDcToPlayers: true, autoAdvance: true };

  it("names a DC the system reads as a level, and warns only the GM when the system's roll cannot place anyone", () => {
    const view = combatView({ round: 0, dc: 2, combatants: [player("ana", null)] });
    const named = CombatPhaseProjector.project(view, { isGM: false }, settings, { ...options, dcName: (dc) => (dc === 2 ? "Hard" : null) });
    assert.equal(named.dc.text, 'SC_VENAERYS_INITIATIVE.Tracker.DcNamed{"dc":2,"name":"Hard"}');
    const gm = CombatPhaseProjector.project(view, { isGM: true }, settings, { ...options, rollProblem: "Switch the rule" });
    assert.ok(gm.gm.warnings.some((w) => w.hint === "Switch the rule"));
    assert.equal(CombatPhaseProjector.project(view, { isGM: true }, settings, options).gm.warnings.some((w) => w.icon === "fa-solid fa-dice-d20"), false);
  });
});

describe("roll prompt pictures", () => {
  it("shows the token or the sheet's portrait as set, never a video, and always something", () => {
    const hero = { img: "token.webp", token: { texture: { src: "token.webp" } }, actor: { img: "portrait.webp" } };
    assert.equal(RollPrompter.imageOf(hero, "token"), "token.webp");
    assert.equal(RollPrompter.imageOf(hero, "portrait"), "portrait.webp");
    assert.equal(RollPrompter.imageOf({ token: { texture: { src: "spin.webm" } }, img: "spin.webm", actor: { img: "portrait.webp" } }, "token"), "portrait.webp");
    assert.equal(RollPrompter.imageOf({ img: "only.webp" }, "portrait"), "only.webp");
    assert.equal(RollPrompter.imageOf({}, "token"), "icons/svg/mystery-man.svg");
  });
});

describe("roll buttons in the tracker", () => {
  const options = { localize: (key) => key, format: (key, data) => `${key}${JSON.stringify(data)}`, decimals: 2 };
  const settings = { showDcToPlayers: false, autoAdvance: true };

  it("give the owner and the GM a roll button on a waiting character, and the GM a 'Roll for them' while the start waits", () => {
    const view = combatView({ round: 1, on: "boss", combatants: [enemy("boss", "boss"), player("ana", null, { isOwner: true }), player("bruno", null)] });
    const forPlayer = CombatPhaseProjector.project(view, { isGM: false }, settings, options);
    assert.match(forPlayer.pending.find((p) => p.id === "ana").rollButton.label, /Tracker\.RollFor/);
    assert.deepEqual([forPlayer.pending.find((p) => p.id === "bruno").rollButton, forPlayer.pending.find((p) => p.id === "bruno").awaiting], [null, true]);
    assert.equal(forPlayer.youPending, true);
    assert.equal(forPlayer.rollPlayers, null);
    const forGm = CombatPhaseProjector.project(view, { isGM: true }, settings, options);
    assert.ok(forGm.pending.every((p) => p.rollButton && p.select && !p.doneButton));
    assert.deepEqual(forGm.rollPlayers, { label: "SC_VENAERYS_INITIATIVE.Tracker.RollPlayers", disabled: false });
    const wait = forGm.gm.warnings.find((w) => w.action?.name === "advance");
    assert.equal(wait?.roll.label, "SC_VENAERYS_INITIATIVE.Gm.RollForThem");
  });

  it("keeps the module roll available after an unrolled character is placed in Slow", () => {
    const view = combatView({ round: 1, on: "slow", combatants: [player("ana", null, { isOwner: true, phase: "slow" })] });
    assert.equal(CombatPhaseProjector.project(view, { isGM: true }, settings, options).rollPlayers.disabled, false);
    const rolled = combatView({ round: 1, on: "slow", combatants: [player("ana", 12, { phase: "slow" })] });
    assert.equal(CombatPhaseProjector.project(rolled, { isGM: true }, settings, options).rollPlayers.disabled, true);
    const model = CombatPhaseProjector.project(view, { isGM: false }, settings, options);
    const slow = model.phases.find((phase) => phase.id === "slow");
    assert.ok(slow.rows.find((row) => row.id === "ana")?.rollButton);
  });
});
