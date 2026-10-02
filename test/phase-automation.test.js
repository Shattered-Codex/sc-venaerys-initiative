import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { consequencesToRun, normalizeConsequence, normalizeConsequences } from "../scripts/helpers/consequence-kinds.js";
import { startKey, startedPhase } from "../scripts/helpers/phase-triggers.js";
import PhaseAutomationRunner from "../scripts/services/PhaseAutomationRunner.js";
import { fakeCombat, fakeCombatant, installGame } from "./helpers/fake-combat.js";

const KEY = "sc-venaerys-initiative";

describe("consequence kinds", () => {
  it("normalizes a row, keeping numbers in range and choices honest, and drops unknown kinds", () => {
    const row = normalizeConsequence({ id: "r", kind: "sound", params: { src: " a.ogg ", volume: 500 } });
    assert.deepEqual(row, { id: "r", kind: "sound", enabled: true, params: { src: "a.ogg", volume: 100 } });
    assert.equal(normalizeConsequence({ kind: "nope" }), null);
    assert.equal(normalizeConsequence({ kind: "chatMessage", params: { audience: "x" } }).params.audience, "all");
    assert.deepEqual(normalizeConsequences([{ kind: "nope" }, { kind: "hook" }]).map((r) => r.kind), ["hook"]);
  });

  it("runs GM rows on the active GM only and local rows where the phase is seen", () => {
    const rows = normalizeConsequences([
      { kind: "macro" },
      { kind: "sound" },
      { kind: "screenMessage", params: { audience: "gm" } },
      { kind: "jumpScare" },
      { kind: "hook", enabled: false },
    ]);
    const kinds = (options) => consequencesToRun(rows, { isModuleActive: () => false, ...options }).map((r) => r.kind);
    assert.deepEqual(kinds({ visible: true, isGM: true, isActiveGM: true }), ["macro", "sound", "screenMessage"]);
    assert.deepEqual(kinds({ visible: true, isGM: false, isActiveGM: false }), ["sound"]);
    assert.deepEqual(kinds({ visible: false, isGM: false, isActiveGM: false }), []);
    assert.ok(consequencesToRun(rows, { visible: true, isGM: true, isActiveGM: true, isModuleActive: () => true }).some((r) => r.kind === "jumpScare"));
  });
});

describe("when a phase starts", () => {
  const before = { round: 2, phaseId: "fast" };

  it("starts on the module's advance, round change and start, and on the native start", () => {
    assert.equal(startedPhase({ reason: "advance", before, after: { round: 2, phaseId: "enemies" } }), "enemies");
    assert.equal(startedPhase({ reason: "round", before, after: { round: 3, phaseId: "fast" } }), "fast");
    assert.equal(startedPhase({ nativeStart: true, before: { round: 0, phaseId: null }, after: { round: 1, phaseId: "boss" } }), "boss");
  });

  it("never starts on going back, re-anchoring or someone else's write, nor in the same phase", () => {
    for (const reason of ["back", "anchor", undefined]) {
      assert.equal(startedPhase({ reason, before, after: { round: 2, phaseId: "enemies" } }), null, String(reason));
    }
    assert.equal(startedPhase({ reason: "start", before, after: { round: 2, phaseId: "fast" } }), null);
    assert.equal(startKey("c", 2, "fast"), "c:2:fast");
  });
});

