import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  advanceTarget,
  anchorTarget,
  backTarget,
  blocks,
  currentPhaseId,
  isAdvanceSuspended,
  isPhaseComplete,
  lastBlockingIndex,
  pendingToSlow,
  roundStartTarget,
  shouldAutoAdvance,
  startConfirmation,
  startNeedsConfirmation,
  suspensionKey,
} from "../scripts/helpers/phase-progression.js";
import { combatView, enemy, player } from "./helpers/combat-view.js";

describe("who blocks a phase", () => {
  it("blocks while alive and not done, hidden or not", () => {
    assert.equal(blocks(player("a", "fast"), 2), true);
    assert.equal(blocks(player("a", "fast", { isDefeated: true }), 2), false);
    assert.equal(blocks(player("a", "fast", { done: 2 }), 2), false);
    assert.equal(blocks(enemy("d", "epicBoss", { hidden: true, visible: false }), 2), true);
  });

  it("is complete when nobody blocks", () => {
    const view = combatView({ round: 2, on: "b", combatants: [player("a", "fast", { done: 2 }), player("b", "fast", { isDefeated: true })] });
    assert.equal(isPhaseComplete(view, "fast"), true);
  });
});

describe("current phase", () => {
  const combatants = [player("a", "fast"), player("p", null)];

  it("is the phase of the combatant under the pointer", () => {
    assert.equal(currentPhaseId(combatView({ round: 2, on: "a", combatants })), "fast");
  });

  it("is null before the start, without a pointer, or on a pending combatant, and nothing advances then", () => {
    assert.equal(currentPhaseId(combatView({ round: 0, on: "a", combatants })), null);
    assert.equal(currentPhaseId(combatView({ round: 2, turn: null, combatants })), null);
    const onPending = combatView({ round: 2, on: "p", combatants });
    assert.equal(currentPhaseId(onPending), null);
    assert.equal(shouldAutoAdvance(onPending), false);
    assert.deepEqual(advanceTarget(onPending), { none: true });
  });
});

describe("advance", () => {
  it("rests the pointer on the last blocking member, never on a defeated or skipped one", () => {
    const view = combatView({
      round: 2,
      on: "boss",
      combatants: [
        enemy("boss", "boss", { done: 2 }),
        player("a", "fast"),
        player("b", "fast"),
        player("c", "fast", { isDefeated: true }),
        player("d", "fast", { done: 2 }),
      ],
    });
    assert.deepEqual(advanceTarget(view), { turn: 2, phaseId: "fast" });
  });

  it("skips empty phases, all-defeated phases and all-skipped phases", () => {
    const view = combatView({
      round: 2,
      on: "e",
      combatants: [
        enemy("e", "epicBoss", { done: 2 }),
        enemy("m", "miniBoss", { isDefeated: true }),
        player("a", "fast", { done: 2 }),
        enemy("g", "enemies"),
      ],
    });
    assert.deepEqual(advanceTarget(view), { turn: 3, phaseId: "enemies" });
  });

  it("turns the round over: last round's done marks no longer count", () => {
    const view = combatView({
      round: 2,
      on: "s",
      combatants: [enemy("boss", "boss", { done: 2 }), player("a", "fast", { done: 2 }), player("s", "slow", { done: 2 })],
    });
    assert.deepEqual(advanceTarget(view), { round: 3, turn: 0, phaseId: "boss" });
  });

  it("gives none when no phase has anyone to block", () => {
    const view = combatView({
      round: 2,
      on: "a",
      combatants: [player("a", "fast", { isDefeated: true }), enemy("g", "enemies", { isDefeated: true })],
    });
    assert.deepEqual(advanceTarget(view), { none: true });
  });

  it("auto-advances only when the current phase is complete and not suspended", () => {
    const combatants = [player("a", "fast", { done: 2 }), enemy("g")];
    assert.equal(shouldAutoAdvance(combatView({ round: 2, on: "a", combatants })), true);
    const suspended = combatView({ round: 2, on: "a", combatants, suspendedAdvance: suspensionKey(2, "fast") });
    assert.equal(isAdvanceSuspended(suspended), true);
    assert.equal(shouldAutoAdvance(suspended), false);
    assert.equal(shouldAutoAdvance(combatView({ round: 2, on: "a", combatants, suspendedAdvance: suspensionKey(1, "fast") })), true);
  });
});

