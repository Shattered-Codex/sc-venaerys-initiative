import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import ErrorGuard from "../scripts/services/ErrorGuard.js";
import { installGame } from "./helpers/fake-combat.js";

describe("ErrorGuard", () => {
  let recorded;
  const quiet = console.error;
  beforeEach(() => {
    recorded = installGame({ isGM: true });
    ErrorGuard.reset();
    console.error = (...args) => recorded.errors.push(args);
  });

  it("keeps a throwing hook handler from reaching the core and passes return values through", () => {
    let handler;
    globalThis.Hooks.on = (_name, fn) => (handler = fn);
    ErrorGuard.on("preUpdateCombat", "x", () => {
      throw new Error("boom");
    });
    assert.equal(handler(), undefined);
    ErrorGuard.on("preUpdateCombat", "y", () => false);
    assert.equal(handler(), false);
    console.error = quiet;
  });

  it("catches a rejected promise", async () => {
    let handler;
    globalThis.Hooks.on = (_name, fn) => (handler = fn);
    ErrorGuard.on("updateCombat", "async", async () => {
      throw new Error("later");
    });
    await handler();
    assert.equal(recorded.errors.length, 1);
    console.error = quiet;
  });

  it("falls back to the original with the same this and arguments", async () => {
    const calls = [];
    const fallback = function (...args) {
      calls.push([this, ...args]);
      return "native";
    };
    const self = { id: "combat" };
    const syncGuard = ErrorGuard.wrap("sort", () => {
      throw new Error("x");
    }, fallback);
    assert.equal(syncGuard.call(self, 1, 2), "native");
    const asyncGuard = ErrorGuard.wrap("start", async () => {
      throw new Error("y");
    }, fallback);
    assert.equal(await asyncGuard.call(self, 3), "native");
    assert.deepEqual(calls, [[self, 1, 2], [self, 3]]);
    console.error = quiet;
  });

  it("warns the GM once per label and players only see the console", () => {
    const fail = ErrorGuard.wrap("same", () => {
      throw new Error("x");
    });
    fail();
    fail();
    ErrorGuard.wrap("other", () => {
      throw new Error("x");
    })();
    assert.equal(recorded.warnings.length, 2);
    recorded = installGame({ isGM: false });
    ErrorGuard.reset();
    ErrorGuard.wrap("player", () => {
      throw new Error("x");
    })();
    assert.equal(recorded.warnings.length, 0);
    console.error = quiet;
  });
});
