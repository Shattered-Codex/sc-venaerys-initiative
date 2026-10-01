import assert from "node:assert/strict";
import { describe, it } from "node:test";
import PhaseAdvancer from "../scripts/services/PhaseAdvancer.js";
import PhasePlacementWriter from "../scripts/services/PhasePlacementWriter.js";
import { fakeCombat, fakeCombatant, installGame } from "./helpers/fake-combat.js";

const KEY = "sc-venaerys-initiative";
const p = (id, phase, initiative, flags = {}) => fakeCombatant({ id, initiative, flags: { side: "players", phase, ...flags } });
const e = (id, phase, initiative = 10, flags = {}) => fakeCombatant({ id, initiative, flags: { side: "enemies", phase, ...flags } });

function build(combat, game = {}) {
  const recorded = installGame({ combats: [combat], ...game });
  const writer = new PhasePlacementWriter({ adapter: null, advance: (c, o) => advancer.advance(c, o) });
  const advancer = new PhaseAdvancer({ adapter: null, writer });
  return { advancer, recorded };
}

const at = (combat, id) => {
  combat.turn = combat.turns.findIndex((c) => c.id === id);
  return combat;
};

describe("PhaseAdvancer: advance", () => {
  it("mirrors nextTurn: the hook first, then one update with direction, world time and the module option", async () => {
    const combat = at(fakeCombat({ round: 2, combatants: [p("a", "fast", 18, { done: 2 }), e("g", "enemies"), e("h", "enemies", 9)] }), "a");
    const { advancer, recorded } = build(combat);
    assert.equal(await advancer.advance(combat), true);
    const [hook] = recorded.hooks;
    assert.equal(hook[0], "combatTurn");
    const [write] = combat.writes("update");
    assert.deepEqual(write.data, { round: 2, turn: 2 });
    assert.deepEqual(write.options, { direction: 1, worldTime: { delta: 0 }, [KEY]: { reason: "advance" } });
    assert.equal("turnEvents" in write.options, false);
    assert.equal(combat.combatant.id, "h");
  });

  it("clears a suspension in the same write", async () => {
    const combat = at(fakeCombat({ round: 2, flags: { suspendedAdvance: "2:fast" }, combatants: [p("a", "fast", 18, { done: 2 }), e("g", "enemies")] }), "a");
    const { advancer } = build(combat);
    await advancer.advance(combat);
    assert.equal(combat.writes("update")[0].data[`flags.${KEY}.suspendedAdvance`], null);
  });

  it("writes once for two requests on the same phase and drops a stale one", async () => {
    const combat = at(fakeCombat({ round: 2, combatants: [p("a", "fast", 18, { done: 2 }), e("g", "enemies")] }), "a");
    const { advancer } = build(combat);
    const key = PhaseAdvancer.keyOf({ round: 2, turn: 0, started: true, plan: combat.flags[KEY].plan, combatants: [{ phase: "fast" }] });
    await Promise.all([advancer.advance(combat, { expectedKey: key }), advancer.advance(combat, { expectedKey: key })]);
    assert.equal(combat.writes("update").length, 1);
    assert.equal(await advancer.advance(combat, { expectedKey: key }), false);
  });

  it("releases the lock on its own after five seconds when the write never comes back", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const combat = at(fakeCombat({ round: 2, combatants: [p("a", "fast", 18, { done: 2 }), e("g", "enemies")] }), "a");
    const { advancer } = build(combat);
    combat.update = () => new Promise(() => {});
    advancer.advance(combat);
    await Promise.resolve();
    assert.equal(advancer.isLocked(combat.id, "2:fast"), true);
    t.mock.timers.tick(5000);
    assert.equal(advancer.isLocked(combat.id, "2:fast"), false);
  });

  it("turns the round: deferred phases first, then combatRound and one update with round and turn", async () => {
    const combat = at(
      fakeCombat({ round: 2, combatants: [p("a", "fast", 18, { done: 2, nextPhase: "slow" }), e("g", "enemies", 10, { done: 2 }), p("s", "slow", 5, { done: 2 })] }),
      "s",
    );
    const { advancer, recorded } = build(combat);
    await advancer.advance(combat);
    const calls = combat.calls.filter((c) => c.type !== "setupTurns").map((c) => c.type);
    assert.deepEqual(calls, ["embedded", "update"]);
    assert.equal(combat.writes("embedded")[0].options.combatTurn, undefined);
    assert.equal(recorded.hooks[0][0], "combatRound");
    const [write] = combat.writes("update");
    assert.deepEqual(write.data, { round: 3, turn: 0 });
    assert.equal(write.options.worldTime.delta, 6);
    assert.equal(write.options[KEY].reason, "round");
    assert.equal(combat.combatant.id, "g");
  });

  it("parks the pointer on the last index with turn events off when the pointer itself moves at the round change", async () => {
    const combat = at(fakeCombat({ round: 2, combatants: [p("a", "fast", 18, { done: 2 }), p("s", "slow", 5, { done: 2, nextPhase: "fast" })] }), "s");
    const { advancer } = build(combat);
    await advancer.advance(combat);
    const [batch] = combat.writes("embedded");
    assert.equal(batch.options.combatTurn, 1);
    assert.equal(batch.options.turnEvents, false);
  });

  it("stops at the roll lock unless forced; forcing places the pending players in Slow, unpinned", async () => {
    const pending = fakeCombatant({ id: "caio", flags: { side: "players", phase: null } });
    const combat = at(fakeCombat({ round: 1, combatants: [e("boss", "boss", 10, { done: 1 }), e("g", "enemies"), pending] }), "boss");
    const { advancer } = build(combat);
    assert.equal(await advancer.advance(combat), false);
    assert.equal(combat.writes("update").length, 0);
    assert.equal(await advancer.advance(combat, { force: true }), true);
    assert.deepEqual([pending.flags[KEY].phase, pending.flags[KEY].pinned === true], ["slow", false]);
    assert.equal(combat.combatant.id, "g");
  });
});