describe("round 1 roll lock", () => {
  it("stops at the position of Fast while someone is pending, even with Fast empty", () => {
    const withFast = combatView({ on: "boss", combatants: [enemy("boss", "boss", { done: 1 }), player("a", "fast"), player("p", null)] });
    assert.deepEqual(advanceTarget(withFast), { waitRolls: true });
    const emptyFast = combatView({ on: "boss", combatants: [enemy("boss", "boss", { done: 1 }), enemy("g"), player("p", null)] });
    assert.deepEqual(advanceTarget(emptyFast), { waitRolls: true });
  });

  it("still reaches phases with members before Fast", () => {
    const view = combatView({ on: "e", combatants: [enemy("e", "epicBoss", { done: 1 }), enemy("m", "miniBoss"), player("p", null)] });
    assert.deepEqual(advanceTarget(view), { turn: 1, phaseId: "miniBoss" });
  });

  it("only applies in round 1 and only before the players' first phase", () => {
    const combatants = [enemy("boss", "boss", { done: 2 }), player("a", "fast"), player("p", null)];
    assert.deepEqual(advanceTarget(combatView({ round: 2, on: "boss", combatants })), { turn: 1, phaseId: "fast" });
    const inFast = combatView({ on: "a", combatants: [player("a", "fast", { done: 1 }), enemy("g"), player("p", null)] });
    assert.deepEqual(advanceTarget(inFast), { turn: 1, phaseId: "enemies" });
  });

  it("forcing past the lock places the pending players in Slow, then the target is recomputed", () => {
    const view = combatView({ on: "boss", combatants: [enemy("boss", "boss"), enemy("g"), player("p", null)] });
    assert.deepEqual(pendingToSlow(view), [{ id: "p", target: "slow" }]);
    view.combatants[2].phase = "slow";
    assert.deepEqual(advanceTarget(view), { turn: 1, phaseId: "enemies" });
  });
});

describe("start of combat", () => {
  it("asks for confirmation when someone is pending and the start lands at or after Fast's position", () => {
    const empty = combatView({ round: 0, combatants: [enemy("g"), player("p", null)] });
    assert.equal(startNeedsConfirmation(empty), true);
    const bossFirst = combatView({ round: 0, combatants: [enemy("boss", "boss"), player("a", "fast"), player("p", null)] });
    assert.equal(startNeedsConfirmation(bossFirst), false);
    const nobodyPending = combatView({ round: 0, combatants: [player("a", "fast"), enemy("g")] });
    assert.equal(startNeedsConfirmation(nobodyPending), false);
  });

  it("defaults to starting when Fast has someone and to waiting when it would be skipped", () => {
    const withFast = combatView({ round: 0, combatants: [player("a", "fast"), enemy("g"), player("p", null, { name: "Caio" })] });
    assert.deepEqual(startConfirmation(withFast), { count: 1, names: ["Caio"], more: 0, fastEmpty: false, defaultAction: "start" });
    const emptyFast = combatView({ round: 0, combatants: [enemy("g"), player("p", null)] });
    assert.equal(startConfirmation(emptyFast).defaultAction, "wait");
    assert.equal(startConfirmation(emptyFast).fastEmpty, true);
  });

  it("lists five names and counts the rest", () => {
    const pending = Array.from({ length: 8 }, (_, i) => player(`p${i}`, null, { name: `P${i}` }));
    const info = startConfirmation(combatView({ round: 0, combatants: pending }));
    assert.deepEqual(info.names, ["P0", "P1", "P2", "P3", "P4"]);
    assert.equal(info.more, 3);
  });

  it("recounts at confirmation: only who is still pending goes to Slow", () => {
    const view = combatView({ round: 0, combatants: [player("a", "fast"), player("b", "slow"), enemy("g"), player("c", null)] });
    assert.deepEqual(pendingToSlow(view), [{ id: "c", target: "slow" }]);
    view.combatants[3].phase = "fast";
    assert.deepEqual(pendingToSlow(view), []);
    assert.equal(startNeedsConfirmation(view), false);
  });

  it("starts on the last blocking member of the first phase with someone to block", () => {
    const view = combatView({ round: 0, combatants: [player("a", "fast"), player("b", "fast"), enemy("g")] });
    assert.deepEqual(roundStartTarget(view, 1), { turn: 1, phaseId: "fast" });
  });
});

