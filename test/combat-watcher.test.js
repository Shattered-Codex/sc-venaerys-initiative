import assert from "node:assert/strict";
import { describe, it } from "node:test";
import CombatWatcher from "../scripts/services/CombatWatcher.js";
import { fakeCombat, installGame, manualFrames } from "./helpers/fake-combat.js";

const KEY = "sc-venaerys-initiative";

function fakeTracker() {
  return {
    renders: 0,
    activated: 0,
    popouts: 0,
    popout: null,
    render() {
      this.renders += 1;
    },
    activate() {
      this.activated += 1;
    },
    renderPopout() {
      this.popouts += 1;
    },
  };
}

function build({ openOnStart = true, isGM = false, patchResult = true } = {}) {
  const combat = fakeCombat({ round: 1 });
  combat.previous = { round: 0 };
  installGame({ isGM, isActiveGM: isGM, combats: [combat], settings: { openOnStart } });
  game.combat = combat;
  const tracker = fakeTracker();
  tracker.viewed = combat;
  globalThis.ui.combat = tracker;
  const patches = [];
  const frames = manualFrames();
  const watcher = new CombatWatcher({ patchDone: (ids) => (patches.push(ids), patchResult), requestFrame: frames.requestFrame });
  return { combat, tracker, frames, watcher, patches };
}

const done = (id) => ({ _id: id, flags: { [KEY]: { done: 2 } }, _stats: { modifiedTime: 1 } });

describe("CombatWatcher", () => {
  it("shows the combat tab when a phased combat starts, only with the user's setting on", () => {
    const on = build();
    on.watcher.onUpdateCombat(on.combat);
    assert.equal(on.tracker.activated, 1);
    const off = build({ openOnStart: false });
    off.watcher.onUpdateCombat(off.combat);
    assert.equal(off.tracker.activated, 0);
  });

  it("brings the popout forward instead when it is open", () => {
    const { combat, tracker, watcher } = build();
    let fronted = 0;
    tracker.popout = { rendered: true, bringToFront: () => fronted++ };
    watcher.onUpdateCombat(combat);
    assert.equal(fronted, 1);
    assert.equal(tracker.activated, 0);
  });

  it("shows the tracker again after a reload only for a phased combat already under way", () => {
    const running = build();
    running.watcher.openIfRunning();
    assert.equal(running.tracker.activated, 1);
    const notStarted = build();
    notStarted.combat.round = 0;
    notStarted.watcher.openIfRunning();
    assert.equal(notStarted.tracker.activated, 0);
  });

  it("opens the tracker popout for the module's API", () => {
    const { tracker, watcher } = build();
    watcher.open();
    assert.equal(tracker.popouts, 1);
  });

  it("patches rows for players when only done marks changed, with no render", async () => {
    const { combat, tracker, frames, watcher, patches } = build();
    watcher.onUpdateCombatant({ id: "a", parent: combat }, done("a"));
    watcher.onUpdateCombatant({ id: "b", parent: combat }, done("b"));
    await frames.run();
    assert.deepEqual(patches, [["a", "b"]]);
    assert.equal(tracker.renders, 0);
  });

  it("renders for the GM, whose panel reads the marks too, and when a patch cannot apply", async () => {
    const gm = build({ isGM: true });
    gm.watcher.onUpdateCombatant({ id: "a", parent: gm.combat }, done("a"));
    await gm.frames.run();
    assert.equal(gm.tracker.renders, 1);
    const stale = build({ patchResult: false });
    stale.watcher.onUpdateCombatant({ id: "a", parent: stale.combat }, done("a"));
    await stale.frames.run();
    assert.equal(stale.tracker.renders, 1);
  });

  it("asks for one render per frame on a setting change and adds none for combat changes", async () => {
    const { combat, tracker, frames, watcher } = build();
    watcher.render();
    watcher.render();
    watcher.onUpdateCombatant({ id: "a", parent: combat }, { _id: "a", initiative: 3 });
    await frames.run();
    assert.equal(tracker.renders, 1);
  });

  it("tells done-only changes apart", () => {
    assert.equal(CombatWatcher.isDoneOnly({ _id: "a", flags: { [KEY]: { done: 1 } } }), true);
    assert.equal(CombatWatcher.isDoneOnly(done("a")), true);
    assert.equal(CombatWatcher.isDoneOnly({ _id: "a", flags: { [KEY]: { done: 1, phase: "fast" } } }), false);
    assert.equal(CombatWatcher.isDoneOnly({ _id: "a", initiative: 3 }), false);
    assert.equal(CombatWatcher.isDoneOnly({ _id: "a", flags: { [KEY]: { done: 1 }, other: { x: 1 } } }), false);
  });
});
