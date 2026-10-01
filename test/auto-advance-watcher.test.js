import assert from "node:assert/strict";
import { describe, it } from "node:test";
import AutoAdvanceWatcher from "../scripts/services/AutoAdvanceWatcher.js";
import GmBusyProbe from "../scripts/services/GmBusyProbe.js";
import PhaseAdvancer from "../scripts/services/PhaseAdvancer.js";
import PhasePlacementWriter from "../scripts/services/PhasePlacementWriter.js";
import { fakeCombat, fakeCombatant, installGame, manualFrames } from "./helpers/fake-combat.js";

const KEY = "sc-venaerys-initiative";
const own = { [KEY]: { reason: "done" } };
const p = (id, phase, initiative, flags = {}) => fakeCombatant({ id, initiative, flags: { side: "players", phase, ...flags } });
const e = (id, phase, initiative = 10, flags = {}) => fakeCombatant({ id, initiative, flags: { side: "enemies", phase, ...flags } });

function build(combat, { game = {}, busy = false } = {}) {
  const recorded = installGame({ combats: [combat], ...game });
  const writer = new PhasePlacementWriter({ adapter: null, advance: (c, o) => advancer.advance(c, o) });
  const advancer = new PhaseAdvancer({ adapter: null, writer });
  const timers = [];
  const probe = new GmBusyProbe({ setTimer: (fn) => timers.push(fn), clearTimer: () => {} });
  probe.isBusy = () => (typeof busy === "function" ? busy() : busy);
  const frames = manualFrames();
  const watcher = new AutoAdvanceWatcher({ adapter: null, advancer, probe, requestFrame: frames.requestFrame });
  return { watcher, frames, recorded, probe, timers, advancer };
}

/** Fast with Ana and Bruno, Enemies after; pointer on Bruno. */
function fastCombat(flags = {}) {
  const combat = fakeCombat({ round: 2, flags, combatants: [p("ana", "fast", 18, { done: 2 }), p("bruno", "fast", 16, { done: 2 }), e("g", "enemies")] });
  combat.turn = 1;
  return combat;
}

describe("AutoAdvanceWatcher", () => {
  it("asks for one advance for several marks in the same frame", async () => {
    const combat = fastCombat();
    const { watcher, frames } = build(combat);
    watcher.onUpdateCombatant(combat.combatants.get("ana"), { flags: { [KEY]: { done: 2 } } }, own);
    watcher.onUpdateCombatant(combat.combatants.get("bruno"), { flags: { [KEY]: { done: 2 } } }, own);
    assert.equal(frames.size, 1);
    await frames.run();
    assert.equal(combat.writes("update").length, 1);
    assert.equal(combat.combatant.id, "g");
  });

  it("does nothing when the setting is off, or on a client that is not the active GM", async () => {
    const off = fastCombat();
    const first = build(off, { game: { settings: { autoAdvance: false } } });
    first.watcher.mark(off);
    await first.frames.run();
    assert.equal(off.writes("update").length, 0);
    const other = fastCombat();
    const second = build(other, { game: { isActiveGM: false } });
    second.watcher.mark(other);
    assert.equal(second.frames.size, 0);
  });

  it("re-reads every combat on a defeat status effect, ignores other effects", () => {
    const combat = fastCombat();
    const { watcher, frames } = build(combat);
    watcher.onActiveEffect({ statuses: new Set(["prone"]) });
    assert.equal(frames.size, 0);
    watcher.onActiveEffect({ statuses: new Set(["dead"]) });
    assert.equal(frames.size, 1);
    watcher.onActiveEffect({ statuses: new Set() }, { disabled: true });
  });

  it("keeps a suspended phase until the next mark there, which lifts it", async () => {
    const combat = fastCombat({ suspendedAdvance: "2:fast" });
    const { watcher, frames } = build(combat);
    watcher.mark(combat);
    await frames.run();
    assert.equal(combat.writes("update").length, 0);
    watcher.onUpdateCombatant(combat.combatants.get("ana"), { flags: { [KEY]: { done: 2 } } }, own);
    await frames.run();
    assert.equal(combat.combatant.id, "g");
    assert.equal(combat.flags[KEY].suspendedAdvance, null);
  });

  it("re-anchors only after a change the module did not make that moved the pointer", async () => {
    const fresh = () => {
      const combat = fakeCombat({ round: 2, combatants: [p("ana", "fast", 18), p("bruno", "fast", 16), e("g", "enemies")] });
      combat.turn = 1;
      return combat;
    };
    const ownMove = fresh();
    const first = build(ownMove);
    first.watcher.reviewAll();
    await first.frames.run();
    ownMove.turn = 0;
    first.watcher.onUpdateCombat(ownMove, { turn: 0 }, { [KEY]: { reason: "advance" } });
    await first.frames.run();
    assert.equal(ownMove.writes("update").length, 0);

    const rawMove = fresh();
    const second = build(rawMove);
    second.watcher.reviewAll();
    await second.frames.run();
    rawMove.turn = 0; // a raw write of turn, from a dock or a macro
    second.watcher.onUpdateCombat(rawMove, { turn: 0 }, {});
    await second.frames.run();
    const [write] = rawMove.writes("update");
    assert.equal(write.options[KEY].reason, "anchor");
    assert.equal(rawMove.combatant.id, "bruno");
  });

  it("re-anchors a pointer left on a pending combatant to the last known phase", async () => {
    const combat = fakeCombat({ round: 2, combatants: [p("ana", "fast", 18), e("g", "enemies"), fakeCombatant({ id: "pend", flags: { side: "players", phase: null } })] });
    combat.turn = 1;
    const { watcher, frames } = build(combat);
    watcher.reviewAll();
    await frames.run();
    combat.turn = 2;
    watcher.onUpdateCombat(combat, { turn: 2 }, {});
    await frames.run();
    assert.equal(combat.combatant.id, "g");
  });

  it("the new active GM reviews phased combats once and advances a complete phase", async () => {
    const combat = fastCombat();
    const { watcher, frames } = build(combat, { game: { isActiveGM: false } });
    watcher.onUserConnected();
    assert.equal(frames.size, 0);
    game.user.isActiveGM = true;
    game.users.activeGM = game.user;
    watcher.onUserConnected();
    await frames.run();
    watcher.onUserConnected();
    assert.equal(frames.size, 0);
    assert.equal(combat.writes("update").length, 1);
  });

  it("waits for the GM's dialog to close and fires after two free reads", async () => {
    let busy = true;
    const combat = fastCombat();
    const { watcher, frames, probe, timers } = build(combat, { busy: () => busy });
    watcher.mark(combat);
    await frames.run();
    assert.equal(probe.isWaiting(combat.id), true);
    assert.equal(combat.writes("update").length, 0);
    busy = false;
    timers.shift()();
    assert.equal(combat.writes("update").length, 0);
    timers.shift()();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(combat.writes("update").length, 1);
    assert.equal(probe.isWaiting(combat.id), false);
  });

  it("Complete phase advances at once, busy GM or automatic advance off, with a single advance write", async () => {
    const combat = fakeCombat({ round: 2, combatants: [e("k1", "enemies", 9), e("k2", "enemies", 8), p("s", "slow", 3)] });
    combat.turn = 1;
    const { watcher, frames, advancer } = build(combat, { busy: true, game: { settings: { autoAdvance: false } } });
    await advancer.complete(combat);
    watcher.onUpdateCombatant(combat.combatants.get("k1"), { flags: { [KEY]: { done: 2 } } }, own);
    await frames.run();
    assert.equal(combat.writes("update").length, 1);
    assert.equal(combat.combatant.id, "s");
  });
});
