import assert from "node:assert/strict";
import { describe, it } from "node:test";
import DoneMarkers from "../scripts/services/DoneMarkers.js";
import { fakeCombat, fakeCombatant, installGame } from "./helpers/fake-combat.js";

const KEY = "sc-venaerys-initiative";

function combatWith({ round = 2 } = {}) {
  const ana = fakeCombatant({ id: "ana", initiative: 18, isOwner: true, flags: { side: "players", phase: "fast" } });
  const bruno = fakeCombatant({ id: "bruno", initiative: 16, flags: { side: "players", phase: "fast" } });
  const boss = fakeCombatant({ id: "boss", initiative: 10, isOwner: true, flags: { side: "enemies", phase: "boss", done: round } });
  const slow = fakeCombatant({ id: "slow", initiative: 3, flags: { side: "players", phase: "slow" } });
  const pending = fakeCombatant({ id: "pend", isOwner: true, flags: { side: "players", phase: null } });
  const combat = fakeCombat({ round, combatants: [boss, ana, bruno, slow, pending] });
  combat.turn = combat.turns.indexOf(bruno);
  return combat;
}

describe("DoneMarkers", () => {
  it("lets the owner mark their own combatant in the current phase, with the round number", async () => {
    const combat = combatWith();
    installGame({ isGM: false });
    assert.equal(await new DoneMarkers({ adapter: null }).setDone(combat, "ana", true), true);
    const [write] = combat.combatants.get("ana").updates;
    assert.deepEqual(write.data, { [`flags.${KEY}.done`]: 2 });
    assert.equal(write.options[KEY].reason, "done");
  });

  it("refuses another player's combatant and a finished phase to players", async () => {
    const combat = combatWith();
    installGame({ isGM: false });
    const markers = new DoneMarkers({ adapter: null });
    assert.equal(await markers.setDone(combat, "bruno", true), false);
    assert.equal(await markers.setDone(combat, "boss", false), false);
  });

  it("lets any GM unmark a finished phase and skip a future one", async () => {
    const combat = combatWith();
    installGame({ isGM: true, isActiveGM: false });
    const markers = new DoneMarkers({ adapter: null });
    assert.equal(await markers.setDone(combat, "boss", false), true);
    assert.equal(await markers.setDone(combat, "slow", true), true);
    assert.equal(combat.combatants.get("slow").flags[KEY].done, 2);
  });

  it("refuses everyone, the GM included, in round 0 and on a pending combatant", async () => {
    installGame({ isGM: true });
    const markers = new DoneMarkers({ adapter: null });
    const combat = combatWith();
    assert.equal(await markers.setDone(combat, "pend", true), false);
    const notStarted = combatWith({ round: 0 });
    assert.equal(await markers.setDone(notStarted, "ana", true), false);
    assert.equal(notStarted.writes("embedded").length, 0);
  });

  it("marks a player's own combatants of the current phase on their end turn", async () => {
    const combat = combatWith();
    installGame({ isGM: false });
    assert.equal(await new DoneMarkers({ adapter: null }).markOwn(combat), true);
    const [write] = combat.writes("embedded");
    assert.deepEqual(write.updates.map((u) => u._id), ["ana"]);
  });

  it("marks, for a GM, the combatants of the current phase no player owns", async () => {
    const combat = combatWith();
    for (const c of combat.turns) c.isOwner = true;
    combat.combatants.get("ana").hasPlayerOwner = true;
    installGame({ isGM: true });
    assert.equal(await new DoneMarkers({ adapter: null }).markOwn(combat), true);
    assert.deepEqual(combat.writes("embedded")[0].updates.map((u) => u._id), ["bruno"]);
  });

  it("completes a group in one write: only the current phase's living members not yet done, and only for a GM", async () => {
    const kobold = (id, extra = {}) => fakeCombatant({ id, initiative: 0, flags: { side: "enemies", phase: "enemies" }, ...extra });
    const combat = fakeCombat({ round: 2, combatants: [kobold("k1"), kobold("k2", { flags: { side: "enemies", phase: "enemies", done: 2 } }), kobold("k3", { isDefeated: true }), kobold("k4")] });
    combat.turn = combat.turns.indexOf(combat.combatants.get("k4"));
    installGame({ isGM: false });
    const markers = new DoneMarkers({ adapter: null });
    assert.equal(await markers.markGroup(combat, ["k1", "k2", "k3", "k4"]), false);
    installGame({ isGM: true, isActiveGM: false });
    assert.equal(await markers.markGroup(combat, ["k1", "k2", "k3", "k4"]), true);
    const writes = combat.writes("embedded");
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].updates, [{ _id: "k1", [`flags.${KEY}.done`]: 2 }, { _id: "k4", [`flags.${KEY}.done`]: 2 }]);
    assert.equal(writes[0].options.render, false);
    assert.equal(await markers.markGroup(combat, ["k1", "k4"]), false);
  });
});
