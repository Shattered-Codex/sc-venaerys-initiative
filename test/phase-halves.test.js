import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  advanceTarget,
  backTarget,
  currentHalf,
  isAdvanceSuspended,
  isMovementComplete,
  isSplitPhase,
  shouldAutoAdvance,
} from "../scripts/helpers/phase-progression.js";
import CombatPhaseProjector from "../scripts/services/CombatPhaseProjector.js";
import CombatSetup from "../scripts/services/CombatSetup.js";
import DoneMarkers from "../scripts/services/DoneMarkers.js";
import PhaseAdvancer from "../scripts/services/PhaseAdvancer.js";
import PhasePlacementWriter from "../scripts/services/PhasePlacementWriter.js";
import { combatView, enemy, player } from "./helpers/combat-view.js";
import { fakeCombat, fakeCombatant, installGame } from "./helpers/fake-combat.js";

const KEY = "sc-venaerys-initiative";

/** Round 2 with Fast split: Ana and Bruno in Fast (pointer on Bruno), a goblin in Enemies. */
function splitView({ ana = {}, bruno = {}, actionsHalf = null, split = "players", suspendedAdvance = null } = {}) {
  return combatView({
    round: 2,
    on: "bruno",
    split,
    actionsHalf,
    suspendedAdvance,
    combatants: [player("ana", "fast", ana), player("bruno", "fast", bruno), enemy("gob")],
  });
}

describe("which phases split", () => {
  it("follows the combat's mode: players' phases, every creature phase, never an event phase", () => {
    const view = (split) => combatView({ split });
    assert.equal(isSplitPhase(view("off"), "fast"), false);
    assert.equal(isSplitPhase(view("players"), "fast"), true);
    assert.equal(isSplitPhase(view("players"), "slow"), true);
    assert.equal(isSplitPhase(view("players"), "enemies"), false);
    assert.equal(isSplitPhase(view("all"), "enemies"), true);
    assert.equal(isSplitPhase(view("all"), "boss"), true);
    assert.equal(isSplitPhase(view("all"), "lair"), false);
    assert.equal(isSplitPhase(combatView({}), "fast"), false);
  });
});

describe("the two halves", () => {
  it("starts in movement and runs the actions half only while the key names this phase and round", () => {
    assert.equal(currentHalf(splitView()), "move");
    assert.equal(currentHalf(splitView({ actionsHalf: "2:fast" })), "act");
    assert.equal(currentHalf(splitView({ actionsHalf: "1:fast" })), "move");
    assert.equal(currentHalf(splitView({ split: "off", actionsHalf: "2:fast" })), null);
  });

  it("ends the movement half when every living member has moved or is done", () => {
    assert.equal(isMovementComplete(splitView({ ana: { moved: 2 } }), "fast"), false);
    assert.equal(isMovementComplete(splitView({ ana: { moved: 2 }, bruno: { done: 2 } }), "fast"), true);
    assert.equal(isMovementComplete(splitView({ ana: { moved: 1 }, bruno: { moved: 2 } }), "fast"), false);
    assert.equal(isMovementComplete(splitView({ ana: { isDefeated: true }, bruno: { moved: 2 } }), "fast"), true);
  });

  it("advances automatically to the actions half, then to the next phase", () => {
    const moved = splitView({ ana: { moved: 2 }, bruno: { moved: 2 } });
    assert.equal(shouldAutoAdvance(moved), true);
    assert.deepEqual(advanceTarget(moved), { half: "act", phaseId: "fast" });
    const acting = splitView({ ana: { moved: 2 }, bruno: { moved: 2 }, actionsHalf: "2:fast" });
    assert.equal(shouldAutoAdvance(acting), false);
    const done = splitView({ ana: { done: 2 }, bruno: { done: 2 }, actionsHalf: "2:fast" });
    assert.equal(shouldAutoAdvance(done), true);
    assert.equal(advanceTarget(done).phaseId, "enemies");
  });

  it("goes straight to the next phase from movement when everyone is already done", () => {
    assert.equal(advanceTarget(splitView({ ana: { done: 2 }, bruno: { done: 2 } })).phaseId, "enemies");
  });

  it("goes back half a phase, and into the actions half of an earlier split phase", () => {
    assert.deepEqual(backTarget(splitView({ actionsHalf: "2:fast" })), { half: "move", phaseId: "fast", suspend: "2:fast:move" });
    const enemiesNow = combatView({ round: 2, on: "gob", split: "players", combatants: [player("ana", "fast", { done: 2 }), enemy("gob")] });
    assert.deepEqual(backTarget(enemiesNow), { turn: 0, phaseId: "fast", half: "act", suspend: "2:fast:act" });
  });

  it("suspends the automatic advance per half", () => {
    const back = splitView({ ana: { moved: 2 }, bruno: { moved: 2 }, suspendedAdvance: "2:fast:move" });
    assert.equal(isAdvanceSuspended(back), true);
    assert.equal(shouldAutoAdvance(back), false);
    assert.equal(isAdvanceSuspended(splitView({ suspendedAdvance: "2:fast:move", actionsHalf: "2:fast" })), false);
  });
});