describe("PhaseAutomationRunner", () => {
  let recorded;
  let ran;

  function combatWith({ onEnter, hidden = false, isGM = true, isActiveGM = isGM }) {
    const combat = fakeCombat({
      round: 2,
      combatants: [
        fakeCombatant({ id: "a", initiative: 18, flags: { side: "players", phase: "fast", done: 2 } }),
        fakeCombatant({ id: "boss", initiative: 10, hidden, visible: !hidden, flags: { side: "enemies", phase: "boss" } }),
      ],
    });
    combat.flags[KEY].plan = combat.flags[KEY].plan.map((p) => (p.id === "boss" ? { ...p, onEnter } : p));
    recorded = installGame({ isGM, isActiveGM, combats: [combat] });
    ran = [];
    globalThis.Hooks.callAll = (...args) => ran.push(["hook", ...args]);
    globalThis.foundry.audio = { AudioHelper: { play: (data) => ran.push(["sound", data.src]) } };
    globalThis.ChatMessage = { implementation: { create: (data) => ran.push(["chat", data.whisper]) } };
    globalThis.game.modules = { get: () => null };
    globalThis.game.users.filter = () => [{ id: "gm" }];
    // Boss is the current phase: pointer on it, coming from Fast.
    combat.turn = combat.turns.findIndex((c) => c.id === "boss");
    combat.previous = { round: 2, combatantId: "a" };
    return combat;
  }

  const onEnter = [
    { id: "s", kind: "sound", params: { src: "roar.ogg", volume: 50 } },
    { id: "h", kind: "hook", params: { name: "bossStarts" } },
    { id: "c", kind: "chatMessage", params: { text: "The boss acts" } },
  ];

  beforeEach(() => {
    globalThis.fromUuid = async () => null;
  });

  it("runs a phase's actions once when it starts, never again in the same round", async () => {
    const combat = combatWith({ onEnter });
    const runner = new PhaseAutomationRunner({ adapter: null });
    await runner.onUpdateCombat(combat, { turn: 1 }, { [KEY]: { reason: "advance" } });
    await runner.onUpdateCombat(combat, { turn: 1 }, { [KEY]: { reason: "advance" } });
    assert.deepEqual(ran.map((r) => r[0]), ["sound", "hook", "chat"]);
  });

  it("does not run on going back", async () => {
    const combat = combatWith({ onEnter });
    await new PhaseAutomationRunner({ adapter: null }).onUpdateCombat(combat, { turn: 1 }, { [KEY]: { reason: "back" } });
    assert.deepEqual(ran, []);
  });

  it("keeps a hidden boss's local actions away from players, and GM actions away from other clients", async () => {
    const combat = combatWith({ onEnter, hidden: true, isGM: false });
    await new PhaseAutomationRunner({ adapter: null }).onUpdateCombat(combat, { turn: 1 }, { [KEY]: { reason: "advance" } });
    assert.deepEqual(ran, []);
    const seen = combatWith({ onEnter, hidden: false, isGM: false });
    await new PhaseAutomationRunner({ adapter: null }).onUpdateCombat(seen, { turn: 1 }, { [KEY]: { reason: "advance" } });
    assert.deepEqual(ran.map((r) => r[0]), ["sound", "hook"]);
  });

  it("whispers chat for a phase with a hidden member, even when set to all", async () => {
    const combat = combatWith({ onEnter, hidden: true });
    await new PhaseAutomationRunner({ adapter: null }).onUpdateCombat(combat, { turn: 1 }, { [KEY]: { reason: "advance" } });
    assert.deepEqual(ran.find((entry) => entry[0] === "chat")?.[1], ["gm"]);
  });

  it("passes only visible members to a player's local phase hook", async () => {
    const combat = combatWith({ onEnter: [{ id: "h", kind: "hook", params: { name: "bossStarts" } }], hidden: true, isGM: false });
    const visible = fakeCombatant({ id: "minion", initiative: 9, visible: true, flags: { side: "enemies", phase: "boss" } });
    combat.combatants.contents.push(visible);
    combat.turns.push(visible);
    await new PhaseAutomationRunner({ adapter: null }).onUpdateCombat(combat, { turn: 1 }, { [KEY]: { reason: "advance" } });
    assert.deepEqual(ran[0]?.[2]?.combatants.map((member) => member.id), ["minion"]);
  });

  it("refuses a macro a GM did not write, and a failing action does not stop the next", async () => {
    const combat = combatWith({ onEnter: [{ id: "m", kind: "macro", params: { macroUuid: "Macro.x" } }, { id: "t", kind: "rollTable", params: { tableUuid: "Table.gone" } }, { id: "h", kind: "hook", params: { name: "after" } }] });
    let executed = 0;
    globalThis.fromUuid = async (uuid) => (uuid === "Macro.x" ? { name: "Evil", author: { isGM: false }, execute: () => executed++ } : null);
    const quiet = console.error;
    console.error = () => {};
    await new PhaseAutomationRunner({ adapter: null }).onUpdateCombat(combat, { turn: 1 }, { [KEY]: { reason: "advance" } });
    console.error = quiet;
    assert.equal(executed, 0);
    assert.equal(recorded.warnings.length, 2);
    assert.deepEqual(ran.map((r) => r[0]), ["hook"]);
  });

  it("runs a GM's macro with the combat, the phase, the round and its combatants", async () => {
    const combat = combatWith({ onEnter: [{ id: "m", kind: "macro", params: { macroUuid: "Macro.ok" } }] });
    let scope = null;
    globalThis.fromUuid = async () => ({ name: "Roar", author: { isGM: true }, execute: (s) => (scope = s) });
    await new PhaseAutomationRunner({ adapter: null }).onUpdateCombat(combat, { turn: 1 }, { [KEY]: { reason: "advance" } });
    assert.equal(scope.combat, combat);
    assert.equal(scope.phase.id, "boss");
    assert.equal(scope.round, 2);
    assert.deepEqual(scope.combatants.map((c) => c.id), ["boss"]);
  });
});
