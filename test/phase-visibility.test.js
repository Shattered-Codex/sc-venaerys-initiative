import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { visibleCombat } from "../scripts/helpers/phase-visibility.js";
import { combatView, enemy, player } from "./helpers/combat-view.js";

const asPlayer = { isGM: false, showDcToPlayers: false };
const asGM = { isGM: true, showDcToPlayers: false };
const phaseIds = (result) => result.phases.map((p) => (p.waitingForGm ? "<waiting>" : p.phase.id));

describe("player visibility", () => {
  it("drops what the core tracker hides, from the lists and the counts", () => {
    const view = combatView({ round: 2, on: "a", combatants: [player("a", "fast"), enemy("g"), enemy("h", "enemies", { hidden: true, visible: false })] });
    const enemies = visibleCombat(view, asPlayer).phases.find((p) => p.phase?.id === "enemies");
    assert.deepEqual(enemies.members.map((c) => c.id), ["g"]);
  });

  it("shows a current phase with no visible member as Waiting for the GM, without its name", () => {
    const view = combatView({ round: 2, on: "dragon", combatants: [enemy("dragon", "epicBoss", { hidden: true, visible: false }), player("a", "fast")] });
    const result = visibleCombat(view, asPlayer);
    assert.deepEqual(result.phases[0], { state: "current", waitingForGm: true });
    assert.equal(JSON.stringify(result).includes("dragon"), false);
    assert.equal(JSON.stringify(result).includes("epicBoss"), false);
  });

  it("shows the boss phase with the boss once revealed", () => {
    const view = combatView({ round: 2, on: "dragon", combatants: [enemy("dragon", "epicBoss"), player("a", "fast")] });
    assert.deepEqual(phaseIds(visibleCombat(view, asPlayer)), ["epicBoss", "fast"]);
  });

  it("drops past and future phases with no visible member", () => {
    const view = combatView({
      round: 2,
      on: "a",
      combatants: [enemy("b", "boss", { visible: false }), player("a", "fast"), enemy("m", "slow", { visible: false })],
    });
    assert.deepEqual(phaseIds(visibleCombat(view, asPlayer)), ["fast"]);
  });

  it("decides from visible, never from hidden", () => {
    const view = combatView({
      round: 2,
      on: "a",
      combatants: [player("a", "fast"), enemy("x", "enemies", { hidden: false, visible: false }), enemy("y", "enemies", { hidden: true, visible: true })],
    });
    const enemies = visibleCombat(view, asPlayer).phases.find((p) => p.phase?.id === "enemies");
    assert.deepEqual(enemies.members.map((c) => c.id), ["y"]);
    const allInvisible = combatView({ round: 2, on: "x", combatants: [enemy("x", "boss", { hidden: false, visible: false })] });
    assert.deepEqual(visibleCombat(allInvisible, asPlayer).phases, [{ state: "current", waitingForGm: true }]);
  });

  it("filters the pending strip the same way", () => {
    const view = combatView({ round: 1, on: "a", combatants: [player("a", "fast"), player("p", null), player("q", null, { visible: false })] });
    assert.deepEqual(visibleCombat(view, asPlayer).pending.map((c) => c.id), ["p"]);
  });

  it("shows the DC only when the GM allows it", () => {
    const view = combatView({ round: 1, on: "a", combatants: [player("a", "fast")] });
    assert.equal(visibleCombat(view, asPlayer).showDc, false);
    assert.equal(visibleCombat(view, { isGM: false, showDcToPlayers: true }).showDc, true);
  });
});

describe("GM visibility", () => {
  it("sees every phase, empty ones included, and every combatant", () => {
    const view = combatView({ round: 2, on: "a", combatants: [enemy("h", "boss", { hidden: true, visible: true }), player("a", "fast")] });
    const result = visibleCombat(view, asGM);
    assert.equal(result.phases.length, 7);
    assert.equal(result.showDc, true);
    assert.deepEqual(result.phases.map((p) => p.state), ["past", "past", "past", "current", "future", "future", "future"]);
  });

  it("marks every phase future before the start", () => {
    const view = combatView({ round: 0, combatants: [player("a", "fast")] });
    assert.ok(visibleCombat(view, asGM).phases.every((p) => p.state === "future"));
  });
});