describe("PhaseAdvancer between halves", () => {
  const p = (id, phase, flags = {}) => fakeCombatant({ id, initiative: 15, flags: { side: "players", phase, ...flags } });
  function build(flags = {}, members = {}) {
    const combat = fakeCombat({
      round: 2,
      flags: { split: "players", ...flags },
      combatants: [p("ana", "fast", members.ana), p("bruno", "fast", members.bruno), fakeCombatant({ id: "gob", initiative: 10, flags: { side: "enemies", phase: "enemies" } })],
    });
    combat.turn = combat.turns.findIndex((c) => c.id === (members.on ?? "bruno"));
    const recorded = installGame({ combats: [combat] });
    const writer = new PhasePlacementWriter({ adapter: null, advance: (c, o) => advancer.advance(c, o) });
    const advancer = new PhaseAdvancer({ adapter: null, writer });
    return { combat, advancer, recorded };
  }

  it("moves to the actions half with one flag write: no turn, no turn hook", async () => {
    const { combat, advancer, recorded } = build({}, { ana: { moved: 2 }, bruno: { moved: 2 } });
    assert.equal(await advancer.advance(combat), true);
    const [write] = combat.writes("update");
    assert.deepEqual(write.data, { [`flags.${KEY}.actionsHalf`]: "2:fast", [`flags.${KEY}.suspendedAdvance`]: null });
    assert.equal(write.options[KEY].reason, "half");
    assert.equal(recorded.hooks.length, 0);
    assert.equal(combat.combatant.id, "bruno");
  });

  it("goes back from actions to movement and suspends the advance there", async () => {
    const { combat, advancer } = build({ actionsHalf: "2:fast" });
    assert.equal(await advancer.back(combat), true);
    assert.deepEqual(combat.writes("update")[0].data, { [`flags.${KEY}.actionsHalf`]: null, [`flags.${KEY}.suspendedAdvance`]: "2:fast:move" });
  });

  it("lands in the actions half when going back into a split phase", async () => {
    const { combat, advancer } = build({}, { ana: { done: 2 }, bruno: { done: 2 }, on: "gob" });
    await advancer.back(combat);
    const [write] = combat.writes("update");
    assert.equal(write.data[`flags.${KEY}.actionsHalf`], "2:fast");
    assert.equal(write.data[`flags.${KEY}.suspendedAdvance`], "2:fast:act");
  });

  it("keys each half apart, so one advance request per half", () => {
    const view = (actionsHalf) => ({ ...splitView({ actionsHalf }), started: true });
    assert.equal(PhaseAdvancer.keyOf(view(null)), "2:fast:move");
    assert.equal(PhaseAdvancer.keyOf(view("2:fast")), "2:fast:act");
  });
});

describe("Moved marks", () => {
  function setup({ isGM = false, actionsHalf = null, onFast = true } = {}) {
    const ana = fakeCombatant({ id: "ana", initiative: 15, isOwner: true, flags: { side: "players", phase: "fast" } });
    const slow = fakeCombatant({ id: "slow", initiative: 5, flags: { side: "players", phase: "slow" } });
    const gob = fakeCombatant({ id: "gob", initiative: 10, flags: { side: "enemies", phase: "enemies" } });
    const combat = fakeCombat({ round: 2, flags: { split: "players", actionsHalf }, combatants: [ana, gob, slow] });
    combat.turn = combat.turns.indexOf(onFast ? ana : gob);
    installGame({ isGM });
    return { combat, markers: new DoneMarkers({ adapter: null }), ana, slow };
  }

  it("lets the owner mark their own movement in a split phase, and nowhere else", async () => {
    const { combat, markers, ana } = setup();
    assert.equal(await markers.setMoved(combat, "ana", true), true);
    assert.deepEqual(ana.updates[0].data, { [`flags.${KEY}.moved`]: 2 });
    assert.equal(await markers.setMoved(combat, "gob", true), false);
  });

  it("ends the owner's movement on 'end turn' in the movement half, and the turn in the actions half", async () => {
    const moving = setup();
    await moving.markers.markOwn(moving.combat);
    assert.deepEqual(moving.combat.writes("embedded")[0].updates, [{ _id: "ana", [`flags.${KEY}.moved`]: 2 }]);
    const acting = setup({ actionsHalf: "2:fast" });
    await acting.markers.markOwn(acting.combat);
    assert.deepEqual(acting.combat.writes("embedded")[0].updates, [{ _id: "ana", [`flags.${KEY}.done`]: 2 }]);
  });

  it("skips both halves of a phase still to come, and undoes both", async () => {
    const { combat, markers, slow } = setup({ isGM: true });
    await markers.setDone(combat, "slow", true);
    assert.deepEqual(slow.updates[0].data, { [`flags.${KEY}.done`]: 2, [`flags.${KEY}.moved`]: 2 });
    await markers.setDone(combat, "slow", false);
    assert.deepEqual(slow.updates[1].data, { [`flags.${KEY}.done`]: null, [`flags.${KEY}.moved`]: null });
  });
});

