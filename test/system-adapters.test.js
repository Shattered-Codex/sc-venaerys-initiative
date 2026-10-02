import assert from "node:assert/strict";
import { describe, it } from "node:test";
import InitiativeRoller from "../scripts/services/InitiativeRoller.js";
import AdapterFactory from "../scripts/services/adapters/AdapterFactory.js";
import Coc7Adapter from "../scripts/services/adapters/Coc7Adapter.js";
import DaggerheartAdapter from "../scripts/services/adapters/DaggerheartAdapter.js";
import Pf2eAdapter from "../scripts/services/adapters/Pf2eAdapter.js";
import SystemAdapter from "../scripts/services/adapters/SystemAdapter.js";
import { fakeCombat, fakeCombatant, installGame } from "./helpers/fake-combat.js";

const KEY = "sc-venaerys-initiative";
const die = (faces, ...results) => ({ faces, results: results.map((result) => ({ result, active: true })) });

describe("system adapters", () => {
  it("are picked by system id, the generic one for anything else", () => {
    assert.ok(AdapterFactory.create("pf2e") instanceof Pf2eAdapter);
    assert.ok(AdapterFactory.create("CoC7") instanceof Coc7Adapter);
    assert.ok(AdapterFactory.create("daggerheart") instanceof DaggerheartAdapter);
    assert.equal(AdapterFactory.create("swade").constructor, SystemAdapter);
  });

  it("default to the system's own roll, except Daggerheart, which has none and is experimental", () => {
    for (const id of ["dnd5e", "pf2e", "CoC7", "swade"]) {
      assert.equal(AdapterFactory.create(id).hasSystemRoll, true, id);
      assert.equal(AdapterFactory.create(id).experimental, false, id);
    }
    const daggerheart = new DaggerheartAdapter();
    assert.equal(daggerheart.hasSystemRoll, false);
    assert.equal(daggerheart.experimental, true);
  });

  it("offer a default formula with the system's attribute", () => {
    assert.equal(AdapterFactory.create("dnd5e").defaultFormula(), "1d20 + @attributes.init.total");
    assert.equal(new Pf2eAdapter().defaultFormula(), "1d20 + @actor.initiative.mod");
    assert.equal(new Coc7Adapter().defaultFormula(), "@characteristics.dex.value - 1d100");
    assert.equal(new DaggerheartAdapter().defaultFormula(), "1d12 + 1d12 + @system.traits.agility.value");
    installGame();
    globalThis.CONFIG.Combat.initiative.formula = "1d8 + @agility";
    assert.equal(new SystemAdapter().defaultFormula(), "1d8 + @agility");
  });

  it("set their own defaults: one degree in pf2e, a difficulty level and no naturals in Call of Cthulhu", () => {
    assert.deepEqual(new SystemAdapter().settingDefaults(), {});
    assert.deepEqual(new Pf2eAdapter().settingDefaults(), { natural20: "oneDegree", natural1: "oneDegree" });
    assert.deepEqual(new Coc7Adapter().settingDefaults(), { defaultDc: 1, natural20: "none", natural1: "none" });
    assert.equal(new DaggerheartAdapter().settingDefaults().natural1, "none");
  });

  it("name Call of Cthulhu difficulties and warn when its basic rule rolls nothing", () => {
    const coc = new Coc7Adapter();
    assert.equal(coc.dcName(2), "Roll.Difficulty.Hard");
    assert.equal(coc.dcName(15), null);
    assert.equal(new SystemAdapter().dcName(2), null);
    installGame();
    game.settings.get = (system, key) => (system === "CoC7" && key === "initiativeRule" ? "basic" : undefined);
    assert.equal(coc.systemRollProblem(), "Roll.CocBasicRule");
    game.settings.get = () => "optional";
    assert.equal(coc.systemRollProblem(), null);
    game.settings.get = () => {
      throw new Error("not registered");
    };
    assert.equal(coc.systemRollProblem(), null);
  });

  it("read each system's critical: matching duality dice, a d100 01 or 100", () => {
    const daggerheart = new DaggerheartAdapter();
    assert.equal(daggerheart.criticalOf({ dice: [die(12, 7), die(12, 7)] }), "critical");
    assert.equal(daggerheart.criticalOf({ dice: [die(12, 7), die(12, 3)] }), null);
    const coc = new Coc7Adapter();
    assert.equal(coc.criticalOf({ dice: [die(100, 1)] }), "critical");
    assert.equal(coc.criticalOf({ dice: [die(100, 100)] }), "fumble");
    assert.equal(coc.criticalOf({ dice: [die(100, 42)] }), null);
  });

  it("skip the pf2e modifiers dialog only when a GM rolls for players", async () => {
    const calls = [];
    const combat = { rollInitiative: async (ids, options) => calls.push([ids, options]) };
    await new Pf2eAdapter().rollInitiative(combat, ["a"], { forOthers: true });
    await new Pf2eAdapter().rollInitiative(combat, ["a"]);
    assert.deepEqual(calls, [[["a"], { skipDialog: true }], [["a"], {}]]);
  });

  it("never let an event marker roll, even through Roll All", async () => {
    installGame();
    const seen = [];
    const proto = { rollInitiative: async (ids) => seen.push(ids) };
    globalThis.CONFIG.Combat.documentClass = { prototype: proto };
    new SystemAdapter().guardEventMarkers((c) => c?.marker === true);
    const combat = Object.assign(Object.create(proto), { combatants: new Map([["m", { marker: true }], ["a", { marker: false }]]) });
    await combat.rollInitiative(["m", "a"]);
    await combat.rollInitiative("m");
    assert.deepEqual(seen, [["a"], []]);
  });
});

