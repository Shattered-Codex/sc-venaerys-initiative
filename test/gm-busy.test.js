import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBusy, isBusyApp, nextFreeCount } from "../scripts/helpers/gm-busy.js";

class DialogV2 {}
class RollResolver {}
class LegacyDialog {}

describe("what counts as a busy dialog", () => {
  it("counts any dialog-tagged application", () => {
    assert.equal(isBusyApp({ id: "roll-config", options: { tag: "dialog" } }), true);
    assert.equal(isBusyApp({ id: "sheet", options: { tag: "form" } }), false);
  });

  it("never counts the main menu", () => {
    assert.equal(isBusyApp({ id: "menu", options: { tag: "dialog" } }), false);
  });

  it("counts instances of the given classes and skips the ones that do not exist", () => {
    const resolver = Object.assign(new RollResolver(), { id: "r", options: { tag: "form" } });
    assert.equal(isBusyApp(resolver, [DialogV2, RollResolver, undefined, null]), true);
    assert.equal(isBusyApp({ id: "x", options: {} }, [undefined]), false);
  });

  it("looks at legacy windows too", () => {
    assert.equal(isBusy({ apps: [], legacyWindows: [new LegacyDialog()], LegacyDialog }), true);
    assert.equal(isBusy({ apps: [], legacyWindows: [{}], LegacyDialog }), false);
    assert.equal(isBusy({ apps: [{ id: "menu", options: { tag: "dialog" } }], legacyWindows: [{}], LegacyDialog: null }), false);
  });
});

describe("two free reads in a row", () => {
  it("fires only after two consecutive free reads and restarts on a busy one", () => {
    let state = nextFreeCount(0, false);
    assert.deepEqual(state, { count: 1, fire: false });
    state = nextFreeCount(state.count, true);
    assert.deepEqual(state, { count: 0, fire: false });
    state = nextFreeCount(state.count, false);
    state = nextFreeCount(state.count, false);
    assert.deepEqual(state, { count: 2, fire: true });
  });
});
