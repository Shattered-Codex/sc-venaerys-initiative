import assert from "node:assert/strict";
import { describe, it } from "node:test";
import AutoAdvanceWatcher from "../scripts/services/AutoAdvanceWatcher.js";
import CombatStartGuard from "../scripts/services/CombatStartGuard.js";
import CombatantClassifier from "../scripts/services/CombatantClassifier.js";
import DoneMarkers from "../scripts/services/DoneMarkers.js";
import GmBusyProbe from "../scripts/services/GmBusyProbe.js";
import PhaseAdvancer from "../scripts/services/PhaseAdvancer.js";
import PhasePlacementWriter from "../scripts/services/PhasePlacementWriter.js";
import TurnInterceptor from "../scripts/services/TurnInterceptor.js";
import { fakeCombat, fakeCombatant, installGame, manualFrames } from "./helpers/fake-combat.js";

/** A combat with phases off must behave exactly like Foundry's. */
describe("a combat without phases", () => {
  it("gets no write on combatants, turn or round, and native navigation passes", async () => {
    const goblin = fakeCombatant({ id: "g", initiative: null });
    const ana = fakeCombatant({ id: "ana", initiative: 12, hasPlayerOwner: true });
    const combat = fakeCombat({ phased: false, round: 2, combatants: [goblin, ana], flags: { enabled: false } });
    installGame({ combats: [combat] });
    const writer = new PhasePlacementWriter({ adapter: null, advance: (c, o) => advancer.advance(c, o) });
    const advancer = new PhaseAdvancer({ adapter: null, writer });
    const frames = manualFrames();
    const classifier = new CombatantClassifier({ adapter: null, writer, requestFrame: frames.requestFrame });
    const watcher = new AutoAdvanceWatcher({ adapter: null, advancer, probe: new GmBusyProbe(), requestFrame: frames.requestFrame });
    const markers = new DoneMarkers({ adapter: null });
    const interceptor = new TurnInterceptor({ adapter: null, commands: { execute: () => assert.fail("no command") }, doneMarkers: markers });

    classifier.onCreateCombatant(goblin);
    classifier.onUpdateCombatant(ana, { initiative: 12 }, {});
    classifier.onUpdateCombat(combat, { combatants: [] }, {});
    watcher.onUpdateCombat(combat, { turn: 1 }, {});
    watcher.onUpdateCombatant(ana, { flags: {} }, {});
    await frames.run();
    await advancer.advance(combat, { force: true });
    await advancer.back(combat);
    await advancer.anchor(combat);
    assert.equal(await markers.setDone(combat, "ana", true), false);

    const options = {};
    assert.equal(interceptor.onPreUpdateCombat(combat, { round: 2, turn: 1 }, { direction: 1 }), undefined);
    interceptor.onPreDeleteCombatant(ana, options);
    assert.deepEqual(options, {});
    assert.deepEqual(combat.calls.filter((c) => c.type !== "setupTurns"), []);
  });

  it("starts through the original startCombat with no dialog", async () => {
    const combat = fakeCombat({ phased: false, round: 0, turn: null, combatants: [fakeCombatant({ id: "p" })] });
    installGame({ combats: [combat] });
    let started = 0;
    globalThis.CONFIG.Combat.documentClass = { prototype: { startCombat: () => started++ } };
    globalThis.foundry.applications.api.DialogV2 = { wait: () => assert.fail("no dialog") };
    new CombatStartGuard({ adapter: null }).install();
    await CONFIG.Combat.documentClass.prototype.startCombat.call(combat);
    assert.equal(started, 1);
  });
});
