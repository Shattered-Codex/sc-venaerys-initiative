import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extraTurnChanges, extraTurnPhase, withoutExtraTurns } from "../scripts/helpers/extra-turns.js";
import { roundStartTarget } from "../scripts/helpers/phase-progression.js";
import { visibleCombat } from "../scripts/helpers/phase-visibility.js";
import CombatPhaseProjector from "../scripts/services/CombatPhaseProjector.js";
import ExtraTurns from "../scripts/services/ExtraTurns.js";
import { combatView, enemy, player } from "./helpers/combat-view.js";
import { fakeCombat, fakeCombatant, installGame, manualFrames } from "./helpers/fake-combat.js";

const critical = (id, phase, overrides = {}) => player(id, phase, { natural: "critical", initiative: 22, ...overrides });
const extra = (id, of, phase, overrides = {}) => player(id, phase, { extraTurnOf: of, pinned: true, initiative: 22, ...overrides });
const ON = { rounds: "firstRound" };
const ALWAYS = { rounds: "everyRound" };
const OFF = { rounds: "off" };

describe("extra turn of a critical", () => {
  it("gives a critical player a turn in the other players' phase, from the roll before the start through round 1", () => {
    for (const round of [0, 1]) {
      const view = combatView({ round, combatants: [critical("a", "fast"), player("b", "slow")] });
      assert.deepEqual(extraTurnChanges(view, ON), { create: [{ originId: "a", phase: "slow", initiative: 22 }], update: [], remove: [] });
    }
    assert.equal(extraTurnPhase(critical("c", "slow")), "fast");
  });

  it("gives none without the option, to enemies, without a critical, to the pending, or to an extra turn itself", () => {
    const view = combatView({
      combatants: [critical("a", "fast"), enemy("g", "enemies", { natural: "critical" }), player("b", "fast"), critical("p", null), extra("x", "a", "slow", { natural: "critical" })],
    });
    assert.deepEqual(extraTurnChanges(view, OFF).create, []);
    assert.deepEqual(extraTurnChanges(view, ON).create, []);
  });

  it("follows its original: same initiative, the other phase, and gone with the critical or the original", () => {
    const synced = combatView({ combatants: [critical("a", "slow", { initiative: 25 }), extra("x", "a", "slow")] });
    assert.deepEqual(extraTurnChanges(synced, ON).update, [{ id: "x", phase: "fast", nextPhase: null, initiative: 25 }]);

    const lost = combatView({ combatants: [player("a", "fast", { initiative: 14 }), extra("x", "a", "slow"), extra("y", "gone", "slow")] });
    assert.deepEqual(extraTurnChanges(lost, ON).remove, ["x", "y"]);

    const twice = combatView({ combatants: [critical("a", "fast"), extra("x", "a", "slow"), extra("y", "a", "slow")] });
    assert.deepEqual(extraTurnChanges(twice, ON), { create: [], update: [], remove: ["y"] });
  });

  it("is hidden and defeated with its original, either way", () => {
    const hidden = combatView({ combatants: [critical("a", "fast", { hidden: true, isDefeated: true }), extra("x", "a", "slow")] });
    assert.deepEqual(extraTurnChanges(hidden, ON).update, [{ id: "x", hidden: true, defeated: true }]);
    const shown = combatView({ combatants: [critical("a", "fast"), extra("x", "a", "slow", { hidden: true, isDefeated: true })] });
    assert.deepEqual(extraTurnChanges(shown, ON).update, [{ id: "x", hidden: false, defeated: false }]);
  });

  it("follows a deferred move of its original next round, keeping the turn it still has this one", () => {
    // Ana acted in Fast; during Enemies the GM moves her to Slow from the next round.
    const view = combatView({ round: 1, on: "g", combatants: [critical("a", "fast", { done: 1, nextPhase: "slow" }), enemy("g"), extra("x", "a", "slow")] });
    assert.deepEqual(extraTurnChanges(view, ON).update, [{ id: "x", nextPhase: "fast" }]);
  });

  it("never changes phase under the pointer: it ends its turn and moves next round", () => {
    // The extra turn acts in Fast; the GM moves Ana from Slow to Fast, so the extra turn belongs in Slow.
    const combatants = [extra("x", "a", "fast"), critical("a", "fast"), player("b", "fast"), enemy("g")];
    assert.deepEqual(extraTurnChanges(combatView({ round: 1, on: "x", combatants }), ON).update, [{ id: "x", nextPhase: "slow" }]);
    const deferred = [extra("x", "a", "fast", { nextPhase: "slow" }), ...combatants.slice(1)];
    assert.deepEqual(extraTurnChanges(combatView({ round: 1, on: "x", combatants: deferred }), ON).update, []);
    assert.deepEqual(extraTurnChanges(combatView({ round: 1, on: "b", combatants }), ON).update, [{ id: "x", phase: "slow", nextPhase: null }]);
  });

  it("removes every extra turn once the combat leaves phases", () => {
    const view = combatView({ round: 0, enabled: false, combatants: [critical("a", "fast"), extra("x", "a", "slow")] });
    assert.deepEqual(extraTurnChanges(view, ALWAYS), { create: [], update: [], remove: ["x"] });
  });

  it("removes every extra turn from round 2, and with the option off, except the one the pointer rests on", () => {
    const combatants = [critical("a", "fast"), extra("x", "a", "slow"), critical("b", "fast"), extra("y", "b", "slow")];
    assert.deepEqual(extraTurnChanges(combatView({ round: 2, on: "a", combatants }), ON).remove, ["x", "y"]);
    assert.deepEqual(extraTurnChanges(combatView({ round: 1, on: "y", combatants }), OFF).remove, ["x"]);
  });

  it("removes the one under the pointer too when nobody else could take the turn", () => {
    const orphan = [extra("x", "gone", "slow")];
    assert.deepEqual(extraTurnChanges(combatView({ round: 1, on: "x", combatants: orphan }), ON).remove, ["x"]);
    assert.deepEqual(extraTurnChanges(combatView({ round: 3, on: "x", combatants: orphan }), ALWAYS).remove, ["x"]);
    const withDefeated = [extra("x", "gone", "slow"), enemy("g", "enemies", { isDefeated: true })];
    assert.deepEqual(extraTurnChanges(combatView({ round: 1, on: "x", combatants: withDefeated }), ON).remove, ["x"]);
    const withEnemy = [extra("x", "gone", "slow"), enemy("g")];
    assert.deepEqual(extraTurnChanges(combatView({ round: 1, on: "x", combatants: withEnemy }), ON).remove, []);
  });

  it("keeps them, and gives new ones, in every round with the option on every round", () => {
    const combatants = [critical("a", "fast"), extra("x", "a", "slow"), critical("b", "slow")];
    assert.deepEqual(extraTurnChanges(combatView({ round: 4, on: "a", combatants }), ALWAYS), { create: [{ originId: "b", phase: "fast", initiative: 22 }], update: [], remove: [] });
  });

  it("never starts the next round on an extra turn that goes with it", () => {
    const view = combatView({ round: 1, on: "a", combatants: [extra("x", "a", "fast"), enemy("g"), critical("a", "slow")] });
    assert.equal(roundStartTarget(view, 2).turn, 0);
    assert.equal(roundStartTarget(withoutExtraTurns(view, "firstRound"), 2).turn, 1);
    assert.equal(roundStartTarget(withoutExtraTurns(view, "everyRound"), 2).turn, 0);
  });
});

