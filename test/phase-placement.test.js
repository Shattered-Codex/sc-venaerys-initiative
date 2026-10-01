import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { placementFor, planPlacement, pointerAfterMove, rolloverPlan } from "../scripts/helpers/phase-placement.js";
import { combatView, enemy, player } from "./helpers/combat-view.js";

/** Fast is current; Slow comes later. */
const inFast = (overrides = {}) =>
  combatView({
    round: 2,
    on: "b",
    combatants: [player("a", "fast", { done: 2 }), player("b", "fast"), enemy("g"), player("c", "slow"), player("p", null)],
    ...overrides,
  });

describe("never takes a turn, never gives one", () => {
  it("a combatant already done moves next round", () => {
    const view = inFast();
    assert.deepEqual(placementFor(view, view.combatants[0], "slow"), { nextPhase: "slow" });
  });

  it("a combatant not done moves now to the current phase or one ahead", () => {
    const view = inFast();
    assert.deepEqual(placementFor(view, view.combatants[3], "fast"), { phase: "fast", nextPhase: null });
  });

  it("a combatant not done moving to a phase already passed acts where it is and moves next round", () => {
    const view = combatView({ round: 2, on: "c", combatants: [player("a", "fast", { done: 2 }), player("c", "slow")] });
    assert.deepEqual(placementFor(view, view.combatants[1], "fast"), { nextPhase: "fast" });
  });

  it("a reinforcement during Fast acts this round in Enemies; during Slow it waits for the next round there", () => {
    const fresh = enemy("r", null);
    assert.deepEqual(placementFor(inFast(), fresh, "enemies"), { phase: "enemies", nextPhase: null });
    const duringSlow = combatView({ round: 2, on: "c", combatants: [enemy("g", "enemies", { done: 2 }), player("c", "slow"), fresh] });
    assert.deepEqual(placementFor(duringSlow, fresh, "enemies"), { phase: "enemies", nextPhase: null });
  });

  it("a late roll of someone placed in Slow joins Fast at once while Fast is current, and next round once it passed", () => {
    const fastCurrent = combatView({ round: 1, on: "a", combatants: [player("a", "fast"), enemy("g"), player("caio", "slow", { initiative: null })] });
    assert.deepEqual(placementFor(fastCurrent, fastCurrent.combatants[2], "fast"), { phase: "fast", nextPhase: null });
    const slowCurrent = combatView({ round: 1, on: "caio", combatants: [player("a", "fast", { done: 1 }), enemy("g", "enemies", { done: 1 }), player("caio", "slow", { initiative: null })] });
    assert.deepEqual(placementFor(slowCurrent, slowCurrent.combatants[2], "fast"), { nextPhase: "fast" });
  });

  it("before the start everything moves at once", () => {
    const view = combatView({ round: 0, combatants: [player("a", "slow", { done: null })] });
    assert.deepEqual(placementFor(view, view.combatants[0], "fast"), { phase: "fast", nextPhase: null });
  });

  it("moving back to the phase it is in clears a deferred move", () => {
    const view = inFast();
    view.combatants[0].nextPhase = "slow";
    assert.deepEqual(placementFor(view, view.combatants[0], "fast"), { nextPhase: null });
  });
});

describe("plan of a batch", () => {
  it("never pins on automatic placement and pins on a GM assignment", () => {
    const view = inFast();
    const auto = planPlacement(view, [{ id: "c", target: "fast" }]);
    assert.deepEqual(auto.updates, [{ id: "c", data: { phase: "fast", nextPhase: null } }]);
    const gm = planPlacement(view, [{ id: "c", target: "boss" }], { pinned: true });
    assert.deepEqual(gm.updates, [{ id: "c", data: { nextPhase: "boss", pinned: true } }]);
  });

  it("keeps side and initiative in the same change as the phase", () => {
    const view = inFast();
    const plan = planPlacement(view, [{ id: "p", side: "players", initiative: 3, target: "slow" }]);
    assert.deepEqual(plan.updates, [{ id: "p", data: { side: "players", initiative: 3, phase: "slow", nextPhase: null } }]);
  });

  it("splits a move of the pointer into its own operation", () => {
    const view = inFast();
    const plan = planPlacement(view, [{ id: "b", target: "slow" }, { id: "c", target: "fast" }]);
    assert.deepEqual(plan.updates, [{ id: "c", data: { phase: "fast", nextPhase: null } }]);
    assert.deepEqual(plan.pointer, { id: "b", data: { phase: "slow", nextPhase: null } });
  });
});

describe("pointer rule", () => {
  it("rests on the last blocking member that stays, at its index in the new order", () => {
    const view = combatView({ round: 2, on: "c", combatants: [player("a", "fast"), player("b", "fast"), player("c", "fast"), enemy("g")] });
    assert.deepEqual(pointerAfterMove(view, "slow"), { combatTurn: 1 });
  });

  it("counts the combatant leaving from before the target", () => {
    const view = combatView({ round: 2, on: "a", combatants: [player("a", "fast"), player("b", "fast"), enemy("g")] });
    assert.deepEqual(pointerAfterMove(view, "slow"), { combatTurn: 0 });
  });

  it("falls back to the last member that stays when nobody blocks", () => {
    const view = combatView({ round: 2, on: "c", combatants: [player("a", "fast", { done: 2 }), player("b", "fast", { done: 2 }), player("c", "fast"), enemy("g")] });
    assert.deepEqual(pointerAfterMove(view, "slow"), { combatTurn: 1 });
  });

  it("asks to advance first when the current phase would be left empty", () => {
    const view = combatView({ round: 2, on: "a", combatants: [player("a", "fast"), enemy("g")] });
    assert.deepEqual(pointerAfterMove(view, "slow"), { advanceFirst: true });
  });
});

describe("round change", () => {
  it("applies deferred phases without touching the pointer when it does not move", () => {
    const view = combatView({ round: 2, on: "s", combatants: [player("a", "fast", { nextPhase: "slow" }), player("s", "slow")] });
    assert.deepEqual(rolloverPlan(view), { updates: [{ id: "a", data: { phase: "slow", nextPhase: null } }], combatTurn: null });
  });

  it("parks the pointer on the last index when the pointer itself moves", () => {
    const view = combatView({ round: 2, on: "s", combatants: [player("a", "fast"), player("s", "slow", { nextPhase: "fast" })] });
    assert.deepEqual(rolloverPlan(view), { updates: [{ id: "s", data: { phase: "fast", nextPhase: null } }], combatTurn: 1 });
  });
});
