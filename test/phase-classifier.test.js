import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  automaticPhaseOf,
  classifyAll,
  classifyCleared,
  classifyCombatant,
  classifyForDc,
  classifyRoll,
  phaseForRoll,
  sideFor,
} from "../scripts/helpers/phase-classifier.js";
import { combatView, combatant, enemy, player } from "./helpers/combat-view.js";

describe("side", () => {
  it("puts player owners and Friendly tokens on the players' side, everyone else with the enemies", () => {
    assert.equal(sideFor({ hasPlayerOwner: true, disposition: -1, hasToken: true }), "players");
    assert.equal(sideFor({ hasPlayerOwner: true, disposition: null, hasToken: false }), "players");
    assert.equal(sideFor({ hasPlayerOwner: false, disposition: 1, hasToken: true }), "players");
    assert.equal(sideFor({ hasPlayerOwner: false, disposition: 0, hasToken: true }), "enemies");
    assert.equal(sideFor({ hasPlayerOwner: false, disposition: -1, hasToken: true }), "enemies");
    assert.equal(sideFor({ hasPlayerOwner: false, disposition: -2, hasToken: true }), "enemies");
    assert.equal(sideFor({ hasPlayerOwner: false, disposition: null, hasToken: false }), "enemies");
  });
});

describe("roll against the DC", () => {
  it("passes on a tie", () => {
    assert.equal(phaseForRoll(14, 14), "fast");
    assert.equal(phaseForRoll(13, 14), "slow");
  });

  it("compares tie-break decimals as they are", () => {
    assert.equal(phaseForRoll(14.18, 15), "slow");
    assert.equal(phaseForRoll(15.14, 15), "fast");
  });
});

describe("entering a phased combat", () => {
  it("puts an enemy in Enemies with its display initiative in the same change", () => {
    const goblin = combatant({ id: "g", side: null, hasPlayerOwner: false, disposition: -1, displayInitiative: 12 });
    assert.deepEqual(classifyCombatant(goblin, 15), { id: "g", side: "enemies", initiative: 12, target: "enemies" });
  });

  it("leaves a player without a roll pending and classifies one with a roll", () => {
    const ana = combatant({ id: "ana", side: null, hasPlayerOwner: true });
    assert.deepEqual(classifyCombatant(ana, 15), { id: "ana", side: "players" });
    const bruno = combatant({ id: "bruno", side: null, hasPlayerOwner: true, initiative: 17 });
    assert.deepEqual(classifyCombatant(bruno, 15), { id: "bruno", side: "players", target: "fast" });
  });

  it("never moves a pinned combatant", () => {
    const boss = enemy("boss", "boss", { pinned: true });
    assert.equal(classifyCombatant(boss, 15), null);
  });

  it("keeps the side once decided, even if the disposition changes", () => {
    const turned = combatant({ id: "t", side: "enemies", phase: "enemies", initiative: 10, disposition: 1 });
    assert.equal(classifyCombatant(turned, 15), null);
  });

  it("gives nothing on a second pass", () => {
    const view = combatView({
      round: 0,
      combatants: [
        combatant({ id: "g", side: null, displayInitiative: 9 }),
        combatant({ id: "a", side: null, hasPlayerOwner: true, initiative: 18 }),
        combatant({ id: "p", side: null, hasPlayerOwner: true }),
      ],
    });
    const changes = classifyAll(view);
    assert.equal(changes.length, 3);
    for (const change of changes) {
      const c = view.combatants.find((x) => x.id === change.id);
      if (change.side) c.side = change.side;
      if ("initiative" in change) c.initiative = change.initiative;
      if ("target" in change) c.phase = change.target;
    }
    assert.deepEqual(classifyAll(view), []);
  });
});

describe("rolls, resets and new DCs", () => {
  it("moves a player whose new roll changes the result", () => {
    assert.deepEqual(classifyRoll(player("a", "slow", { initiative: 16 }), 15), { id: "a", target: "fast" });
    assert.equal(classifyRoll(player("a", "fast", { initiative: 16 }), 15), null);
    assert.equal(classifyRoll(player("a", "slow", { initiative: 16, pinned: true }), 15), null);
  });

  it("sends a cleared player back to pending, and refills a cleared enemy", () => {
    assert.deepEqual(classifyCleared(player("a", "fast", { initiative: null })), { id: "a", target: null });
    assert.deepEqual(classifyCleared(enemy("g", "enemies", { initiative: null, displayInitiative: 11 })), { id: "g", initiative: 11 });
    assert.equal(classifyCleared(player("a", "fast", { initiative: null, pinned: true })), null);
  });

  it("reclassifies only rolled, unpinned players on a new DC", () => {
    const view = combatView({
      combatants: [
        player("a", "fast", { initiative: 16 }),
        player("b", "fast", { initiative: 16, pinned: true }),
        player("c", "slow", { initiative: null }),
        enemy("g"),
      ],
    });
    assert.deepEqual(classifyForDc(view, 17), [{ id: "a", target: "slow" }]);
  });

  it("compares against the deferred phase, so a deferred move is not repeated", () => {
    assert.equal(classifyRoll(player("a", "slow", { initiative: 16, nextPhase: "fast" }), 15), null);
  });

  it("computes the automatic phase for the phase select", () => {
    assert.equal(automaticPhaseOf(enemy("g", "boss", { pinned: true }), 15, true), "enemies");
    assert.equal(automaticPhaseOf(player("a", "boss", { initiative: 9 }), 15, true), "slow");
    assert.equal(automaticPhaseOf(player("a", "boss", { initiative: null }), 15, false), null);
    assert.equal(automaticPhaseOf(player("a", "boss", { initiative: null }), 15, true), "slow");
  });
});