describe("ExtraTurns service", () => {
  const combatWith = (round, turn = 0) => {
    const origin = fakeCombatant({ id: "a", initiative: 22, flags: { side: "players", phase: "fast", natural: { value: "critical", initiative: 22 } } });
    const goblin = fakeCombatant({ id: "g", initiative: 12, flags: { side: "enemies", phase: "enemies" } });
    return fakeCombat({ round, turn, combatants: [origin, goblin] });
  };

  it("adds the extra turn for the same token on the active GM, and removes it once round 2 starts", async () => {
    const combat = combatWith(1);
    installGame({ combats: [combat] });
    const frames = manualFrames();
    const service = new ExtraTurns({ adapter: null, rounds: () => "firstRound", requestFrame: frames.requestFrame });

    service.mark(combat);
    await frames.run();
    const [created] = combat.writes("create");
    assert.deepEqual(created.data, [{
      tokenId: "token-a",
      sceneId: undefined,
      actorId: "actor-a",
      hidden: false,
      defeated: false,
      initiative: 22,
      flags: { "sc-venaerys-initiative": { side: "players", phase: "slow", pinned: true, extraTurnOf: "a" } },
    }]);
    assert.equal(created.options["sc-venaerys-initiative"].reason, "extraTurn");

    await combat.update({ round: 2, turn: 0 });
    service.mark(combat);
    await frames.run();
    assert.equal(combat.writes("delete").length, 1);
    assert.equal(combat.turns.some((c) => c.flags["sc-venaerys-initiative"].extraTurnOf), false);
  });

  it("removes the extra turn when the GM turns phases off", async () => {
    const extraTurn = fakeCombatant({ id: "x", initiative: 22, flags: { side: "players", phase: "slow", pinned: true, extraTurnOf: "a" } });
    const origin = fakeCombatant({ id: "a", initiative: 22, flags: { side: "players", phase: "fast", natural: { value: "critical", initiative: 22 } } });
    const combat = fakeCombat({ round: 0, turn: null, phased: false, combatants: [origin, extraTurn] });
    installGame({ combats: [combat] });
    const frames = manualFrames();
    const service = new ExtraTurns({ adapter: null, rounds: () => "firstRound", requestFrame: frames.requestFrame });

    service.mark(combat);
    await frames.run();
    assert.deepEqual(combat.turns.map((c) => c.id), ["a"]);
  });

  it("runs one pass at a time, so a slow creation is never made twice", async () => {
    const combat = combatWith(1);
    installGame({ combats: [combat] });
    const service = new ExtraTurns({ adapter: null, rounds: () => "firstRound", requestFrame: () => {} });
    const create = combat.createEmbeddedDocuments.bind(combat);
    let release;
    const answered = new Promise((resolve) => { release = resolve; });
    combat.createEmbeddedDocuments = async (...args) => { await answered; return create(...args); };

    service.mark(combat);
    const first = service.flush();
    service.mark(combat);
    const second = service.flush();
    release();
    await Promise.all([first, second]);
    assert.equal(combat.writes("create").length, 1);
    assert.equal(combat.turns.filter((c) => c.flags["sc-venaerys-initiative"].extraTurnOf === "a").length, 1);
  });

  it("skips its own writes, other clients, and the option off", async () => {
    const combat = combatWith(1);
    installGame({ combats: [combat], isActiveGM: false });
    const frames = manualFrames();
    const off = new ExtraTurns({ adapter: null, rounds: () => "off", requestFrame: frames.requestFrame });
    off.mark(combat);
    assert.equal(frames.size, 0);
    installGame({ combats: [combat] });
    off.mark(combat, { "sc-venaerys-initiative": { reason: "extraTurn" } });
    assert.equal(frames.size, 0);
    off.mark(combat);
    assert.equal(frames.size, 1);
    await frames.run();
    assert.deepEqual(combat.writes("create"), []);
  });
});

