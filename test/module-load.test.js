import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { installFoundryStubs, moduleRecord, registered } from "./helpers/foundry-stub.js";

/**
 * Loads the whole ES graph against a stubbed Foundry. A broken import or a
 * class extending something that does not exist takes the module down at
 * load, long before any combat is run.
 */
describe("module entry point", () => {
  let proto;
  before(async () => {
    installFoundryStubs();
    proto = { _sortCombatants: () => 0, startCombat: () => "native", nextTurn: () => "native" };
    globalThis.CONFIG.Combat = { documentClass: { prototype: proto }, initiative: { decimals: 2 } };
    globalThis.CONFIG.ui = { combat: class CoreTracker {} };
    await import("../scripts/module.js");
  });

  it("wires init, setup and ready", () => {
    assert.ok(registered.once.has("init"));
    assert.ok(registered.once.has("setup"));
    assert.ok(registered.once.has("ready"));
  });

  it("runs init, setup and ready without throwing and installs the wrappers", () => {
    const sort = proto._sortCombatants;
    const start = proto.startCombat;
    registered.once.get("init")();
    assert.notEqual(proto._sortCombatants, sort);
    registered.once.get("setup")();
    assert.notEqual(proto.startCombat, start);
    assert.notEqual(proto.nextTurn, undefined);
    assert.equal(Object.getPrototypeOf(CONFIG.ui.combat).name, "CoreTracker");
    registered.once.get("ready")();
    assert.equal(typeof moduleRecord.api.open, "function");
  });

  it("listens to the combat hooks it needs", () => {
    for (const hook of ["updateCombat", "createCombat", "preUpdateCombat", "createCombatant", "updateCombatant", "deleteCombatant", "preDeleteCombatant", "userConnected"]) {
      assert.ok(registered.on.has(hook), hook);
    }
  });
});
