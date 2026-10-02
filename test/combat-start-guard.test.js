import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import CombatStartGuard from "../scripts/services/CombatStartGuard.js";
import { fakeCombat, fakeCombatant, installGame } from "./helpers/fake-combat.js";

const KEY = "sc-venaerys-initiative";
const pendingCombat = (overrides = {}) =>
  fakeCombat({
    round: 0,
    turn: null,
    combatants: [fakeCombatant({ id: "g", initiative: 10, flags: { side: "enemies", phase: "enemies" } }), fakeCombatant({ id: "p", flags: { side: "players", phase: null } })],
    ...overrides,
  });

describe("CombatStartGuard", () => {
  let original;
  let starts;
  let guard;
  let dialogs;
  let answer;

  beforeEach(() => {
    installGame();
    starts = [];
    dialogs = [];
    answer = null;
    original = function (...args) {
      starts.push([this.id, ...args]);
      return this;
    };
    globalThis.CONFIG.Combat.documentClass = { prototype: { startCombat: original } };
    globalThis.foundry.applications.api.DialogV2 = {
      wait: (config) => {
        dialogs.push(config);
        return new Promise((resolve) => (answer = resolve));
      },
    };
    guard = new CombatStartGuard({ adapter: null });
    guard.install();
    guarded = CONFIG.Combat.documentClass.prototype.startCombat;
  });

  let guarded;
  const start = (combat, ...args) => guarded.call(combat, ...args);

  it("calls the original without a dialog for players, started combats, unphased combats, confirmed calls and nothing to confirm", async () => {
    installGame({ isGM: false });
    await start(pendingCombat());
    installGame();
    const started = pendingCombat();
    started.round = 1;
    await start(started);
    await start(pendingCombat({ phased: false }));
    await start(pendingCombat(), { [KEY]: { confirmed: true } });
    await start(fakeCombat({ round: 0, turn: null, combatants: [fakeCombatant({ id: "a", initiative: 18, flags: { side: "players", phase: "fast" } })] }));
    assert.equal(dialogs.length, 0);
    assert.equal(starts.length, 5);
  });

  it("asks once per combat while the question is open; waiting never calls the original", async () => {
    const combat = pendingCombat();
    const first = start(combat);
    const second = start(combat);
    assert.equal(dialogs.length, 1);
    assert.equal(dialogs[0].buttons.find((b) => b.default).action, "wait");
    answer(null);
    assert.deepEqual(await Promise.all([first, second]), [combat, combat]);
    assert.equal(starts.length, 0);
  });

  it("starts on Start anyway, with Start as the default when Fast has someone", async () => {
    const combat = fakeCombat({
      round: 0,
      turn: null,
      combatants: [fakeCombatant({ id: "a", initiative: 18, flags: { side: "players", phase: "fast" } }), fakeCombatant({ id: "p", flags: { side: "players", phase: null } })],
    });
    const pending = start(combat);
    assert.equal(dialogs[0].buttons.find((b) => b.default).action, "start");
    answer("start");
    await pending;
    assert.equal(starts.length, 1);
  });

  it("offers 'Roll for them' with a roller: it rolls the waiting characters and does not start", async () => {
    const rolled = [];
    guard = new CombatStartGuard({ adapter: null, roller: { rollAll: async (c) => rolled.push(c.id) } });
    guard.install();
    const combat = pendingCombat();
    const pending = CONFIG.Combat.documentClass.prototype.startCombat.call(combat);
    assert.ok(dialogs[0].buttons.some((b) => b.action === "roll"));
    answer("roll");
    assert.equal(await pending, combat);
    assert.deepEqual(rolled, [combat.id]);
    assert.equal(starts.length, 0);
  });

  it("notices a Combat class swapped after setup", () => {
    assert.equal(guard.check(), true);
    const warn = console.warn;
    console.warn = () => {};
    globalThis.CONFIG.Combat.documentClass = { prototype: { startCombat: original } };
    assert.equal(guard.check(), false);
    console.warn = warn;
  });
});
