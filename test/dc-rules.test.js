import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { crValue, referenceCr, sameDc, suggestedDc } from "../scripts/helpers/dc-rules.js";
import { combatant, enemy, player } from "./helpers/combat-view.js";

describe("dc rules", () => {
  it("counts whole CRs and turns fractional, missing or invalid ones into 0", () => {
    assert.equal(crValue(24), 24);
    assert.equal(crValue(0.125), 0);
    assert.equal(crValue(0.5), 0);
    assert.equal(crValue(null), 0);
    assert.equal(crValue(undefined), 0);
    assert.equal(crValue("abc"), 0);
  });

  it("takes the highest CR of the Enemies phase, even when a boss elsewhere is higher", () => {
    const combatants = [enemy("kob1", "enemies", { cr: 0.125 }), enemy("kob2", "enemies", { cr: 0.125 }), enemy("dragon", "epicBoss", { cr: 24 })];
    assert.equal(referenceCr(combatants), 0);
    assert.deepEqual(suggestedDc(combatants, 10), { value: 10, source: "baseCr", base: 10, referenceCr: 0 });
  });

  it("falls back to every enemy when the Enemies phase is empty", () => {
    assert.equal(referenceCr([enemy("dragon", "epicBoss", { cr: 24 }), enemy("ogre", "boss", { cr: 2 })]), 24);
  });

  it("skips the defeated, counts the hidden and ignores players", () => {
    const combatants = [
      enemy("dead", "enemies", { cr: 9, isDefeated: true }),
      enemy("hidden", "enemies", { cr: 5, hidden: true, visible: false }),
      player("ana", "fast", { cr: 20 }),
    ];
    assert.equal(referenceCr(combatants), 5);
  });

  it("works out the side and phase of an enemy that was not classified yet", () => {
    const fresh = combatant({ id: "orc", side: null, phase: null, hasPlayerOwner: false, disposition: -1, cr: 3 });
    assert.equal(referenceCr([fresh]), 3);
  });

  it("gives null with no CR at all, and the DC stays at the base", () => {
    const combatants = [enemy("bandit", "enemies", { cr: null })];
    assert.equal(referenceCr(combatants), null);
    assert.equal(suggestedDc(combatants, 12).value, 12);
    assert.equal(suggestedDc([], 10).referenceCr, null);
  });

  it("keeps the suggestion inside the DC range", () => {
    assert.equal(suggestedDc([enemy("tarrasque", "enemies", { cr: 30 })], 80).value, 100);
    assert.equal(suggestedDc([], 0).value, 0);
  });

  it("compares a stored DC with a suggestion", () => {
    const suggestion = { value: 13, source: "baseCr", base: 10, referenceCr: 3 };
    assert.equal(sameDc({ ...suggestion }, suggestion), true);
    assert.equal(sameDc({ ...suggestion, referenceCr: 2 }, suggestion), false);
    assert.equal(sameDc({ value: 13, source: "manual" }, suggestion), false);
    assert.equal(sameDc(undefined, suggestion), false);
  });
});
