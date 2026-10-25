import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import GmBusyProbe from "../scripts/services/GmBusyProbe.js";
import { installGame } from "./helpers/fake-combat.js";

describe("GmBusyProbe", () => {
  let timers;
  let probe;
  beforeEach(() => {
    installGame();
    timers = [];
    probe = new GmBusyProbe({ setTimer: (fn) => timers.push(fn), clearTimer: () => {} });
  });

  const openDialog = () => foundry.applications.instances.set("roll", { id: "roll", options: { tag: "dialog" } });

  it("fires at once when the GM is free, without polling", () => {
    let fired = 0;
    probe.request("c", () => fired++);
    assert.equal(fired, 1);
    assert.equal(timers.length, 0);
  });

  it("holds while a dialog is open and fires once after two free reads", () => {
    openDialog();
    let fired = 0;
    probe.request("c", () => fired++);
    probe.request("c", () => fired++);
    assert.equal(probe.isWaiting("c"), true);
    timers.shift()();
    assert.equal(fired, 0);
    foundry.applications.instances.clear();
    timers.shift()();
    assert.equal(fired, 0);
    timers.shift()();
    assert.equal(fired, 1);
    assert.equal(timers.length, 0);
  });

  it("polls through the global timers without rebinding them to the probe", () => {
    // Browsers reject setTimeout/clearTimeout called with a receiver other than window.
    const realSet = globalThis.setTimeout;
    const realClear = globalThis.clearTimeout;
    const scheduled = [];
    globalThis.setTimeout = function (fn) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      scheduled.push(fn);
      return scheduled.length;
    };
    globalThis.clearTimeout = function () {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    };
    try {
      const realProbe = new GmBusyProbe();
      openDialog();
      let fired = 0;
      realProbe.request("c", () => fired++);
      assert.equal(scheduled.length, 1);
      realProbe.cancel("c");
      assert.equal(fired, 0);
    } finally {
      globalThis.setTimeout = realSet;
      globalThis.clearTimeout = realClear;
    }
  });

  it("ignores the main menu and counts legacy dialogs", () => {
    foundry.applications.instances.set("menu", { id: "menu", options: { tag: "dialog" } });
    assert.equal(probe.isBusy(), false);
    class LegacyDialog {}
    foundry.appv1 = { api: { Dialog: LegacyDialog } };
    ui.windows = { 1: new LegacyDialog() };
    assert.equal(probe.isBusy(), true);
  });
});