describe("defeated combatants in the tracker", () => {
  const view = combatView({ round: 1, on: "a", combatants: [player("a", "fast"), enemy("g"), enemy("h", "enemies", { isDefeated: true })] });
  const members = (options) => visibleCombat(view, { showDcToPlayers: false, ...options }).phases.find((p) => p.phase?.id === "enemies").members.map((c) => c.id);

  it("stay struck through by default, leave the players' view, or everyone's", () => {
    assert.deepEqual(members({ isGM: false }), ["g", "h"]);
    assert.deepEqual(members({ isGM: false, defeatedDisplay: "hidePlayers" }), ["g"]);
    assert.deepEqual(members({ isGM: true, defeatedDisplay: "hidePlayers" }), ["g", "h"]);
    assert.deepEqual(members({ isGM: true, defeatedDisplay: "hideAll" }), ["g"]);
  });
});

describe("an extra turn's row", () => {
  it("says why it is there and gives the GM no phase select or pin for it", () => {
    const view = combatView({ round: 1, on: "a", combatants: [critical("a", "fast"), extra("x", "a", "slow", { name: "Ana" })] });
    const model = CombatPhaseProjector.project(view, { isGM: true }, { showDcToPlayers: false, autoAdvance: true }, {
      localize: (key) => key,
      format: (key, data) => `${key}${JSON.stringify(data)}`,
    });
    const row = model.phases.find((p) => p.id === "slow").rows[0];
    assert.equal(row.select, null);
    assert.equal(row.pinned, false);
    assert.match(row.extraTurn.label, /Tracker\.ExtraTurnLabel.*"name":"Ana"/);
    assert.equal(model.phases.find((p) => p.id === "fast").rows[0].extraTurn, null);
  });
});
