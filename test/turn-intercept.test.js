import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decide, isNativeNavigation } from "../scripts/helpers/turn-intercept.js";

const nav = (direction, changes = { _id: "x", round: 2, turn: 3 }) => ({ changes, options: { direction, worldTime: { delta: 0 } } });
const base = { isGM: true, enabled: true, round: 2 };

describe("which updates are native navigation", () => {
  it("needs a phased combat", () => {
    assert.equal(decide({ ...base, ...nav(1), enabled: false }), "pass");
  });

  it("lets the module's own writes through", () => {
    assert.equal(decide({ ...base, changes: { turn: 1 }, options: { direction: 1, "sc-venaerys-initiative": { reason: "advance" } } }), "pass");
  });

  it("needs a numeric direction", () => {
    assert.equal(decide({ ...base, changes: { turn: 1 }, options: {} }), "pass");
    assert.equal(decide({ ...base, changes: { turn: 1 }, options: { direction: "1" } }), "pass");
  });

  it("needs nothing but turn and round", () => {
    assert.equal(decide({ ...base, changes: { _id: "x", turn: 1, combatants: [] }, options: { direction: 1 } }), "pass");
    assert.equal(isNativeNavigation({ _id: "x" }, { direction: 1 }), false);
  });

  it("lets startCombat through (round 0 to 1 without direction)", () => {
    assert.equal(decide({ ...base, round: 0, changes: { round: 1, turn: 0 }, options: {} }), "pass");
  });
});

describe("decisions", () => {
  it("passes raw writes and mixed operations like Reset initiative", () => {
    assert.equal(decide({ ...base, changes: { turn: 4 }, options: {} }), "pass");
    assert.equal(decide({ ...base, changes: { _id: "x", combatants: [], turn: 2 }, options: { turnEvents: false, diff: false } }), "pass");
  });

  it("turns navigation out of round 0 into a start, for the GM and for players, marking nothing", () => {
    assert.equal(decide({ ...base, round: 0, ...nav(1, { round: 1, turn: null }) }), "start");
    assert.equal(decide({ ...base, isGM: false, round: 0, ...nav(1, { round: 1, turn: null }) }), "start");
  });

  it("turns a player's forward navigation into Done and a backward one into a refusal", () => {
    assert.equal(decide({ ...base, isGM: false, ...nav(1) }), "markDone");
    assert.equal(decide({ ...base, isGM: false, ...nav(-1) }), "refuseBack");
  });

  it("turns the GM's navigation into advance and back", () => {
    assert.equal(decide({ ...base, ...nav(1) }), "advance");
    assert.equal(decide({ ...base, ...nav(-1, { round: 1, turn: 5 }) }), "back");
  });
});
