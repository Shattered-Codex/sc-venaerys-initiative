import assert from "node:assert/strict";
import { describe, it } from "node:test";
import CombatWatcher from "../scripts/services/CombatWatcher.js";
import { fakeCombat, installGame, manualFrames } from "./helpers/fake-combat.js";

const KEY = "sc-venaerys-initiative";

function fakeApp() {
  return {
    rendered: false,
    combatId: null,
    renders: [],
    patches: [],
    closed: 0,
    render(options = {}) {
      this.rendered = true;
      this.renders.push(options);
      return this;
    },
    patchDone(ids) {
      this.patches.push(ids);
      return true;
    },
    close() {
      this.rendered = false;
      this.closed += 1;
    },
  };
}

function build({ openOnStart = true, isGM = false } = {}) {
  const combat = fakeCombat({ round: 1 });
  combat.previous = { round: 0 };
  installGame({ isGM, isActiveGM: isGM, combats: [combat], settings: { openOnStart } });
  game.combat = combat;
  const app = fakeApp();
  const frames = manualFrames();
  const watcher = new CombatWatcher({ createApp: () => app, requestFrame: frames.requestFrame });
  return { combat, app, frames, watcher };
}

describe("CombatWatcher", () => {
  it("opens when a phased combat starts, only with the user's setting on", () => {
    const on = build();
    on.watcher.onUpdateCombat(on.combat, { round: 1 });
    assert.equal(on.app.renders.length, 1);
    const off = build({ openOnStart: false });
    off.watcher.onUpdateCombat(off.combat, { round: 1 });
    assert.equal(off.app.renders.length, 0);
  });

  it("reopens after a reload only for a phased combat already under way", () => {
    const running = build();
    running.watcher.openIfRunning();
    assert.equal(running.app.renders.length, 1);
    const notStarted = build();
    notStarted.combat.round = 0;
    notStarted.watcher.openIfRunning();
    assert.equal(notStarted.app.renders.length, 0);
    const optedOut = build({ openOnStart: false });
    optedOut.watcher.openIfRunning();
    assert.equal(optedOut.app.renders.length, 0);
  });

  it("closes when its combat is deleted", () => {
    const { combat, app, watcher } = build();
    watcher.open();
    app.combatId = combat.id;
    watcher.onDeleteCombat(combat);
    assert.equal(app.closed, 1);
  });

  it("turns a burst of hooks into one render on the next frame", async () => {
    const { combat, app, frames, watcher } = build();
    watcher.open();
    combat.previous = { round: 1 };
    watcher.onUpdateCombat(combat, { turn: 2 });
    watcher.onUpdateCombatant({ id: "a" }, { initiative: 3 });
    watcher.render();
    assert.equal(frames.size, 1);
    await frames.run();
    assert.deepEqual(app.renders.slice(1), [{}]);
  });

  it("patches rows when only done marks changed, without rendering for players", async () => {
    const { app, frames, watcher } = build();
    watcher.open();
    watcher.onUpdateCombatant({ id: "a" }, { _id: "a", flags: { [KEY]: { done: 2 } } });
    watcher.onUpdateCombatant({ id: "b" }, { _id: "b", flags: { [KEY]: { done: null } } });
    await frames.run();
    assert.deepEqual(app.patches, [["a", "b"]]);
    assert.equal(app.renders.length, 1);
  });

  it("re-renders only the GM's header alongside a patch", async () => {
    const { app, frames, watcher } = build({ isGM: true });
    watcher.open();
    watcher.onUpdateCombatant({ id: "a" }, { _id: "a", flags: { [KEY]: { done: 2 } } });
    await frames.run();
    assert.deepEqual(app.renders.slice(1), [{ parts: ["header"] }]);
  });

  it("tells done-only changes apart", () => {
    assert.equal(CombatWatcher.isDoneOnly({ _id: "a", flags: { [KEY]: { done: 1 } } }), true);
    assert.equal(CombatWatcher.isDoneOnly({ _id: "a", flags: { [KEY]: { done: 1 } }, _stats: { modifiedTime: 1 } }), true);
    assert.equal(CombatWatcher.isDoneOnly({ _id: "a", flags: { [KEY]: { done: 1, phase: "fast" } } }), false);
    assert.equal(CombatWatcher.isDoneOnly({ _id: "a", initiative: 3 }), false);
    assert.equal(CombatWatcher.isDoneOnly({ _id: "a", flags: { [KEY]: { done: 1 }, other: { x: 1 } } }), false);
  });

  it("does nothing while the window is closed", async () => {
    const { app, frames, watcher } = build();
    watcher.render();
    await frames.run();
    assert.equal(app.renders.length, 0);
  });
});
