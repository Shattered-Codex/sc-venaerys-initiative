import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultPlan } from "../scripts/constants/default-phases.js";
import { cachedPhaseRank, compareByPhase } from "../scripts/helpers/phase-order.js";

const plan = defaultPlan();
const byInitiative = (a, b) => (b.init - a.init) || (a.id > b.id ? 1 : -1);
const sort = (list) => [...list].sort((a, b) => compareByPhase(plan, a.phase, b.phase, () => byInitiative(a, b)));

describe("phase order", () => {
  it("ranks by the phase's position in the plan", () => {
    assert.equal(cachedPhaseRank(plan, "epicBoss"), 0);
    assert.equal(cachedPhaseRank(plan, "slow"), 5);
  });

  it("puts pending and unknown phases after every phase", () => {
    assert.equal(cachedPhaseRank(plan, null), plan.length);
    assert.equal(cachedPhaseRank(plan, "gone"), plan.length);
    const sorted = sort([
      { id: "p", phase: null, init: 30 },
      { id: "s", phase: "slow", init: 3 },
      { id: "x", phase: "gone", init: 40 },
      { id: "b", phase: "boss", init: 1 },
    ]);
    assert.deepEqual(sorted.map((c) => c.id), ["b", "s", "x", "p"]);
  });

  it("calls the original comparator, with the same pair, on a tie", () => {
    const calls = [];
    const a = { id: "a", phase: "fast" };
    const b = { id: "b", phase: "fast" };
    const result = compareByPhase(plan, a.phase, b.phase, () => {
      calls.push([a, b]);
      return -7;
    });
    assert.equal(result, -7);
    assert.deepEqual(calls, [[a, b]]);
  });

  it("is antisymmetric and stable under shuffles with ties and pending combatants", () => {
    const phases = [...plan.map((p) => p.id), null];
    const list = Array.from({ length: 40 }, (_, i) => ({ id: `c${String(i).padStart(2, "0")}`, phase: phases[i % phases.length], init: i % 4 }));
    for (const a of list) {
      for (const b of list) {
        const ab = Math.sign(compareByPhase(plan, a.phase, b.phase, () => byInitiative(a, b)));
        const ba = Math.sign(compareByPhase(plan, b.phase, a.phase, () => byInitiative(b, a)));
        if (a !== b) assert.equal(ab, -ba);
      }
    }
    const expected = sort(list).map((c) => c.id);
    for (let i = 0; i < 20; i++) {
      const shuffled = [...list].sort(() => Math.random() - 0.5);
      assert.deepEqual(sort(shuffled).map((c) => c.id), expected);
    }
  });
});
