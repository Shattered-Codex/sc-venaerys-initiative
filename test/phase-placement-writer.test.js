import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import PhasePlacementWriter from "../scripts/services/PhasePlacementWriter.js";
import { fakeCombat, fakeCombatant, installGame } from "./helpers/fake-combat.js";

const KEY = "sc-venaerys-initiative";
const p = (id, phase, initiative = 15, flags = {}) => fakeCombatant({ id, initiative, flags: { side: "players", phase, ...flags } });

describe("PhasePlacementWriter", () => {
  beforeEach(() => installGame());

  it("writes one batch with the module option and unpins automatic placement", async () => {
    const combat = fakeCombat({ round: 2, combatants: [p("a", "fast", 18), p("b", "fast", 16), p("c", "slow", 9, { pinned: true })] });
    combat.turn = 1;
    const writer = new PhasePlacementWriter({ adapter: null, advance: async () => {} });
    await writer.apply(combat, [{ id: "c", target: "fast" }]);
    const [write] = combat.writes("embedded");
    assert.deepEqual(write.options, { [KEY]: { reason: "placement" } });
    assert.deepEqual(write.updates, [{ _id: "c", [`flags.${KEY}.phase`]: "fast", [`flags.${KEY}.nextPhase`]: null, [`flags.${KEY}.pinned`]: false }]);
  });

  it("pins on a GM assignment", async () => {
    const combat = fakeCombat({ round: 0, turn: null, combatants: [p("a", "fast")] });
    const writer = new PhasePlacementWriter({ adapter: null, advance: async () => {} });
    await writer.apply(combat, [{ id: "a", target: "boss" }], { pinned: true });
    assert.equal(combat.writes("embedded")[0].updates[0][`flags.${KEY}.pinned`], true);
  });

  it("moves the pointer in its own operation, keeping it in the current phase", async () => {
    const combat = fakeCombat({ round: 2, combatants: [p("a", "fast", 18), p("b", "fast", 16), p("c", "fast", 15), p("s", "slow", 3)] });
    combat.turn = 2; // c
    const writer = new PhasePlacementWriter({ adapter: null, advance: async () => assert.fail("no advance needed") });
    await writer.apply(combat, [{ id: "c", target: "slow" }, { id: "s", target: "fast" }]);
    const writes = combat.writes("embedded");
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[0].updates.map((u) => u._id), ["s"]);
    assert.deepEqual(writes[1].updates.map((u) => u._id), ["c"]);
    assert.equal(writes[1].options.turnEvents, false);
    assert.equal(combat.combatant.flags[KEY].phase, "fast");
    assert.equal(combat.combatant.id, "s");
  });

  it("advances first when the pointer would leave its phase empty", async () => {
    const combat = fakeCombat({ round: 2, combatants: [p("a", "fast", 18), fakeCombatant({ id: "g", initiative: 10, flags: { side: "enemies", phase: "enemies" } })] });
    combat.turn = 0;
    const order = [];
    const writer = new PhasePlacementWriter({
      adapter: null,
      advance: async (c) => {
        order.push("advance");
        c.turn = 1;
      },
    });
    await writer.apply(combat, [{ id: "a", target: "slow" }]);
    order.push(...combat.writes("embedded").map((w) => w.updates[0]._id));
    assert.deepEqual(order, ["advance", "a"]);
    assert.equal(combat.combatant.id, "g");
  });
});
