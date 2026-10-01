import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { defaultPlan } from "../scripts/constants/default-phases.js";
import CombatSorter from "../scripts/services/CombatSorter.js";
import { installGame } from "./helpers/fake-combat.js";

const MODULE = "sc-venaerys-initiative";

describe("CombatSorter", () => {
  let calls;
  let sort;
  beforeEach(() => {
    installGame();
    calls = [];
    const original = (a, b) => {
      calls.push([a.id, b.id]);
      return b.init - a.init;
    };
    globalThis.CONFIG.Combat.documentClass = { prototype: { _sortCombatants: original } };
    CombatSorter.install();
    sort = CONFIG.Combat.documentClass.prototype._sortCombatants;
  });

  const combat = (enabled) => ({ flags: { [MODULE]: { enabled, plan: defaultPlan() } } });
  const member = (parent, id, phase, init) => ({ id, parent, init, flags: { [MODULE]: { phase } } });

  it("keeps the original order when the combat has no phases", () => {
    const off = combat(false);
    const list = [member(off, "slow", "slow", 20), member(off, "boss", "boss", 5)];
    assert.deepEqual(list.sort(sort).map((c) => c.id), ["slow", "boss"]);
  });

  it("orders by phase when on, and asks the original only on a tie", () => {
    const on = combat(true);
    const list = [member(on, "slow", "slow", 20), member(on, "boss", "boss", 5), member(on, "a", "fast", 10), member(on, "b", "fast", 12)];
    calls.length = 0;
    assert.deepEqual(list.sort(sort).map((c) => c.id), ["boss", "b", "a", "slow"]);
    assert.ok(calls.every(([x, y]) => [x, y].every((id) => id === "a" || id === "b")));
  });

  it("re-sorts the turns only when the enabled flag is in the change", () => {
    let setups = 0;
    const doc = { setupTurns: () => setups++ };
    CombatSorter.onUpdateCombat(doc, { flags: { [MODULE]: { enabled: true } } });
    CombatSorter.onUpdateCombat(doc, { flags: { [MODULE]: { dc: { value: 3 } } } });
    CombatSorter.onUpdateCombat(doc, { round: 2 });
    assert.equal(setups, 1);
  });
});
