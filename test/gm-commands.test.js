import assert from "node:assert/strict";
import { describe, it } from "node:test";
import GmCommands from "../scripts/services/GmCommands.js";
import { fakeCombat, installGame } from "./helpers/fake-combat.js";

describe("GmCommands", () => {
  it("runs on the active GM", async () => {
    const combat = fakeCombat();
    const recorded = installGame({ isGM: true, isActiveGM: true, combats: [combat] });
    const commands = new GmCommands();
    const runs = [];
    commands.register("advance", (c, payload) => runs.push([c.id, payload]));
    await commands.execute("advance", combat, { force: true });
    assert.deepEqual(runs, [["combat", { force: true }]]);
    assert.equal(recorded.socket.length, 0);
  });

  it("sends from another GM, and players cannot send", async () => {
    const combat = fakeCombat();
    const recorded = installGame({ isGM: true, isActiveGM: false, combats: [combat] });
    const commands = new GmCommands();
    commands.register("advance", () => assert.fail("must not run locally"));
    await commands.execute("advance", combat, { force: true });
    assert.deepEqual(recorded.socket, [["module.sc-venaerys-initiative", { action: "advance", combatId: "combat", payload: { force: true } }]]);
    installGame({ isGM: false, isActiveGM: false, combats: [combat] });
    await new GmCommands().execute("advance", combat);
  });

  it("the relay accepts only GM senders and existing combats", async () => {
    const combat = fakeCombat();
    installGame({ isGM: true, isActiveGM: true, combats: [combat] });
    const commands = new GmCommands();
    const runs = [];
    commands.register("back", (c) => runs.push(c.id));
    await commands.relay.receive({ action: "back", combatId: "combat" }, "player");
    await commands.relay.receive({ action: "back", combatId: "nope" }, "co-gm");
    await commands.relay.receive({ action: "back", combatId: "combat" }, "co-gm");
    assert.deepEqual(runs, ["combat"]);
  });

  it("refuses on the requesting client when the precheck says so", async () => {
    const combat = fakeCombat();
    const recorded = installGame({ isGM: true, isActiveGM: false, combats: [combat] });
    const commands = new GmCommands();
    commands.register("back", () => {}, { precheck: () => "NoEarlierPhase" });
    await commands.execute("back", combat);
    assert.equal(recorded.socket.length, 0);
    assert.deepEqual(recorded.warnings, ["SC_VENAERYS_INITIATIVE.Notifications.NoEarlierPhase"]);
  });
});
