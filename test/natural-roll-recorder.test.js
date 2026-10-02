import assert from "node:assert/strict";
import { describe, it } from "node:test";
import NaturalRollRecorder from "../scripts/services/NaturalRollRecorder.js";
import SystemAdapter from "../scripts/services/adapters/SystemAdapter.js";
import { fakeCombat, fakeCombatant, installGame } from "./helpers/fake-combat.js";

const KEY = "sc-venaerys-initiative";
const NATURAL = `flags.${KEY}.natural`;

function message({ author = "player", initiativeRoll = true, total = 17, natural = 20, speaker = { token: "token-ana" } } = {}) {
  return {
    author: { id: author },
    speaker,
    rolls: [{ total, dice: [{ faces: 20, results: [{ result: natural, active: true }] }] }],
    getFlag: (scope, key) => (scope === "core" && key === "initiativeRoll" ? initiativeRoll : undefined),
  };
}

function setup({ flags = {}, initiative = 17, isOwner = true, phased = true } = {}) {
  const ana = fakeCombatant({ id: "ana", initiative, isOwner, hasPlayerOwner: true, flags: { side: "players", phase: "slow", ...flags } });
  const combat = fakeCombat({ round: 0, turn: null, combatants: [ana], phased });
  installGame({ isGM: false, combats: [combat] });
  return { ana, combat, recorder: new NaturalRollRecorder({ adapter: new SystemAdapter() }) };
}

describe("NaturalRollRecorder", () => {
  it("writes the natural 20 of the author's own roll, tied to its total", async () => {
    const { ana, recorder } = setup();
    await recorder.onCreateChatMessage(message());
    assert.equal(ana.updates.length, 1);
    assert.deepEqual(ana.updates[0].data[NATURAL], { value: "critical", initiative: 17 });
    assert.deepEqual(ana.updates[0].options[KEY], { reason: "natural" });
  });

  it("finds the combatant by actor when the speaker has no token", async () => {
    const { ana, recorder } = setup();
    await recorder.onCreateChatMessage(message({ natural: 1, speaker: { actor: "actor-ana" } }));
    assert.deepEqual(ana.updates[0].data[NATURAL], { value: "fumble", initiative: 17 });
  });

  it("ignores other people's messages, other rolls, other totals and combatants it does not own", async () => {
    const cases = [
      [{}, message({ author: "gm" })],
      [{}, message({ initiativeRoll: false })],
      [{}, message({ total: 12 })],
      [{ isOwner: false }, message()],
      [{ phased: false }, message()],
    ];
    for (const [options, sent] of cases) {
      const { ana, recorder } = setup(options);
      await recorder.onCreateChatMessage(sent);
      assert.equal(ana.updates.length, 0, JSON.stringify(options));
    }
  });

  it("writes nothing for an ordinary roll, and clears a natural the same total would inherit", async () => {
    const fresh = setup();
    await fresh.recorder.onCreateChatMessage(message({ natural: 9 }));
    assert.equal(fresh.ana.updates.length, 0);

    const stale = setup({ flags: { natural: { value: 20, initiative: 17 } } });
    await stale.recorder.onCreateChatMessage(message({ natural: 9 }));
    assert.equal(stale.ana.updates[0].data[NATURAL], null);
  });

  it("does not write the same natural twice", async () => {
    const { ana, recorder } = setup({ flags: { natural: { value: "critical", initiative: 17 } } });
    await recorder.onCreateChatMessage(message());
    assert.equal(ana.updates.length, 0);
  });

  it("leaves the module's own formula rolls alone: they carry their critical already", async () => {
    const { ana, recorder } = setup();
    const sent = message();
    sent.getFlag = (scope, key) => (scope === "core" && key === "initiativeRoll") || (scope === KEY && key === "formulaRoll") || undefined;
    await recorder.onCreateChatMessage(sent);
    assert.equal(ana.updates.length, 0);
  });
});