describe("previous phase", () => {
  it("goes to the previous phase with members in the same round and keeps its marks", () => {
    const view = combatView({
      round: 2,
      on: "g",
      combatants: [player("a", "fast", { done: 2 }), player("b", "fast", { done: 2 }), enemy("g")],
    });
    assert.deepEqual(backTarget(view), { turn: 1, phaseId: "fast", suspend: "2:fast" });
  });

  it("goes into the previous round, wiping that phase's marks and every mark of the round undone", () => {
    const view = combatView({
      round: 2,
      on: "boss",
      combatants: [
        enemy("boss", "boss", { done: 2 }),
        player("a", "fast", { done: 1 }),
        enemy("g", "enemies", { done: 1 }),
        player("s", "slow", { done: 1, moved: 2 }),
      ],
    });
    const target = backTarget(view);
    assert.equal(target.round, 1);
    assert.equal(target.turn, 3);
    assert.equal(target.phaseId, "slow");
    assert.deepEqual(target.clear, [{ id: "boss", done: null }, { id: "s", done: null, moved: null }]);
  });

  it("refuses in round 1 when nothing came before, and never goes to round 0", () => {
    const view = combatView({ round: 1, on: "a", combatants: [player("a", "fast"), enemy("g")] });
    assert.deepEqual(backTarget(view), { refuse: "noEarlierPhase" });
  });

  it("still goes back in round 1 when the GM put someone in an earlier phase", () => {
    const view = combatView({ round: 1, on: "a", combatants: [enemy("boss", "boss"), player("a", "fast"), enemy("g")] });
    assert.deepEqual(backTarget(view), { turn: 0, phaseId: "boss", suspend: "1:boss" });
  });
});

describe("re-anchoring", () => {
  it("brings the pointer to the resting member of its combatant's phase", () => {
    const combatants = [player("a", "fast"), player("b", "fast"), enemy("g")];
    assert.deepEqual(anchorTarget(combatView({ round: 2, on: "a", combatants })), { turn: 1, phaseId: "fast" });
    assert.equal(anchorTarget(combatView({ round: 2, on: "b", combatants })), null);
  });

  it("falls back to the last member when nobody blocks", () => {
    const combatants = [player("a", "fast", { done: 2 }), player("b", "fast", { done: 2 }), enemy("g")];
    assert.deepEqual(anchorTarget(combatView({ round: 2, on: "a", combatants })), { turn: 1, phaseId: "fast" });
  });

  describe("with the pointer on a pending combatant", () => {
    const combatants = () => [enemy("boss", "boss"), player("a", "fast"), enemy("g"), player("p", null)];

    it("returns to the last known phase while it has members", () => {
      assert.deepEqual(anchorTarget(combatView({ round: 2, on: "p", combatants: combatants() }), "fast"), { turn: 1, phaseId: "fast" });
    });

    it("goes to the next phase with someone to block when the known one emptied", () => {
      const view = combatView({ round: 2, on: "p", combatants: [enemy("boss", "boss"), enemy("g"), player("p", null)] });
      assert.deepEqual(anchorTarget(view, "fast"), { turn: 1, phaseId: "enemies" });
    });

    it("goes to the first phase of the round when nothing is known (after a reload)", () => {
      assert.deepEqual(anchorTarget(combatView({ round: 2, on: "p", combatants: combatants() }), null), { turn: 0, phaseId: "boss" });
    });

    it("goes to the first phase of the round when nothing after the known one blocks", () => {
      const view = combatView({ round: 2, on: "p", combatants: [enemy("boss", "boss"), player("p", null)] });
      assert.deepEqual(anchorTarget(view, "slow"), { turn: 0, phaseId: "boss" });
    });

    it("gives none when no phase has members", () => {
      const view = combatView({ round: 2, on: "p", combatants: [player("p", null)] });
      assert.deepEqual(anchorTarget(view, "fast"), { none: true });
    });
  });

  it("never anchors before the start", () => {
    assert.equal(anchorTarget(combatView({ round: 0, on: "a", combatants: [player("a", "fast")] })), null);
  });

  it("uses the resting member's index", () => {
    const view = combatView({ round: 2, on: "a", combatants: [player("a", "fast"), player("b", "fast", { isDefeated: true })] });
    assert.equal(lastBlockingIndex(view, "fast"), 0);
    assert.equal(anchorTarget(view), null);
  });
});