describe("rolling a formula against the DC", () => {
  /** A Roll stand-in: `results` are the dice it will show; the total adds `bonus` from the roll data. */
  function installRoll(results, { valid = true } = {}) {
    const made = [];
    class Roll {
      static validate() {
        return valid;
      }

      constructor(formula, data) {
        this.formula = formula;
        this.data = data;
        made.push(this);
      }

      async evaluate() {
        const values = results.shift();
        this.dice = [die(20, values[0])];
        this.total = values[0] + (this.data.bonus ?? 0);
        return this;
      }

      async toMessage(data, options) {
        this.message = { data, options };
      }
    }
    globalThis.foundry.dice = { Roll };
    globalThis.ChatMessage = { implementation: { getSpeaker: ({ alias }) => ({ alias }) } };
    return made;
  }

  function combatWith() {
    const actor = { getRollData: () => ({ bonus: 3 }) };
    const ana = fakeCombatant({ id: "ana", isOwner: true, hasPlayerOwner: true, actor, flags: { side: "players", phase: null } });
    const bruno = fakeCombatant({ id: "bruno", hasPlayerOwner: true, hidden: true, actor, flags: { side: "players", phase: null } });
    return fakeCombat({ round: 0, combatants: [ana, bruno] });
  }

  it("rolls the GM's formula with the actor's data and writes total and critical in one update, then posts it", async () => {
    installGame({ isGM: true });
    const made = installRoll([[20], [9]]);
    const combat = combatWith();
    const roller = new InitiativeRoller({ adapter: new SystemAdapter(), settings: () => ({ source: "formula", formula: "1d20 + @bonus" }) });
    assert.equal(await roller.rollAll(combat), true);
    const [write] = combat.writes("embedded");
    assert.deepEqual(write.options, { turnEvents: false });
    assert.deepEqual(write.updates, [
      { _id: "ana", initiative: 23, [`flags.${KEY}.natural`]: { value: "critical", initiative: 23 } },
      { _id: "bruno", initiative: 12, [`flags.${KEY}.natural`]: null },
    ]);
    assert.deepEqual(made.map((r) => r.formula), ["1d20 + @bonus", "1d20 + @bonus"]);
    assert.equal(made[0].message.data.flags[KEY].formulaRoll, true);
    assert.equal(made[0].message.data.flags.core.initiativeRoll, true);
    assert.deepEqual(made[1].message.options, { rollMode: "gmroll" });
  });

  it("uses the adapter's formula when the GM left it empty, and always in a system without its own roll", async () => {
    installGame({ isGM: false });
    const made = installRoll([[5]]);
    const roller = new InitiativeRoller({ adapter: new DaggerheartAdapter(), settings: () => ({ source: "system", formula: "" }) });
    await roller.rollOwn(combatWith());
    assert.equal(made[0].formula, "1d12 + 1d12 + @system.traits.agility.value");
  });

  it("refuses an invalid formula with a message and writes nothing", async () => {
    installGame({ isGM: true });
    const errors = [];
    globalThis.ui.notifications.error = (text) => errors.push(text);
    installRoll([], { valid: false });
    const combat = combatWith();
    const roller = new InitiativeRoller({ adapter: new SystemAdapter(), settings: () => ({ source: "formula", formula: "1d20 + (" }) });
    assert.equal(await roller.rollAll(combat), false);
    assert.equal(errors.length, 1);
    assert.equal(combat.writes("embedded").length, 0);
  });

  it("keeps the system's own roll when the source is the system", async () => {
    installGame({ isGM: true });
    const native = [];
    const adapter = new SystemAdapter();
    adapter.rollInitiative = async (_combat, ids, options) => native.push([ids, options]);
    const roller = new InitiativeRoller({ adapter, settings: () => ({ source: "system", formula: "1d4" }) });
    await roller.rollAll(combatWith());
    assert.deepEqual(native, [[["ana", "bruno"], { forOthers: true }]]);
  });
});
