import assert from "node:assert/strict";
import { describe, it } from "node:test";
import TurnInterceptor from "../scripts/services/TurnInterceptor.js";
import { fakeCombat, fakeCombatant, installGame, settle } from "./helpers/fake-combat.js";

const KEY = "sc-venaerys-initiative";
const p = (id, phase, initiative, flags = {}) => fakeCombatant({ id, initiative, flags: { side: "players", phase, ...flags } });

function build(combat, game = {}) {
  const recorded = installGame({ combats: [combat], ...game });
  const commands = [];
  const marks = [];
  const interceptor = new TurnInterceptor({
    adapter: null,
    commands: { execute: async (action, c, payload) => commands.push([action, payload]) },
    doneMarkers: { markOwn: async (c) => marks.push(c.id) },
  });
  return { interceptor, commands, marks, recorded };
}

describe("TurnInterceptor", () => {
  it("intercepts native navigation before its round or turn hook fires", async () => {
    const combat = fakeCombat({ round: 2, combatants: [p("a", "fast", 18)] });
    const { interceptor, commands } = build(combat);
    const nativeCalls = [];
    const proto = Object.fromEntries(["nextTurn", "nextRound", "previousTurn", "previousRound"].map((name) => [name, function () {
      nativeCalls.push(name);
      return this;
    }]));
    const previousClass = CONFIG.Combat.documentClass;
    CONFIG.Combat.documentClass = { prototype: proto };
    try {
      interceptor.install();
      await proto.nextTurn.call(combat);
      await proto.nextRound.call(combat);
      await proto.previousTurn.call(combat);
      await proto.previousRound.call(combat);
      assert.deepEqual(nativeCalls, []);
      assert.deepEqual(commands, [["advance", { force: true }], ["advance", { force: true }], ["back", {}], ["back", {}]]);
      const off = fakeCombat({ phased: false, round: 2, combatants: [p("a", "fast", 18)] });
      await proto.nextTurn.call(off);
      assert.deepEqual(nativeCalls, ["nextTurn"]);
    } finally {
      CONFIG.Combat.documentClass = previousClass;
    }
  });

  it("routes round-zero navigation through the guarded start before a native round hook", async () => {
    const combat = fakeCombat({ round: 0, turn: null, combatants: [p("a", "fast", 18)] });
    const { interceptor } = build(combat);
    const proto = { nextTurn() { throw new Error("native round hook ran"); } };
    const previousClass = CONFIG.Combat.documentClass;
    CONFIG.Combat.documentClass = { prototype: proto };
    try {
      interceptor.install();
      await proto.nextTurn.call(combat);
      assert.equal(combat.writes("startCombat").length, 1);
    } finally {
      CONFIG.Combat.documentClass = previousClass;
    }
  });

  it("cancels the GM's next turn and advances the phase, forced", async () => {
    const combat = fakeCombat({ round: 2, combatants: [p("a", "fast", 18)] });
    const { interceptor, commands } = build(combat);
    assert.equal(interceptor.onPreUpdateCombat(combat, { round: 2, turn: 1 }, { direction: 1 }), false);
    await settle();
    assert.deepEqual(commands, [["advance", { force: true }]]);
  });

  it("cancels the GM's previous turn and goes back", async () => {
    const combat = fakeCombat({ round: 2, combatants: [p("a", "fast", 18)] });
    const { interceptor, commands } = build(combat);
    assert.equal(interceptor.onPreUpdateCombat(combat, { round: 1, turn: 0 }, { direction: -1 }), false);
    await settle();
    assert.deepEqual(commands, [["back", undefined]]);
  });

  it("turns a player's end turn into done marks, and a player going back into a warning only", async () => {
    const combat = fakeCombat({ round: 2, combatants: [p("a", "fast", 18)] });
    const { interceptor, marks, recorded, commands } = build(combat, { isGM: false });
    assert.equal(interceptor.onPreUpdateCombat(combat, { turn: 1 }, { direction: 1 }), false);
    assert.equal(interceptor.onPreUpdateCombat(combat, { turn: 0 }, { direction: -1 }), false);
    await settle();
    assert.deepEqual(marks, ["combat"]);
    assert.deepEqual(recorded.warnings, ["SC_VENAERYS_INITIATIVE.Notifications.OnlyGmBack"]);
    assert.equal(commands.length, 0);
  });

  it("turns next turn in round 0 into startCombat, marking nothing", async () => {
    const combat = fakeCombat({ round: 0, turn: null, combatants: [p("a", "fast", 18)] });
    const { interceptor, marks } = build(combat, { isGM: false });
    assert.equal(interceptor.onPreUpdateCombat(combat, { round: 1, turn: null }, { direction: 1 }), false);
    await settle();
    assert.deepEqual(combat.writes("startCombat").length, 1);
    assert.deepEqual(marks, []);
  });

  it("lets everything else through", () => {
    const combat = fakeCombat({ round: 2, combatants: [p("a", "fast", 18)] });
    const { interceptor } = build(combat);
    assert.equal(interceptor.onPreUpdateCombat(combat, { turn: 0 }, {}), undefined);
    assert.equal(interceptor.onPreUpdateCombat(combat, { turn: 0 }, { direction: 1, [KEY]: { reason: "advance" } }), undefined);
    const off = fakeCombat({ phased: false, round: 2, combatants: [p("a", "fast", 18)] });
    assert.equal(interceptor.onPreUpdateCombat(off, { turn: 0 }, { direction: 1 }), undefined);
  });

  it("keeps the pointer in its phase when the combatant under it is deleted and others stay", () => {
    const combat = fakeCombat({ round: 2, combatants: [p("a", "fast", 18), p("b", "fast", 16), p("c", "fast", 14), p("s", "slow", 3)] });
    combat.turn = 2;
    const { interceptor } = build(combat);
    const options = {};
    interceptor.onPreDeleteCombatant(combat.combatants.get("c"), options);
    assert.deepEqual(options, { combatTurn: 1, turnEvents: false });
    const alone = {};
    combat.turn = 3;
    interceptor.onPreDeleteCombatant(combat.combatants.get("s"), alone);
    assert.deepEqual(alone, {});
    const notPointer = {};
    interceptor.onPreDeleteCombatant(combat.combatants.get("a"), notPointer);
    assert.deepEqual(notPointer, {});
  });
});
