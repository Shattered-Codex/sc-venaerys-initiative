import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import AdapterFactory from "../scripts/services/adapters/AdapterFactory.js";
import Dnd5eAdapter from "../scripts/services/adapters/Dnd5eAdapter.js";
import SystemAdapter from "../scripts/services/adapters/SystemAdapter.js";
import CombatSnapshot from "../scripts/services/CombatSnapshot.js";
import { fakeCombat, fakeCombatant, installGame } from "./helpers/fake-combat.js";

describe("system adapters", () => {
  it("picks dnd5e by system id and falls back to the generic adapter", () => {
    assert.ok(AdapterFactory.create("dnd5e") instanceof Dnd5eAdapter);
    assert.ok(AdapterFactory.create("CoC7") instanceof SystemAdapter);
    assert.equal(AdapterFactory.create("CoC7") instanceof Dnd5eAdapter, false);
  });

  it("shows the dnd5e initiative score, else 0; the generic adapter shows 0", () => {
    const dnd = new Dnd5eAdapter();
    assert.equal(dnd.displayInitiative(fakeCombatant({ id: "g", initScore: 13 })), 13);
    assert.equal(dnd.displayInitiative({ actor: null }), 0);
    assert.equal(dnd.displayInitiative({ actor: { system: {} } }), 0);
    assert.equal(new SystemAdapter().displayInitiative(fakeCombatant({ id: "g", initScore: 13 })), 0);
  });
});

describe("CombatSnapshot", () => {
  beforeEach(() => installGame());

  it("reads the combat in turn order with the module's flags", () => {
    const combat = fakeCombat({
      round: 2,
      turn: 1,
      combatants: [
        fakeCombatant({ id: "a", initiative: 18, flags: { side: "players", phase: "fast", done: 2 } }),
        fakeCombatant({ id: "boss", initiative: 10, flags: { side: "enemies", phase: "boss", pinned: true } }),
        fakeCombatant({ id: "g", initiative: 12, isDefeated: true, hidden: true, visible: false, flags: { side: "enemies", phase: "enemies" } }),
        fakeCombatant({ id: "p", flags: { side: "players", phase: null } }),
      ],
    });
    const view = CombatSnapshot.from(combat, new Dnd5eAdapter());
    assert.deepEqual(view.combatants.map((c) => c.id), ["boss", "a", "g", "p"]);
    assert.equal(view.enabled, true);
    assert.equal(view.started, true);
    assert.equal(view.turn, 1);
    assert.equal(view.dc, 15);
    const [boss, a, g, p] = view.combatants;
    assert.equal(boss.pinned, true);
    assert.equal(a.done, 2);
    assert.equal(g.isDefeated, true);
    assert.equal(g.hidden, true);
    assert.equal(g.visible, false);
    assert.equal(p.phase, null);
    assert.equal(a.disposition, -1);
    assert.equal(a.groupKey, "actor-a");
  });

  it("never throws on missing or broken flags: an invalid plan reads as off, an unknown phase as pending", () => {
    const broken = fakeCombat({ flags: { plan: [{ id: "x" }] }, combatants: [fakeCombatant({ id: "a", flags: { phase: "gone", side: "weird", done: "x" } })] });
    const view = CombatSnapshot.from(broken, new SystemAdapter());
    assert.equal(view.enabled, false);
    assert.equal(CombatSnapshot.isPhased(broken), false);
    const missing = fakeCombat({ phased: false, combatants: [fakeCombatant({ id: "a" })] });
    assert.equal(CombatSnapshot.from(missing, null).enabled, false);
    const unknownPhase = fakeCombat({ combatants: [fakeCombatant({ id: "a", flags: { phase: "gone", side: "weird", done: "x" } })] });
    const [a] = CombatSnapshot.from(unknownPhase, null).combatants;
    assert.deepEqual({ phase: a.phase, side: a.side, done: a.done }, { phase: null, side: null, done: null });
  });

  it("reads a critical or fumble only while the initiative is the one it came with, old natural 20/1 marks included", () => {
    const natural = (flag, initiative) => CombatSnapshot.naturalOf(fakeCombatant({ id: "a", initiative, flags: { natural: flag } }));
    assert.equal(natural({ value: "critical", initiative: 17 }, 17), "critical");
    assert.equal(natural({ value: "fumble", initiative: 17 }, 17), "fumble");
    assert.equal(natural({ value: 20, initiative: 17 }, 17), "critical");
    assert.equal(natural({ value: 1, initiative: 17 }, 17), "fumble");
    assert.equal(natural({ value: "critical", initiative: 17 }, 12), null);
    assert.equal(natural({ value: 7, initiative: 17 }, 17), null);
    assert.equal(natural(undefined, 17), null);
  });

  it("reads how the DC was set and the CR from the adapter", () => {
    assert.deepEqual(CombatSnapshot.dcRuleOf(fakeCombat()), { source: "manual", base: null, referenceCr: null });
    const baseCr = fakeCombat({ flags: { dc: { value: 12, source: "baseCr", base: 10, referenceCr: 2 } } });
    assert.deepEqual(CombatSnapshot.dcRuleOf(baseCr), { source: "baseCr", base: 10, referenceCr: 2 });
    const ogre = fakeCombatant({ id: "o", actor: { type: "npc", system: { details: { cr: 2 }, attributes: { init: { score: 8 } } } } });
    const [view] = CombatSnapshot.from(fakeCombat({ combatants: [ogre] }), new Dnd5eAdapter()).combatants;
    assert.equal(view.cr, 2);
    assert.equal(CombatSnapshot.from(fakeCombat({ combatants: [ogre] }), new SystemAdapter()).combatants[0].cr, null);
  });

  it("falls back to the default DC when the stored one is not a number", () => {
    assert.equal(CombatSnapshot.dcOf(fakeCombat({ flags: { dc: { value: null } } })), 15);
    assert.equal(CombatSnapshot.dcOf(fakeCombat({ flags: { dc: { value: 50 } } })), 50);
  });
});