describe("halves in the tracker", () => {
  const options = { localize: (key) => key, format: (key, data) => `${key}${JSON.stringify(data)}`, decimals: 2 };
  const settings = { showDcToPlayers: false, autoAdvance: true };
  const fast = (model) => model.phases.find((p) => p.id === "fast");

  it("names the running half, counts its marks and shows Moved instead of Done while moving", () => {
    const view = splitView({ ana: { moved: 2, isOwner: true } });
    const model = CombatPhaseProjector.project(view, { isGM: false }, settings, options);
    assert.match(fast(model).name, /Tracker\.HalfName.*Tracker\.Half\.move/);
    assert.match(fast(model).count, /Tracker\.MovedCount.*"done":1/);
    const [ana] = fast(model).rows;
    assert.equal(ana.doneButton, null);
    assert.equal(ana.movedButton.pressed, true);
    const acting = CombatPhaseProjector.project(splitView({ ana: { moved: 2, isOwner: true }, actionsHalf: "2:fast" }), { isGM: false }, settings, options);
    assert.match(fast(acting).name, /Tracker\.Half\.act/);
    assert.equal(fast(acting).rows[0].movedButton, null);
    assert.equal(fast(acting).rows[0].doneButton.pressed, false);
  });
});

describe("the split is the combat's own", () => {
  it("is copied from the setting when the combat is set up", () => {
    installGame({ settings: { splitPhases: "players", dcSource: "manual" } });
    assert.equal(CombatSetup.initialFlags({ enabled: true }).split, "players");
  });
});

describe("review fixes for split phases", () => {
  const p = (id, phase, flags = {}, extra = {}) => fakeCombatant({ id, initiative: 15, ...extra, flags: { side: "players", phase, ...flags } });

  it("completes only the movement half with 'Complete phase' during movement, then goes to actions", async () => {
    const combat = fakeCombat({ round: 2, flags: { split: "players" }, combatants: [p("ana", "fast"), p("bruno", "fast", { moved: 2 })] });
    combat.turn = 1;
    installGame({ combats: [combat] });
    const writer = new PhasePlacementWriter({ adapter: null, advance: (c, o) => advancer.advance(c, o) });
    const advancer = new PhaseAdvancer({ adapter: null, writer });
    await advancer.complete(combat);
    const [marks] = combat.writes("embedded");
    assert.deepEqual(marks.updates, [{ _id: "ana", [`flags.${KEY}.moved`]: 2 }]);
    assert.equal(combat.writes("update")[0].data[`flags.${KEY}.actionsHalf`], "2:fast");
    assert.equal(combat.combatants.get("ana").flags[KEY].done, undefined);
  });

  it("lets the GM undo a skip once its phase reaches movement: unmarking the movement clears done too", async () => {
    const ana = p("ana", "fast", { done: 2, moved: 2 });
    const combat = fakeCombat({ round: 2, flags: { split: "players" }, combatants: [ana] });
    combat.turn = 0;
    installGame({ isGM: true });
    assert.equal(await new DoneMarkers({ adapter: null }).setMoved(combat, "ana", false), true);
    assert.deepEqual(ana.updates[0].data, { [`flags.${KEY}.moved`]: null, [`flags.${KEY}.done`]: null });
  });

  const options = { localize: (key) => key, format: (key, data) => `${key}${JSON.stringify(data)}`, decimals: 2 };
  const settings = { showDcToPlayers: false, autoAdvance: true };

  it("counts and completes a group's movement during the movement half", () => {
    const view = combatView({
      round: 2,
      on: "k2",
      split: "all",
      combatants: [enemy("k1", "enemies", { groupKey: "kob", moved: 2 }), enemy("k2", "enemies", { groupKey: "kob", moved: 2 })],
    });
    const [group] = CombatPhaseProjector.project(view, { isGM: true }, settings, options).phases.find((ph) => ph.id === "enemies").rows;
    assert.equal(group.count, "2/2");
    assert.equal(group.completeButton, null);
  });

  it("shows other players 'Moved' or 'Moving' during the movement half, not 'Acting'", () => {
    const view = splitView({ ana: { moved: 2 } });
    const rows = CombatPhaseProjector.project(view, { isGM: false }, settings, options).phases.find((ph) => ph.id === "fast").rows;
    assert.deepEqual(rows.map((r) => [r.doneStatus, r.movedStatus]), [[false, { moved: true }], [false, { moved: false }]]);
  });
});