describe("PhaseAdvancer: back", () => {
  it("goes back in the same round with direction -1 and suspends the phase", async () => {
    const combat = at(fakeCombat({ round: 2, combatants: [p("a", "fast", 18, { done: 2 }), p("b", "fast", 16, { done: 2 }), e("g", "enemies")] }), "g");
    const { advancer } = build(combat);
    await advancer.back(combat);
    const [write] = combat.writes("update");
    assert.equal(write.options.direction, -1);
    assert.equal(write.options[KEY].reason, "back");
    assert.equal(write.data[`flags.${KEY}.suspendedAdvance`], "2:fast");
    assert.equal(combat.combatant.id, "b");
    assert.equal(combat.combatants.get("a").flags[KEY].done, 2);
  });

  it("into the previous round, wipes the marks of the undone round before changing it", async () => {
    const combat = at(fakeCombat({ round: 2, combatants: [e("boss", "boss", 10, { done: 2 }), p("a", "fast", 18, { done: 1 })] }), "boss");
    const { advancer, recorded } = build(combat);
    await advancer.back(combat);
    const types = combat.calls.filter((c) => c.type !== "setupTurns").map((c) => c.type);
    assert.deepEqual(types, ["embedded", "update"]);
    assert.equal(combat.combatants.get("boss").flags[KEY].done, null);
    assert.equal(combat.combatants.get("a").flags[KEY].done, null);
    assert.equal(recorded.hooks[0][0], "combatRound");
    assert.equal(combat.round, 1);
  });

  it("refuses in round 1 with nothing earlier: no write, no hook", async () => {
    const combat = at(fakeCombat({ round: 1, combatants: [p("a", "fast", 18), e("g", "enemies")] }), "a");
    const { advancer, recorded } = build(combat);
    assert.equal(await advancer.back(combat), false);
    assert.equal(combat.writes("update").length, 0);
    assert.equal(recorded.hooks.length, 0);
  });
});

describe("PhaseAdvancer: anchor and start", () => {
  it("does not write when the pointer already rests where it should", async () => {
    const combat = at(fakeCombat({ round: 2, combatants: [p("a", "fast", 18), p("b", "fast", 16)] }), "b");
    const { advancer } = build(combat);
    assert.equal(await advancer.anchor(combat), false);
    at(combat, "a");
    assert.equal(await advancer.anchor(combat), true);
    assert.equal(combat.writes("update")[0].options[KEY].reason, "anchor");
  });

  it("after the native start, places whoever is still pending in Slow and moves to the first phase", async () => {
    const pending = fakeCombatant({ id: "caio", flags: { side: "players", phase: null } });
    const combat = fakeCombat({ round: 1, turn: 0, combatants: [p("a", "fast", 18), p("b", "fast", 16), e("g", "enemies"), pending] });
    const { advancer } = build(combat);
    await advancer.afterNativeStart(combat);
    assert.equal(pending.flags[KEY].phase, "slow");
    assert.notEqual(pending.flags[KEY].pinned, true);
    const [write] = combat.writes("update");
    assert.equal(write.options[KEY].reason, "start");
    assert.equal(combat.combatant.id, "b");
  });

  it("leaves pending players alone when a boss phase comes first", async () => {
    const pending = fakeCombatant({ id: "caio", flags: { side: "players", phase: null } });
    const combat = fakeCombat({ round: 1, turn: 0, combatants: [e("boss", "boss"), p("a", "fast", 18), pending] });
    const { advancer } = build(combat);
    await advancer.afterNativeStart(combat);
    assert.equal(pending.flags[KEY].phase, null);
    assert.equal(combat.writes("update").length, 0);
  });

  it("completes a phase: one batch of marks, then one advance", async () => {
    const combat = at(fakeCombat({ round: 2, combatants: [e("k1", "enemies", 9), e("k2", "enemies", 8), p("s", "slow", 3)] }), "k2");
    const { advancer } = build(combat);
    await advancer.complete(combat);
    assert.equal(combat.writes("embedded").length, 1);
    assert.equal(combat.writes("update").length, 1);
    assert.equal(combat.combatant.id, "s");
  });
});
