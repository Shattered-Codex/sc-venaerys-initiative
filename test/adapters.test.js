import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Dnd5eAdapter from "../scripts/services/adapters/Dnd5eAdapter.js";
import SystemAdapter from "../scripts/services/adapters/SystemAdapter.js";

const d20 = (...results) => ({ faces: 20, results });

describe("SystemAdapter", () => {
  const adapter = new SystemAdapter();

  it("lists the names of an actor's items", () => {
    const items = new Map([["a", { name: "Boss" }], ["b", { name: "Longsword" }], ["c", {}]]);
    assert.deepEqual(adapter.itemNames({ items: items.values() }), ["Boss", "Longsword"]);
    assert.deepEqual(adapter.itemNames({ items: [{ name: "Boss" }] }), ["Boss"]);
    assert.deepEqual(adapter.itemNames(null), []);
  });

  it("has no CR", () => {
    assert.equal(adapter.challengeRating({ system: { details: { cr: 5 } } }), null);
  });

  it("reads a kept 20 or 1 on a d20 as a critical or a fumble, and nothing without a single kept d20", () => {
    assert.equal(adapter.criticalOf({ dice: [d20({ result: 20, active: true })] }), "critical");
    assert.equal(adapter.criticalOf({ dice: [d20({ result: 5, active: false, discarded: true }, { result: 1, active: true })] }), "fumble");
    assert.equal(adapter.criticalOf({ dice: [d20({ result: 12, active: true })] }), null);
    assert.equal(adapter.criticalOf({ dice: [d20({ result: 5, active: true }, { result: 1, active: true })] }), null);
    assert.equal(adapter.criticalOf({ dice: [{ faces: 6, results: [{ result: 6, active: true }] }] }), null);
    assert.equal(adapter.criticalOf({ dice: [] }), null);
    assert.equal(adapter.criticalOf(null), null);
  });
});

describe("Dnd5eAdapter", () => {
  const adapter = new Dnd5eAdapter();

  it("reads an NPC's CR, fractions included, and nothing for other actors", () => {
    assert.equal(adapter.challengeRating({ type: "npc", system: { details: { cr: 0.125 } } }), 0.125);
    assert.equal(adapter.challengeRating({ type: "npc", system: { details: { cr: 24 } } }), 24);
    assert.equal(adapter.challengeRating({ type: "npc", system: { details: { cr: null } } }), null);
    assert.equal(adapter.challengeRating({ type: "character", system: { details: { cr: 3 } } }), null);
    assert.equal(adapter.challengeRating(null), null);
  });

  it("reads the kept die of a d20 roll and nothing for a fixed score", () => {
    assert.equal(adapter.criticalOf({ validD20Roll: true, d20: { total: 20 } }), "critical");
    assert.equal(adapter.criticalOf({ validD20Roll: true, d20: { total: 1 } }), "fumble");
    assert.equal(adapter.criticalOf({ validD20Roll: false, d20: undefined, total: 14 }), null);
    assert.equal(adapter.criticalOf({ total: 14 }), null);
  });
});
